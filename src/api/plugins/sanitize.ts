// What a plugin publishes is shown to the user and loaded by their browser, so
// an image URL in it is the plugin asking the browser to fetch something — a
// tracking pixel, or an address on the LAN. Any image whose URL the host
// wouldn't let the plugin itself reach is blanked instead (the UI already
// handles a card with no image).
import type { DashboardContribution } from '#lib/plugins/dashboard';
import type { PluginScreen, UiNode } from '#lib/plugins/ui';

type UrlPolicy = (url: string) => boolean;

export function sanitizeDashboard(
	dashboard: DashboardContribution,
	allows: UrlPolicy
): DashboardContribution {
	return {
		...dashboard,
		cards: dashboard.cards.map((card) => ({ ...card, image: allows(card.image) ? card.image : '' }))
	};
}

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

export function sanitizeScreen(screen: PluginScreen, allows: UrlPolicy): PluginScreen {
	return { ...screen, root: sanitizeNode(screen.root, allows) };
}
