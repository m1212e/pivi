import type { DashboardContribution } from '@pivi/sdk/dashboard';
import type { UiNode } from '@pivi/sdk/ui';

type Action = { type: string; screenId?: string; sessionId?: string; url?: string } | undefined;

const actionText = (action: Action) =>
	!action
		? ''
		: action.type === 'screen'
			? ` → screen ${action.screenId}`
			: action.type === 'session'
				? ` → play ${action.sessionId}`
				: ` → phone ${action.url}`;

const clip = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A screen as an indented text tree: what it shows, and which events and actions it can fire. */
export function renderUiTree(node: UiNode, depth = 0): string {
	const pad = '  '.repeat(depth);
	const events: string[] = [];
	const n = node as Record<string, unknown>;
	for (const key of ['onSelect', 'onChange', 'onInput', 'onSubmit', 'onReachEnd']) {
		if (typeof n[key] === 'string') events.push(`${key}=${n[key]}`);
	}
	const tail = `${actionText(n.action as Action)}${events.length ? `  [${events.join(' ')}]` : ''}`;
	switch (node.type) {
		case 'container':
			return [
				`${pad}container ${node.direction}${node.title ? ` "${clip(node.title)}"` : ''}${tail}`,
				...node.children.map((c) => renderUiTree(c, depth + 1))
			].join('\n');
		case 'shelf':
			return [
				`${pad}shelf "${clip(node.title)}"`,
				...node.children.map((c) => renderUiTree(c, depth + 1))
			].join('\n');
		case 'list':
			return [`${pad}list`, ...node.items.map((c) => renderUiTree(c, depth + 1))].join('\n');
		case 'text':
			return `${pad}text${node.variant ? `(${node.variant})` : ''} "${clip(node.value)}"`;
		case 'button':
			return `${pad}button "${clip(node.label)}"${tail}`;
		case 'mediaCard':
			return `${pad}mediaCard "${clip(node.title)}" · ${clip(node.meta)}${tail}`;
		case 'hero':
			return `${pad}hero "${clip(node.title)}"${tail}`;
		case 'textInput':
			return `${pad}textInput "${clip(node.label)}"${tail}`;
		case 'toggle':
			return `${pad}toggle "${clip(node.label)}" = ${node.value}${tail}`;
		case 'icon':
			return `${pad}icon ${clip(String(node.path), 30)}`;
		case 'image':
			return `${pad}image ${clip(node.src, 50)}`;
		case 'spinner':
		case 'skeleton':
			return `${pad}${node.type}`;
		default:
			return `${pad}${(node as { type: string }).type}`;
	}
}

export function renderDashboard(dashboard: DashboardContribution): string {
	if (dashboard.cards.length === 0) return '(no cards)';
	return dashboard.cards
		.map((card) => {
			const sub =
				card.kind === 'resume'
					? `${Math.round(card.progress * 100)}% · ${card.subtitle}`
					: card.meta;
			return `${card.kind.padEnd(10)} "${clip(card.title)}" · ${clip(sub)}${actionText(card.action)}`;
		})
		.join('\n');
}
