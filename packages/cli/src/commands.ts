// What a person types at `pivi-app dev` (or passes to --exec), and what an MCP
// server would expose: each command returns text, so every front end shares it.
import { Harness } from './harness';
import { probeStream } from './probe';
import { renderDashboard, renderUiTree } from './uiTree';

export const HELP = `Commands:
  status                      what the app declared and published so far
  dashboard                   the home cards
  screen [id]                 a published screen as a tree (no id: list them)
  event <screen> <event> [v]  press or change something on a screen
  stream <sessionId> [h]      resolveStream, validate it and probe its URLs
  next <sessionId> [context]  resolveNext
  skip <sessionId>            resolveSkipSegments
  live <sessionId>            resolveLiveStatus
  chat open|close <sessionId> start or stop a session's chat
  chatlog                     chat messages received
  refresh                     host/refreshDashboard
  locale <tag>                host/locale
  ping                        host/ping
  call <method> [json]        any host request
  send <method> [json]        any host notification
  domains                     hosts the app connected to, and which the manifest allows
  problems                    everything the host would reject or drop
  logs [n]                    the app's stderr
  restart                     stop and start the app again
  quit`;

const json = (value: unknown) => JSON.stringify(value, null, 2);

function parseJson(text: string | undefined): unknown {
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`not valid JSON: ${text}`);
	}
}

export async function executeCommand(harness: Harness, line: string): Promise<string> {
	const [name = '', ...rest] = line.trim().split(/\s+/);
	const arg = (i: number) => rest[i];
	const tail = (i: number) => rest.slice(i).join(' ') || undefined;

	switch (name) {
		case '':
			return '';
		case 'help':
		case '?':
			return HELP;
		case 'status': {
			const m = harness.manifest;
			return [
				`${m.name} ${m.version} (${m.id}), protocol ${m.protocol}${harness.running ? '' : ', NOT RUNNING'}`,
				`features:    ${m.features.join(', ') || 'none'}`,
				`permissions: ${m.permissions.join(', ') || 'none'}`,
				`domains:     ${m.network?.domains.join(', ') ?? 'none'}`,
				`dashboard:   ${harness.dashboard.current ? `${harness.dashboard.current.cards.length} cards` : 'not published'}`,
				`screens:     ${[...harness.screens.keys()].join(', ') || 'none published'}`,
				`problems:    ${harness.problems.length}`
			].join('\n');
		}
		case 'dashboard':
			return harness.dashboard.current
				? renderDashboard(harness.dashboard.current)
				: 'No dashboard published yet.';
		case 'screen': {
			const id = arg(0);
			if (!id) {
				return harness.screens.size
					? [...harness.screens.keys()].join('\n')
					: 'No screens published yet.';
			}
			const root = harness.screens.get(id);
			return root
				? renderUiTree(root)
				: `No screen "${id}". Published: ${[...harness.screens.keys()].join(', ') || 'none'}`;
		}
		case 'event': {
			const [screenId, eventId] = rest;
			if (!screenId || !eventId) return 'Usage: event <screenId> <eventId> [value]';
			const raw = tail(2);
			const value = raw === 'true' ? true : raw === 'false' ? false : raw;
			harness.notify('host/uiEvent', {
				screenId,
				eventId,
				...(value === undefined ? {} : { value })
			});
			await harness.settle(800);
			return `sent. Screens: ${[...harness.screens.keys()].join(', ')}`;
		}
		case 'stream': {
			const sessionId = arg(0);
			if (!sessionId) return 'Usage: stream <sessionId> [maxHeight]';
			const maxHeight = arg(1) ? Number(arg(1)) : undefined;
			const reply = await harness.request('app/resolveStream', {
				sessionId,
				...(maxHeight ? { maxHeight } : {})
			});
			if (reply.error) return `error: ${reply.error.message}`;
			const out = [json(reply.result)];
			if (reply.valid) {
				const probe = await probeStream(harness.manifest, reply.result as never);
				out.push(
					'',
					...probe.map(
						(l) => `${l.level === 'ok' ? '✓' : l.level === 'warn' ? '!' : '✗'} ${l.message}`
					)
				);
			} else {
				out.push('', '✗ the host would reject this answer, see `problems`');
			}
			return out.join('\n');
		}
		case 'next':
		case 'skip':
		case 'live': {
			const sessionId = arg(0);
			if (!sessionId) return `Usage: ${name} <sessionId>`;
			const method = {
				next: 'app/resolveNext',
				skip: 'app/resolveSkipSegments',
				live: 'app/resolveLiveStatus'
			}[name];
			const context = name === 'next' ? tail(1) : undefined;
			const reply = await harness.request(method, { sessionId, ...(context ? { context } : {}) });
			return reply.error ? `error: ${reply.error.message}` : json(reply.result);
		}
		case 'chat': {
			const [action, sessionId] = rest;
			if ((action !== 'open' && action !== 'close') || !sessionId)
				return 'Usage: chat open|close <sessionId>';
			harness.notify(action === 'open' ? 'host/openChat' : 'host/closeChat', { sessionId });
			await harness.settle(1500);
			return `sent. ${harness.chat.length} chat batches received so far (see chatlog)`;
		}
		case 'chatlog':
			return harness.chat.length ? json(harness.chat.slice(-5)) : 'No chat messages yet.';
		case 'refresh':
			harness.notify('host/refreshDashboard');
			await harness.settle(1500);
			return harness.dashboard.current
				? `${harness.dashboard.current.cards.length} cards`
				: 'no dashboard';
		case 'locale':
			if (!arg(0)) return 'Usage: locale <bcp47 tag>';
			harness.notify('host/locale', { locale: arg(0) });
			return 'sent';
		case 'ping': {
			const started = Date.now();
			const reply = await harness.request('host/ping');
			return reply.error ? `error: ${reply.error.message}` : `pong in ${Date.now() - started} ms`;
		}
		case 'call': {
			const method = arg(0);
			if (!method) return 'Usage: call <method> [json]';
			const reply = await harness.request(method, parseJson(tail(1)));
			return reply.error ? `error: ${reply.error.message}` : json(reply.result);
		}
		case 'send': {
			const method = arg(0);
			if (!method) return 'Usage: send <method> [json]';
			harness.notify(method, parseJson(tail(1)));
			await harness.settle(800);
			return 'sent';
		}
		case 'domains': {
			const rows = [...(harness.proxy?.connections.values() ?? [])];
			if (!rows.length) return 'The app has not connected anywhere yet.';
			const lines = rows.map(
				(c) => `${c.allowed ? '✓ allowed ' : '✗ BLOCKED '} ${c.host}:${c.port}  ×${c.count}`
			);
			const declared = harness.manifest.network?.domains ?? [];
			const unused = declared.filter(
				(d) =>
					!rows.some(
						(c) =>
							c.allowed &&
							(d.startsWith('*.')
								? c.host.endsWith(d.slice(1)) || c.host === d.slice(2)
								: c.host === d)
					)
			);
			if (unused.length) lines.push('', `Declared but not contacted (yet): ${unused.join(', ')}`);
			if (rows.some((c) => !c.allowed))
				lines.push(
					'',
					'Add blocked hosts to network.domains in manifest.json, if the app really needs them.'
				);
			return lines.join('\n');
		}
		case 'problems':
			return harness.problems.length
				? harness.problems.map((p) => `✗ ${p.message}`).join('\n')
				: 'No problems.';
		case 'logs':
			return harness.logs.slice(-(Number(arg(0)) || 30)).join('\n') || '(no output on stderr)';
		case 'restart':
			await harness.stop();
			harness.reset();
			await harness.start();
			await harness.settle(1500);
			return 'restarted';
		default:
			return `Unknown command "${name}". Type help.`;
	}
}
