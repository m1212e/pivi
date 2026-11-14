// Live chat, read from Twitch's IRC gateway over a WebSocket, the same one
// the website uses. Reading needs no account: a `justinfan` nick is Twitch's
// anonymous read-only login. One connection serves every open chat, each a
// joined channel, and lines are passed on in batches (see chatMessages in
// sdk/protocol.ts) so a busy chat doesn't send a message per line.
import type { ChatBatch, ChatMessage, ChatRemovals } from '@pivi/sdk/protocol';

const GATEWAY = 'wss://irc-ws.chat.twitch.tv:443';
const FLUSH_MS = 300;
// More than the player shows from one batch, the rest of a burst is dropped.
const MAX_BATCH = 50;
const MAX_RECONNECT_MS = 30_000;

type Send = (sessionId: string, batch: ChatBatch) => void;

// `@k=v;k=v :prefix COMMAND params :trailing`, see the IRCv3 message tags spec.
type IrcLine = { tags: Map<string, string>; prefix?: string; command: string; params: string[] };

function unescapeTag(value: string): string {
	return value.replace(/\\(.)/g, (_match, char: string) =>
		char === 's' ? ' ' : char === ':' ? ';' : char === 'r' ? '\r' : char === 'n' ? '\n' : char
	);
}

/** One raw IRC line, undefined when it isn't one. */
export function parseIrcLine(raw: string): IrcLine | undefined {
	let rest = raw;
	const tags = new Map<string, string>();
	if (rest.startsWith('@')) {
		const end = rest.indexOf(' ');
		for (const pair of rest.slice(1, end).split(';')) {
			const eq = pair.indexOf('=');
			if (eq > 0) tags.set(pair.slice(0, eq), unescapeTag(pair.slice(eq + 1)));
		}
		rest = rest.slice(end + 1);
	}
	let prefix: string | undefined;
	if (rest.startsWith(':')) {
		const end = rest.indexOf(' ');
		prefix = rest.slice(1, end);
		rest = rest.slice(end + 1);
	}
	const trailingAt = rest.indexOf(' :');
	const head = trailingAt >= 0 ? rest.slice(0, trailingAt) : rest;
	const [command, ...params] = head.split(' ').filter(Boolean);
	if (!command) return undefined;
	if (trailingAt >= 0) params.push(rest.slice(trailingAt + 2));
	return { tags, prefix, command, params };
}

const emoteUrl = (id: string) =>
	`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`;

// The `emotes` tag lists `id:start-end,start-end/id:...`, positions in code
// points (not UTF-16 units) of the message text, end inclusive.
function emoteRanges(tag: string | undefined) {
	if (!tag) return [];
	return tag
		.split('/')
		.flatMap((entry) => {
			const [id, positions] = entry.split(':');
			return (positions ?? '').split(',').map((range) => {
				const [start, end] = range.split('-').map(Number);
				return { id, start, end };
			});
		})
		.filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end))
		.sort((a, b) => a.start - b.start);
}

/** Splits a message into text runs and emotes, from its `emotes` tag. */
export function messageParts(text: string, emotesTag: string | undefined): ChatMessage['parts'] {
	const chars = Array.from(text);
	const parts: ChatMessage['parts'] = [];
	let at = 0;
	for (const { id, start, end } of emoteRanges(emotesTag)) {
		if (start < at || end >= chars.length) continue;
		if (start > at) parts.push({ type: 'text', text: chars.slice(at, start).join('') });
		parts.push({ type: 'emote', name: chars.slice(start, end + 1).join(''), url: emoteUrl(id) });
		at = end + 1;
	}
	if (at < chars.length) parts.push({ type: 'text', text: chars.slice(at).join('') });
	return parts;
}

// `/me` messages arrive wrapped as a CTCP ACTION, between \x01 bytes.
const CTCP = '\u0001';
const ACTION_PREFIX = `${CTCP}ACTION `;
function stripAction(text: string): string {
	return text.startsWith(ACTION_PREFIX) && text.endsWith(CTCP)
		? text.slice(ACTION_PREFIX.length, -1)
		: text;
}

/** A PRIVMSG as the player shows it, undefined for anything else. */
export function toChatMessage(
	line: IrcLine
): { channel: string; message: ChatMessage } | undefined {
	if (line.command !== 'PRIVMSG' || line.params.length < 2) return undefined;
	const channel = line.params[0].replace(/^#/, '');
	const text = stripAction(line.params[1]);
	const nick = line.prefix?.split('!')[0] ?? '';
	const color = line.tags.get('color');
	return {
		channel,
		message: {
			id: line.tags.get('id') || `${nick}:${Date.now()}:${Math.random()}`,
			author: line.tags.get('display-name') || nick,
			authorId: line.tags.get('user-id') || undefined,
			color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined,
			parts: messageParts(text, line.tags.get('emotes'))
		}
	};
}

/**
 * A moderator's action as a removal: CLEARMSG deletes one message, CLEARCHAT
 * with a user times them out or bans them (all their lines go), CLEARCHAT
 * without one clears the chat. Undefined for any other line.
 */
export function toRemoval(line: IrcLine): { channel: string; removed: ChatRemovals } | undefined {
	const channel = line.params[0]?.replace(/^#/, '');
	if (!channel) return undefined;
	if (line.command === 'CLEARMSG') {
		const id = line.tags.get('target-msg-id');
		return id ? { channel, removed: { ids: [id] } } : undefined;
	}
	if (line.command !== 'CLEARCHAT') return undefined;
	if (line.params.length < 2) return { channel, removed: { all: true } };
	const userId = line.tags.get('target-user-id');
	return userId ? { channel, removed: { authorIds: [userId] } } : undefined;
}

// Folds a removal into a batch that hasn't gone out yet: its own lines that
// are affected are dropped here, the removal itself still goes out for lines
// already sent.
function addRemoval(batch: ChatBatch, removed: ChatRemovals) {
	const ids = new Set(removed.ids ?? []);
	const authors = new Set(removed.authorIds ?? []);
	batch.messages = removed.all
		? []
		: batch.messages.filter(
				(message) => !ids.has(message.id) && !(message.authorId && authors.has(message.authorId))
			);
	const have = batch.removed ?? {};
	batch.removed = {
		ids: [...(have.ids ?? []), ...ids].slice(-MAX_BATCH),
		authorIds: [...(have.authorIds ?? []), ...authors].slice(-MAX_BATCH),
		all: have.all || removed.all || undefined
	};
}

/** Keeps the joined channels in step with the chats the host has open. */
export function createChat(send: Send) {
	// Joined channel (lowercase, as IRC reports it) to the session id the host
	// opened it under, which is what batches have to carry.
	const channels = new Map<string, string>();
	const pending = new Map<string, ChatBatch>();
	let socket: WebSocket | undefined;
	let retryMs = 1000;
	let flushTimer: ReturnType<typeof setInterval> | undefined;

	function flush() {
		for (const [channel, batch] of pending) {
			const sessionId = channels.get(channel);
			if (sessionId && (batch.messages.length || batch.removed)) send(sessionId, batch);
		}
		pending.clear();
	}

	function onLine(raw: string) {
		const line = parseIrcLine(raw);
		if (!line) return;
		if (line.command === 'PING') return socket?.send(`PONG :${line.params[0] ?? ''}`);
		const parsed = toChatMessage(line) ?? toRemoval(line);
		if (!parsed || !channels.has(parsed.channel)) return;
		const batch = pending.get(parsed.channel) ?? { messages: [] };
		pending.set(parsed.channel, batch);
		if ('removed' in parsed) return addRemoval(batch, parsed.removed);
		batch.messages = [...batch.messages, parsed.message].slice(-MAX_BATCH);
	}

	function connect() {
		const ws = new WebSocket(GATEWAY);
		socket = ws;
		ws.addEventListener('open', () => {
			retryMs = 1000;
			ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
			ws.send('PASS SCHMOOPIIE');
			ws.send(`NICK justinfan${Math.floor(10_000 + Math.random() * 80_000)}`);
			for (const channel of channels.keys()) ws.send(`JOIN #${channel}`);
		});
		ws.addEventListener('message', (event) => {
			for (const raw of String(event.data).split('\r\n')) if (raw) onLine(raw);
		});
		ws.addEventListener('close', () => {
			if (socket !== ws) return;
			socket = undefined;
			if (channels.size === 0) return;
			console.error(`[warn] chat connection closed, reconnecting in ${retryMs}ms`);
			setTimeout(() => channels.size > 0 && !socket && connect(), retryMs);
			retryMs = Math.min(retryMs * 2, MAX_RECONNECT_MS);
		});
		ws.addEventListener('error', () => console.error('[error] chat connection failed'));
	}

	function stopIfIdle() {
		if (channels.size > 0) return;
		clearInterval(flushTimer);
		flushTimer = undefined;
		const ws = socket;
		socket = undefined;
		ws?.close();
	}

	return {
		open(sessionId: string) {
			const channel = sessionId.toLowerCase();
			if (channels.has(channel)) return;
			channels.set(channel, sessionId);
			flushTimer ??= setInterval(flush, FLUSH_MS);
			if (!socket) connect();
			else if (socket.readyState === WebSocket.OPEN) socket.send(`JOIN #${channel}`);
		},
		close(sessionId: string) {
			const channel = sessionId.toLowerCase();
			if (!channels.delete(channel)) return;
			pending.delete(channel);
			if (socket?.readyState === WebSocket.OPEN) socket.send(`PART #${channel}`);
			stopIfIdle();
		}
	};
}
