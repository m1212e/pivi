// `pivi-app dev --preview`: a local page that renders what the app published
// (its screens and home cards) and sends clicks, toggles and text input back as
// UI events, so a screen can be looked at and tried without a TV. It approximates
// the host's renderer with plain HTML: it shows structure, events and actions, not
// exact pixels. Served on 127.0.0.1 only.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { executeCommand } from './commands';
import type { Harness } from './harness';

const read = (req: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => resolve(body));
	});

export type Preview = { url: string; close(): Promise<void> };

export async function startPreview(harness: Harness, port = 0): Promise<Preview> {
	const server: Server = createServer(async (req, res) => {
		const json = (value: unknown) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(value));
		};
		try {
			if (req.method === 'GET' && req.url === '/') {
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
				return res.end(PAGE);
			}
			if (req.method === 'GET' && req.url === '/state') {
				const { manifest } = harness;
				return json({
					name: manifest.name,
					entryScreenId: manifest.entryScreenId,
					screens: Object.fromEntries(harness.screens),
					dashboard: harness.dashboard.current ?? null,
					problems: harness.problems.map((p) => p.message),
					phoneUrls: harness.phoneUrls,
					running: harness.running
				});
			}
			if (req.method === 'POST' && req.url === '/event') {
				const { screenId, eventId, value } = JSON.parse(await read(req));
				harness.notify('host/uiEvent', {
					screenId,
					eventId,
					...(value === undefined ? {} : { value })
				});
				return json({ ok: true });
			}
			if (req.method === 'POST' && req.url === '/stream') {
				const { sessionId } = JSON.parse(await read(req));
				return json({ text: await executeCommand(harness, `stream ${sessionId}`) });
			}
			res.writeHead(404).end();
		} catch (error) {
			res.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
		}
	});
	await new Promise<void>((done, fail) => {
		server.once('error', (error: NodeJS.ErrnoException) =>
			fail(
				new Error(
					error.code === 'EADDRINUSE'
						? `Port ${port} is in use: pick another with --preview=<port>`
						: error.message
				)
			)
		);
		server.listen(port, '127.0.0.1', done);
	});
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
		close: () => new Promise<void>((done) => server.close(() => done()))
	};
}

// The page: one script that polls /state and turns UiNodes into DOM. Everything an
// app sends goes in through textContent and attributes, never as markup.
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>pivi preview</title>
<style>
:root { color-scheme: dark; --bg:#0d0f14; --panel:#181c25; --soft:#262c39; --text:#e9edf5; --muted:#9aa3b5; --accent:#7c8cff; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.4 system-ui, sans-serif; }
header { display:flex; gap:8px; align-items:center; padding:10px 16px; background:#0a0c10; position:sticky; top:0; z-index:1; flex-wrap:wrap; }
header b { margin-right:12px; }
header button { background:var(--soft); color:var(--text); border:0; border-radius:999px; padding:6px 12px; cursor:pointer; }
header button.on { background:var(--accent); color:#000; }
#problems { color:#ff8a8a; margin-left:auto; font-size:13px; }
main { padding:16px; }
#log { position:fixed; right:12px; bottom:12px; width:min(560px,90vw); max-height:45vh; overflow:auto; background:#05060a; border:1px solid var(--soft); border-radius:10px; padding:10px; white-space:pre-wrap; font:12px/1.4 ui-monospace,monospace; display:none; }
.row { display:flex; flex-direction:row; gap:12px; align-items:center; }
.row.wrap { align-items:flex-start; }
.column { display:flex; flex-direction:column; gap:12px; }
.wrap { flex-wrap:wrap; } .grow { flex:1 1 0; min-width:0; } .start { align-items:flex-start; }
.between { justify-content:space-between; } .around { justify-content:space-around; }
.center { align-items:center; justify-content:center; text-align:center; margin:auto; }
.panel { background:var(--panel); border-radius:14px; padding:16px; }
.clickable { cursor:pointer; outline:1px dashed transparent; } .clickable:hover { outline-color:var(--accent); }
h2.title { margin:0 0 4px; font-size:18px; }
.t-display { font-size:40px; font-weight:700; } .t-headline { font-size:28px; font-weight:700; } .t-title { font-size:20px; font-weight:600; }
.t-subtitle { color:var(--muted); } .t-body { }
.clamp { display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden; }
.btn { background:var(--soft); color:var(--text); border:0; border-radius:999px; padding:8px 16px; cursor:pointer; font-size:15px; }
.btn.solid { background:var(--accent); color:#000; } .btn.nav { border-radius:10px; text-align:left; width:100%; } .btn.selected { outline:2px solid var(--accent); }
.btn.lg { font-size:20px; padding:12px 24px; } .btn.sm { font-size:13px; padding:5px 10px; }
.card { width:240px; flex:none; } .card img, .thumb { width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:10px; background:var(--soft); display:block; }
.card.poster img { aspect-ratio:2/3; } .card.avatar img { aspect-ratio:1; border-radius:50%; }
.card .meta { color:var(--muted); font-size:13px; } .badge { background:#000a; padding:1px 6px; border-radius:6px; font-size:12px; }
.progress { height:4px; background:var(--accent); border-radius:2px; }
.shelf { overflow-x:auto; padding-bottom:8px; }
.hero { position:relative; border-radius:16px; overflow:hidden; min-height:260px; background:var(--panel); display:flex; align-items:flex-end; }
.hero img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.45; }
.hero .body { position:relative; padding:24px; max-width:640px; }
.icon { display:inline-grid; place-items:center; width:40px; height:40px; border-radius:50%; background:var(--soft); font-size:11px; color:var(--muted); }
.icon.large { width:64px; height:64px; } .icon svg { width:60%; height:60%; fill:currentColor; }
.skeleton { width:240px; aspect-ratio:16/9; border-radius:10px; background:linear-gradient(90deg,var(--soft),#323a4b,var(--soft)); }
input[type=text], input[type=password] { background:var(--soft); color:var(--text); border:1px solid #3a4253; border-radius:10px; padding:10px; font-size:15px; width:100%; }
.hint { color:var(--muted); font-size:12px; }
</style></head><body>
<header><b id="name">pivi preview</b><span id="tabs"></span><span id="problems"></span></header>
<main id="root"></main><pre id="log"></pre>
<script>
let state = null, current = null;
const $ = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = String(text); return el; };
const log = (text) => { const l = document.getElementById('log'); l.style.display = 'block'; l.textContent = text; };
const post = (url, body) => fetch(url, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
const fire = (eventId, value) => post('/event', { screenId: current, eventId, value }).then(() => setTimeout(refresh, 600));
function act(action) {
	if (!action) return;
	if (action.type === 'screen') { current = action.screenId; render(); }
	else if (action.type === 'session') { log('Resolving ' + action.sessionId + '…'); post('/stream', { sessionId: action.sessionId }).then((r) => log(r.text)); }
	else log('Would open on the phone: ' + action.url);
}
function target(el, node) {
	if (node.action) { el.classList.add('clickable'); el.title = 'action: ' + JSON.stringify(node.action); el.onclick = (e) => { e.stopPropagation(); act(node.action); }; }
	else if (node.onSelect) { el.classList.add('clickable'); el.title = 'onSelect: ' + node.onSelect; el.onclick = (e) => { e.stopPropagation(); fire(node.onSelect); }; }
	return el;
}
function icon(path, size) {
	const box = $('span', 'icon' + (size === 'large' ? ' large' : ''));
	if (/^[a-z-]+$/.test(path)) box.textContent = path;
	else { const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS(ns, 'path'); p.setAttribute('d', path); svg.append(p); box.append(svg); }
	return box;
}
function image(src, fallback, cls) { const img = $('img', cls); img.src = src; img.loading = 'lazy'; if (fallback) img.onerror = () => { img.onerror = null; img.src = fallback; }; return img; }
function card(node) {
	const el = $('div', 'card ' + (node.shape || 'video'));
	el.append(image(node.image, node.fallbackImage));
	if (node.progress !== undefined) { const bar = $('div', 'progress'); bar.style.width = Math.round(node.progress * 100) + '%'; el.append(bar); }
	if (node.badge) el.append($('span', 'badge', node.badge));
	el.append($('div', 'clamp', node.title), $('div', 'meta', node.meta ?? node.subtitle ?? ''));
	return target(el, node);
}
const RENDER = {
	container(n) {
		const el = $('div', [n.direction, n.wrap && 'wrap', n.grow && 'grow', n.alignStart && 'start', n.justify, n.center && 'center', n.panel && 'panel'].filter(Boolean).join(' '));
		if (n.width) el.style.width = n.width;
		if (n.title) { const box = $('div', 'column'); box.append($('h2', 'title', n.title), el); n.children.forEach((c) => el.append(node(c))); return target(box, n); }
		n.children.forEach((c) => el.append(node(c)));
		if (n.onReachEnd) el.append($('div', 'hint', 'onReachEnd: ' + n.onReachEnd));
		return target(el, n);
	},
	text(n) { const el = $('div', 't-' + (n.variant || 'body') + (n.lines ? ' clamp' : ''), n.value); if (n.lines) el.style.webkitLineClamp = n.lines; return el; },
	icon(n) { return icon(String(n.path), n.size); },
	spinner(n) { return $('div', 'hint', '⟳ ' + (n.label || 'loading')); },
	skeleton() { return $('div', 'skeleton'); },
	mediaCard: card,
	shelf(n) { const box = $('div', 'column'); const row = $('div', 'row shelf start'); n.children.forEach((c) => row.append(node(c))); box.append($('h2', 'title', n.title), row); return box; },
	hero(n) { const el = $('div', 'hero'); if (n.image) el.append(image(n.image, n.fallbackImage)); const body = $('div', 'body column'); if (n.source) body.append($('span', 'badge', n.source)); body.append($('div', 't-headline', n.title), $('div', 't-subtitle', n.description)); const play = $('button', 'btn solid lg', 'Play'); play.onclick = () => act(n.action); body.append(play); el.append(body); return el; },
	image(n) { const el = image(n.src, null, 'thumb'); if (n.width) el.style.width = n.width; if (n.aspect === 'poster') el.style.aspectRatio = '2/3'; if (n.aspect === 'square') el.style.aspectRatio = '1'; return el; },
	button(n) { const el = $('button', ['btn', n.variant, n.size, n.selected && 'selected'].filter(Boolean).join(' ')); if (n.icon) el.append(icon(String(n.icon)), ' '); el.append(n.label); return target(el, n); },
	toggle(n) { const label = $('label', 'row'); const box = $('input'); box.type = 'checkbox'; box.checked = n.value; box.onchange = () => fire(n.onChange, box.checked); label.append(box, n.label); return label; },
	textInput(n) {
		const box = $('div', 'column'); const input = $('input'); input.type = n.secret ? 'password' : 'text'; input.placeholder = n.placeholder || n.label;
		input.onkeydown = (e) => { if (e.key === 'Enter') fire(n.onSubmit, input.value); };
		if (n.onInput) input.oninput = () => fire(n.onInput, input.value);
		box.append(input);
		if (n.suggestions && n.suggestions.length) { const row = $('div', 'row wrap'); n.suggestions.forEach((s) => { const b = $('button', 'btn sm', s); b.onclick = () => fire(n.onSubmit, s); row.append(b); }); box.append(row); }
		return box;
	},
	list(n) { const el = $('div', 'column'); n.items.forEach((c) => el.append(node(c))); return el; }
};
function node(n) { return (RENDER[n.type] || ((x) => $('div', 'hint', 'unknown node ' + x.type)))(n); }
function render() {
	if (!state) return;
	document.getElementById('name').textContent = state.name + (state.running ? '' : ' (not running)');
	const tabs = document.getElementById('tabs'); tabs.replaceChildren();
	const ids = ['(home)', ...Object.keys(state.screens)];
	if (!current) current = state.screens[state.entryScreenId] ? state.entryScreenId : ids[ids.length > 1 ? 1 : 0];
	ids.forEach((id) => { const b = $('button', id === current ? 'on' : '', id === '(home)' ? 'home cards' : id); b.onclick = () => { current = id; render(); }; tabs.append(b); });
	document.getElementById('problems').textContent = state.problems.length ? state.problems.length + ' problem(s): ' + state.problems.at(-1) : '';
	const root = document.getElementById('root'); root.replaceChildren();
	if (current === '(home)') { const row = $('div', 'row wrap start'); (state.dashboard?.cards || []).forEach((c) => row.append(card(c))); root.append(state.dashboard ? row : $('div', 'hint', 'No dashboard published.')); }
	else if (state.screens[current]) root.append(node(state.screens[current]));
	else root.append($('div', 'hint', 'Screen "' + current + '" is not published (yet).'));
}
async function refresh() { const next = await fetch('/state').then((r) => r.json()); if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; render(); } }
refresh(); setInterval(refresh, 1500);
</script></body></html>`;
