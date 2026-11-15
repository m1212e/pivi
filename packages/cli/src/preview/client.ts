// The preview page's script: polls /state and renders what the app published
// with the DOM, typed against the SDK, so a node or action kind it does not
// handle is a type error. Everything an app sends goes in through textContent
// and attributes, never as markup. Built for the browser by tsdown (see
// tsdown.config.ts) and served by server.ts.
import type { AppAction, HomeCard } from '@pivi/sdk/dashboard';
import { isHostIcon } from '@pivi/sdk/icons';
import type { UiNode } from '@pivi/sdk/ui';
import type { PreviewState } from './server';

type NodeOf<K extends UiNode['type']> = Extract<UiNode, { type: K }>;
type Selectable = { action?: AppAction; onSelect?: string };

const HOME = '(home)';
let state: PreviewState | undefined;
let current: string | undefined;

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = '',
	text?: string
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function log(text: string) {
	const box = document.getElementById('log')!;
	box.style.display = 'block';
	box.textContent = text;
}

const post = <T>(url: string, body: unknown): Promise<T> =>
	fetch(url, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);

function fire(eventId: string, value?: string | boolean) {
	void post('/event', { screenId: current, eventId, value }).then(() => setTimeout(refresh, 600));
}

/** What following an action does here. Exhaustive: a new action kind is a type error. */
function act(action: AppAction) {
	switch (action.type) {
		case 'screen':
			current = action.screenId;
			render();
			return;
		case 'session':
			log(`Resolving ${action.sessionId}…`);
			void post<{ text: string }>('/stream', { sessionId: action.sessionId }).then((r) =>
				log(r.text)
			);
			return;
		case 'openOnPhone':
			log(`Would open on the phone: ${action.url}`);
			return;
		default: {
			const unknown: never = action;
			return unknown;
		}
	}
}

function target<T extends HTMLElement>(node: T, from: Selectable): T {
	const { action, onSelect } = from;
	if (action) {
		node.classList.add('clickable');
		node.title = `action: ${JSON.stringify(action)}`;
		node.onclick = (e) => {
			e.stopPropagation();
			act(action);
		};
	} else if (onSelect) {
		node.classList.add('clickable');
		node.title = `onSelect: ${onSelect}`;
		node.onclick = (e) => {
			e.stopPropagation();
			fire(onSelect);
		};
	}
	return node;
}

function icon(path: string, size?: 'normal' | 'large') {
	const box = el('span', `icon${size === 'large' ? ' large' : ''}`);
	if (isHostIcon(path)) {
		box.textContent = path;
	} else {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		const p = document.createElementNS(ns, 'path');
		p.setAttribute('d', path);
		svg.append(p);
		box.append(svg);
	}
	return box;
}

function image(src: string, fallback?: string, className = '') {
	const img = el('img', className);
	img.src = src;
	img.loading = 'lazy';
	if (fallback) {
		img.onerror = () => {
			img.onerror = null;
			img.src = fallback;
		};
	}
	return img;
}

type CardLike = {
	title: string;
	image: string;
	fallbackImage?: string;
	shape?: 'video' | 'poster' | 'avatar';
	badge?: string;
	progress?: number;
	meta: string;
} & Selectable;

function card(c: CardLike) {
	const box = el('div', `card ${c.shape ?? 'video'}`);
	box.append(image(c.image, c.fallbackImage));
	if (c.progress !== undefined) {
		const bar = el('div', 'progress');
		bar.style.width = `${Math.round(c.progress * 100)}%`;
		box.append(bar);
	}
	if (c.badge) box.append(el('span', 'badge', c.badge));
	box.append(el('div', 'clamp', c.title), el('div', 'meta', c.meta));
	return target(box, c);
}

const homeCard = (c: HomeCard) =>
	card({
		...c,
		meta: c.kind === 'resume' ? `${Math.round(c.progress * 100)}% · ${c.subtitle}` : c.meta
	});

// One renderer per node kind: a kind missing here is a type error.
const RENDER: { [K in UiNode['type']]: (node: NodeOf<K>) => HTMLElement } = {
	container(n) {
		const classes = [
			n.direction,
			n.wrap && 'wrap',
			n.grow && 'grow',
			n.alignStart && 'start',
			n.justify,
			n.center && 'center',
			n.panel && 'panel'
		];
		const box = el('div', classes.filter(Boolean).join(' '));
		if (n.width) box.style.width = n.width;
		n.children.forEach((child) => box.append(render1(child)));
		if (n.onReachEnd) box.append(el('div', 'hint', `onReachEnd: ${n.onReachEnd}`));
		if (!n.title) return target(box, n);
		const titled = el('div', 'column');
		titled.append(el('h2', 'title', n.title), box);
		return target(titled, n);
	},
	text(n) {
		const node = el('div', `t-${n.variant ?? 'body'}${n.lines ? ' clamp' : ''}`, n.value);
		if (n.lines) node.style.setProperty('-webkit-line-clamp', String(n.lines));
		return node;
	},
	icon: (n) => icon(String(n.path), n.size),
	spinner: (n) => el('div', 'hint', `⟳ ${n.label ?? 'loading'}`),
	skeleton: () => el('div', 'skeleton'),
	mediaCard: (n) => card(n),
	shelf(n) {
		const box = el('div', 'column');
		const row = el('div', 'row shelf start');
		n.children.forEach((child) => row.append(render1(child)));
		box.append(el('h2', 'title', n.title), row);
		return box;
	},
	hero(n) {
		const box = el('div', 'hero');
		if (n.image) box.append(image(n.image, n.fallbackImage));
		const body = el('div', 'body column');
		if (n.source) body.append(el('span', 'badge', n.source));
		body.append(el('div', 't-headline', n.title), el('div', 't-subtitle', n.description));
		const play = el('button', 'btn solid lg', 'Play');
		play.onclick = () => act(n.action);
		body.append(play);
		box.append(body);
		return box;
	},
	image(n) {
		const img = image(n.src, undefined, 'thumb');
		if (n.width) img.style.width = n.width;
		if (n.aspect === 'poster') img.style.aspectRatio = '2/3';
		if (n.aspect === 'square') img.style.aspectRatio = '1';
		return img;
	},
	button(n) {
		const node = el(
			'button',
			['btn', n.variant, n.size, n.selected && 'selected'].filter(Boolean).join(' ')
		);
		if (n.icon) node.append(icon(String(n.icon)), ' ');
		node.append(n.label);
		return target(node, n);
	},
	toggle(n) {
		const label = el('label', 'row');
		const box = el('input');
		box.type = 'checkbox';
		box.checked = n.value;
		box.onchange = () => fire(n.onChange, box.checked);
		label.append(box, n.label);
		return label;
	},
	textInput(n) {
		const box = el('div', 'column');
		const input = el('input');
		input.type = n.secret ? 'password' : 'text';
		input.placeholder = n.placeholder ?? n.label;
		input.onkeydown = (e) => {
			if (e.key === 'Enter') fire(n.onSubmit, input.value);
		};
		const { onInput } = n;
		if (onInput) input.oninput = () => fire(onInput, input.value);
		box.append(input);
		if (n.suggestions?.length) {
			const row = el('div', 'row wrap');
			for (const suggestion of n.suggestions) {
				const b = el('button', 'btn sm', suggestion);
				b.onclick = () => fire(n.onSubmit, suggestion);
				row.append(b);
			}
			box.append(row);
		}
		return box;
	},
	list(n) {
		const box = el('div', 'column');
		n.items.forEach((child) => box.append(render1(child)));
		return box;
	}
};

function render1(node: UiNode): HTMLElement {
	return (RENDER[node.type] as (n: UiNode) => HTMLElement)(node);
}

function renderTabs(screens: string[]) {
	const tabs = document.getElementById('tabs')!;
	tabs.replaceChildren();
	for (const id of [HOME, ...screens]) {
		const b = el('button', id === current ? 'on' : '', id === HOME ? 'home cards' : id);
		b.onclick = () => {
			current = id;
			render();
		};
		tabs.append(b);
	}
}

function renderView(view: PreviewState, id: string): HTMLElement {
	if (id === HOME) {
		if (!view.dashboard) return el('div', 'hint', 'No dashboard published.');
		const row = el('div', 'row wrap start');
		view.dashboard.cards.forEach((c) => row.append(homeCard(c)));
		return row;
	}
	const screen = view.screens[id];
	return screen ? render1(screen) : el('div', 'hint', `Screen "${id}" is not published (yet).`);
}

function render() {
	if (!state) return;
	document.getElementById('name')!.textContent =
		state.name + (state.running ? '' : ' (not running)');
	const screens = Object.keys(state.screens);
	current ??= state.screens[state.entryScreenId] ? state.entryScreenId : (screens[0] ?? HOME);
	renderTabs(screens);
	const { problems } = state;
	document.getElementById('problems')!.textContent = problems.length
		? `${problems.length} problem(s): ${problems.at(-1)}`
		: '';
	document.getElementById('root')!.replaceChildren(renderView(state, current));
}

async function refresh() {
	const next = (await fetch('/state').then((r) => r.json())) as PreviewState;
	if (JSON.stringify(next) !== JSON.stringify(state)) {
		state = next;
		render();
	}
}

void refresh();
setInterval(refresh, 1500);
