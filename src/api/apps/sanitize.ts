// What an app publishes is shown to the user and loaded by their browser, so
// an image URL in it is the app asking the browser to fetch something, a
// tracking pixel, or an address on the LAN. Any image whose URL the host
// wouldn't let the app itself reach is blanked instead (the UI already
// handles a card with no image).
import type { DashboardContribution } from '#lib/apps/dashboard';
import type { AppScreen, UiNode } from '#lib/apps/ui';

// Same check the host applies to the app's own requests, passed in so this
// module stays free of network concerns.
type UrlPolicy = (url: string) => boolean;

/** Applied by runtime.ts to every dashboard an app publishes, before the home screen sees it. */
export function sanitizeDashboard(
	dashboard: DashboardContribution,
	allows: UrlPolicy
): DashboardContribution {
	return {
		...dashboard,
		cards: dashboard.cards.map((card) => ({ ...card, image: allows(card.image) ? card.image : '' }))
	};
}

// Recurses only through nodes that can hold other nodes.
function sanitizeNode(node: UiNode, allows: UrlPolicy): UiNode {
	switch (node.type) {
		case 'image':
			return allows(node.src) ? node : { ...node, src: '' };
		case 'container':
			return { ...node, children: node.children.map((child) => sanitizeNode(child, allows)) };
		case 'list':
			return { ...node, items: node.items.map((item) => sanitizeNode(item, allows)) };
		default:
			return node;
	}
}

/** Applied by runtime.ts to every screen an app publishes, before the TV renders it. */
export function sanitizeScreen(screen: AppScreen, allows: UrlPolicy): AppScreen {
	return { ...screen, root: sanitizeNode(screen.root, allows) };
}
