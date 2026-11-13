// What an app publishes is shown to the user and loaded by their browser, so
// an image URL in it is the app asking the browser to fetch something, a
// tracking pixel, or an address on the LAN. Any image whose URL the host
// wouldn't let the app itself reach is blanked instead (the UI already
// handles a card with no image). Links sent to the phone are held to https,
// so an app can't hand the phone a javascript:, intent: or file: URL.
import type { AppAction, DashboardContribution } from '#sdk/dashboard';
import type { AppScreen, UiNode } from '#sdk/ui';

// Same check the host applies to the app's own requests, passed in so this
// module stays free of network concerns.
type UrlPolicy = (url: string) => boolean;

/**
 * More nodes than any real screen needs. The message size cap alone would
 * still let an app make every subscriber re-render a huge tree on each publish.
 */
export const MAX_SCREEN_NODES = 5_000;

/** Also checked by the openUrlOnPhone mutation, the other way a URL reaches the phone. */
export function isPhoneSafeUrl(raw: string): boolean {
	try {
		return new URL(raw).protocol === 'https:';
	} catch {
		return false;
	}
}

// An action the host can't safely follow is dropped rather than rewritten,
// so a node never points somewhere the app didn't ask for.
function safeAction(action: AppAction): AppAction | undefined {
	if (action.type === 'openOnPhone' && !isPhoneSafeUrl(action.url)) return undefined;
	return action;
}

const image = (src: string, allows: UrlPolicy) => (allows(src) ? src : '');
// A fallback the host can't let through is left out, the image just stays empty.
const fallback = (src: string | undefined, allows: UrlPolicy) =>
	src && allows(src) ? src : undefined;

/** Applied by runtime.ts to every dashboard an app publishes, before the home screen sees it. */
export function sanitizeDashboard(
	dashboard: DashboardContribution,
	allows: UrlPolicy
): DashboardContribution {
	return {
		cards: dashboard.cards.flatMap((card) => {
			const action = safeAction(card.action);
			return action
				? [
						{
							...card,
							image: image(card.image, allows),
							fallbackImage: fallback(card.fallbackImage, allows),
							action
						}
					]
				: [];
		})
	};
}

function sanitizeChildren(nodes: UiNode[], allows: UrlPolicy): UiNode[] {
	return nodes.flatMap((child) => {
		const clean = sanitizeNode(child, allows);
		return clean ? [clean] : [];
	});
}

type NodeOf<K extends UiNode['type']> = Extract<UiNode, { type: K }>;
type NodeSanitizer<K extends UiNode['type']> = (
	node: NodeOf<K>,
	allows: UrlPolicy
) => UiNode | undefined;

const keep = <K extends UiNode['type']>(node: NodeOf<K>) => node;

// One entry per node kind, and the type requires all of them, so adding a kind
// to #sdk/ui is a type error here until someone decides what it needs.
// `undefined` drops the node.
const SANITIZERS: { [K in UiNode['type']]: NodeSanitizer<K> } = {
	image: (node, allows) => ({ ...node, src: image(node.src, allows) }),
	mediaCard: (node, allows) => ({
		...node,
		image: image(node.image, allows),
		fallbackImage: fallback(node.fallbackImage, allows),
		action: node.action && safeAction(node.action)
	}),
	// The banner's only control is its Play button, so without an action it's dropped.
	hero: (node, allows) => {
		const action = safeAction(node.action);
		if (!action) return undefined;
		return {
			...node,
			image: node.image && image(node.image, allows),
			fallbackImage: fallback(node.fallbackImage, allows),
			action
		};
	},
	button: (node) => ({ ...node, action: node.action && safeAction(node.action) }),
	container: (node, allows) => ({
		...node,
		action: node.action && safeAction(node.action),
		children: sanitizeChildren(node.children, allows)
	}),
	shelf: (node, allows) => ({ ...node, children: sanitizeChildren(node.children, allows) }),
	list: (node, allows) => ({ ...node, items: sanitizeChildren(node.items, allows) }),
	text: keep,
	icon: keep,
	spinner: keep,
	skeleton: keep,
	toggle: keep,
	textInput: keep
};

function sanitizeNode(node: UiNode, allows: UrlPolicy): UiNode | undefined {
	// The table pairs each kind with its own sanitizer, which TypeScript can't
	// follow through an indexed lookup.
	const sanitize = SANITIZERS[node.type] as NodeSanitizer<UiNode['type']>;
	return sanitize(node as NodeOf<UiNode['type']>, allows);
}

function countNodes(node: UiNode): number {
	const children =
		node.type === 'container' || node.type === 'shelf'
			? node.children
			: node.type === 'list'
				? node.items
				: [];
	return children.reduce((sum, child) => sum + countNodes(child), 1);
}

/**
 * Applied by runtime.ts to every screen an app publishes, before the TV renders
 * it. Undefined when the screen is too large to accept at all.
 */
export function sanitizeScreen(screen: AppScreen, allows: UrlPolicy): AppScreen | undefined {
	if (countNodes(screen.root) > MAX_SCREEN_NODES) return undefined;
	const root = sanitizeNode(screen.root, allows);
	return root && { screenId: screen.screenId, root };
}
