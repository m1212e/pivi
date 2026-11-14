// What a person types at `pivi-app dev` (or passes to --exec), and what an MCP
// server would expose: each command returns text, so every front end shares it.
import { Harness } from './harness';
import { probeStream } from './probe';
import { renderDashboard, renderUiTree } from './uiTree';

const HELP = `Commands:
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

type Args = {
	rest: string[];
	arg: (i: number) => string | undefined;
	tail: (i: number) => string | undefined;
};
type Command = (harness: Harness, args: Args) => string | Promise<string>;

const screenIds = (harness: Harness) => [...harness.screens.keys()];

function status(harness: Harness) {
	const m = harness.manifest;
	const dashboard = harness.dashboard.current;
	return [
		`${m.name} ${m.version} (${m.id}), protocol ${m.protocol}${harness.running ? '' : ', NOT RUNNING'}`,
		`features:    ${m.features.join(', ') || 'none'}`,
		`permissions: ${m.permissions.join(', ') || 'none'}`,
		`domains:     ${m.network?.domains.join(', ') ?? 'none'}`,
		`dashboard:   ${dashboard ? `${dashboard.cards.length} cards` : 'not published'}`,
		`screens:     ${screenIds(harness).join(', ') || 'none published'}`,
		`problems:    ${harness.problems.length}`
	].join('\n');
}

function screen(harness: Harness, { arg }: Args) {
	const id = arg(0);
	if (!id)
		return harness.screens.size ? screenIds(harness).join('\n') : 'No screens published yet.';
	const root = harness.screens.get(id);
	if (root) return renderUiTree(root);
	return `No screen "${id}". Published: ${screenIds(harness).join(', ') || 'none'}`;
}

function eventValue(raw: string | undefined) {
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	return raw;
}

async function event(harness: Harness, { rest, tail }: Args) {
	const [screenId, eventId] = rest;
	if (!screenId || !eventId) return 'Usage: event <screenId> <eventId> [value]';
	const value = eventValue(tail(2));
	harness.notify('host/uiEvent', { screenId, eventId, ...(value === undefined ? {} : { value }) });
	await harness.settle(800);
	return `sent. Screens: ${screenIds(harness).join(', ')}`;
}

const marks = { ok: '✓', warn: '!', fail: '✗' } as const;

async function stream(harness: Harness, { arg }: Args) {
	const sessionId = arg(0);
	if (!sessionId) return 'Usage: stream <sessionId> [maxHeight]';
	const maxHeight = arg(1) ? Number(arg(1)) : undefined;
	const reply = await harness.request('app/resolveStream', {
		sessionId,
		...(maxHeight ? { maxHeight } : {})
	});
	if (reply.error) return `error: ${reply.error.message}`;
	if (!reply.valid)
		return `${json(reply.result)}\n\n✗ the host would reject this answer, see \`problems\``;
	const probe = await probeStream(harness.manifest, reply.result as never);
	return [json(reply.result), '', ...probe.map((l) => `${marks[l.level]} ${l.message}`)].join('\n');
}

/** next, skip and live: a host request about one session, answered as JSON. */
function sessionRequest(method: string, usage: string, withContext = false): Command {
	return async (harness, { arg, tail }) => {
		const sessionId = arg(0);
		if (!sessionId) return `Usage: ${usage}`;
		const context = withContext ? tail(1) : undefined;
		const reply = await harness.request(method, { sessionId, ...(context ? { context } : {}) });
		return reply.error ? `error: ${reply.error.message}` : json(reply.result);
	};
}

async function chat(harness: Harness, { rest }: Args) {
	const [action, sessionId] = rest;
	if ((action !== 'open' && action !== 'close') || !sessionId)
		return 'Usage: chat open|close <sessionId>';
	harness.notify(action === 'open' ? 'host/openChat' : 'host/closeChat', { sessionId });
	await harness.settle(1500);
	return `sent. ${harness.chat.length} chat batches received so far (see chatlog)`;
}

async function refresh(harness: Harness) {
	harness.notify('host/refreshDashboard');
	await harness.settle(1500);
	return harness.dashboard.current
		? `${harness.dashboard.current.cards.length} cards`
		: 'no dashboard';
}

async function ping(harness: Harness) {
	const started = Date.now();
	const reply = await harness.request('host/ping');
	return reply.error ? `error: ${reply.error.message}` : `pong in ${Date.now() - started} ms`;
}

async function call(harness: Harness, { arg, tail }: Args) {
	const method = arg(0);
	if (!method) return 'Usage: call <method> [json]';
	const reply = await harness.request(method, parseJson(tail(1)));
	return reply.error ? `error: ${reply.error.message}` : json(reply.result);
}

async function send(harness: Harness, { arg, tail }: Args) {
	const method = arg(0);
	if (!method) return 'Usage: send <method> [json]';
	harness.notify(method, parseJson(tail(1)));
	await harness.settle(800);
	return 'sent';
}

const covers = (domain: string, host: string) =>
	domain.startsWith('*.')
		? host === domain.slice(2) || host.endsWith(domain.slice(1))
		: host === domain;

function domains(harness: Harness) {
	const rows = [...(harness.proxy?.connections.values() ?? [])];
	if (!rows.length) return 'The app has not connected anywhere yet.';
	const lines = rows.map(
		(c) => `${c.allowed ? '✓ allowed ' : '✗ BLOCKED '} ${c.host}:${c.port}  ×${c.count}`
	);
	const declared = harness.manifest.network?.domains ?? [];
	const unused = declared.filter((d) => !rows.some((c) => c.allowed && covers(d, c.host)));
	if (unused.length) lines.push('', `Declared but not contacted (yet): ${unused.join(', ')}`);
	if (rows.some((c) => !c.allowed)) {
		lines.push(
			'',
			'Add blocked hosts to network.domains in manifest.json, if the app really needs them.'
		);
	}
	return lines.join('\n');
}

async function restart(harness: Harness) {
	await harness.stop();
	harness.reset();
	await harness.start();
	await harness.settle(1500);
	return 'restarted';
}

const COMMANDS: Record<string, Command> = {
	'': () => '',
	help: () => HELP,
	'?': () => HELP,
	status,
	dashboard: (h) =>
		h.dashboard.current ? renderDashboard(h.dashboard.current) : 'No dashboard published yet.',
	screen,
	event,
	stream,
	next: sessionRequest('app/resolveNext', 'next <sessionId> [context]', true),
	skip: sessionRequest('app/resolveSkipSegments', 'skip <sessionId>'),
	live: sessionRequest('app/resolveLiveStatus', 'live <sessionId>'),
	chat,
	chatlog: (h) => (h.chat.length ? json(h.chat.slice(-5)) : 'No chat messages yet.'),
	refresh,
	locale: (h, { arg }) => {
		if (!arg(0)) return 'Usage: locale <bcp47 tag>';
		h.notify('host/locale', { locale: arg(0) });
		return 'sent';
	},
	ping,
	call,
	send,
	domains,
	problems: (h) =>
		h.problems.length ? h.problems.map((p) => `✗ ${p.message}`).join('\n') : 'No problems.',
	logs: (h, { arg }) => h.logs.slice(-(Number(arg(0)) || 30)).join('\n') || '(no output on stderr)',
	restart
};

export function executeCommand(harness: Harness, line: string): Promise<string> {
	const [name = '', ...rest] = line.trim().split(/\s+/);
	const command = COMMANDS[name];
	if (!command) return Promise.resolve(`Unknown command "${name}". Type help.`);
	// A command may throw synchronously (bad JSON in `call`), which becomes a rejection here.
	return Promise.resolve().then(() =>
		command(harness, {
			rest,
			arg: (i) => rest[i],
			tail: (i) => rest.slice(i).join(' ') || undefined
		})
	);
}
