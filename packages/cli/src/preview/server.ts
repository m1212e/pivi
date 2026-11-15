// `pivi-app dev --preview`: a local page that renders what the app published
// (its screens and home cards) and sends clicks, toggles and text input back as
// UI events, so a screen can be looked at and tried without a TV. It approximates
// the host's renderer with plain HTML: it shows structure, events and actions, not
// exact pixels. Served on 127.0.0.1 only.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardContribution } from '@pivi/sdk/dashboard';
import type { UiNode } from '@pivi/sdk/ui';
import { build } from 'tsdown';
import { executeCommand } from '../commands';
import { uiEventNotification } from '@pivi/sdk/protocol';
import type { Harness } from '../harness';

const read = (req: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => resolve(body));
	});

export type Preview = { url: string; close(): Promise<void> };

/** What the page polls from /state. */
export type PreviewState = {
	name: string;
	entryScreenId: string;
	screens: Record<string, UiNode>;
	dashboard: DashboardContribution | null;
	problems: string[];
	phoneUrls: string[];
	running: boolean;
};

let clientScript: Promise<string> | undefined;

/** The page script: dist/preview-client.js once built, else client.ts bundled once per process. */
function loadClient(): Promise<string> {
	clientScript ??= (async () => {
		const built = fileURLToPath(new URL('./preview-client.js', import.meta.url));
		if (existsSync(built)) return readFileSync(built, 'utf8');
		const out = mkdtempSync(join(tmpdir(), 'pivi-preview-'));
		try {
			await build({
				config: false,
				entry: { client: fileURLToPath(new URL('./client.ts', import.meta.url)) },
				outDir: out,
				format: 'esm',
				platform: 'browser',
				deps: { alwaysBundle: [/./] },
				dts: false,
				sourcemap: false,
				report: false,
				publint: false,
				exports: false,
				logLevel: 'error'
			});
			const file = readdirSync(out).find((name) => /^client\.m?js$/.test(name));
			return readFileSync(join(out, file!), 'utf8');
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	})();
	return clientScript;
}

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
			if (req.method === 'GET' && req.url === '/client.js') {
				res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
				return res.end(await loadClient());
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
				} satisfies PreviewState);
			}
			if (req.method === 'POST' && req.url === '/event') {
				const { screenId, eventId, value } = JSON.parse(await read(req));
				harness.notify(uiEventNotification, {
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

// The page: styles here, the script is client.ts (typed against the SDK).
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
<script type="module" src="/client.js"></script>
</body></html>`;
