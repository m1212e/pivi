// Production entry point for the pivi server. Replaces adapter-node's own
// `build/index.js`, which only ever opens one listener.
//
// Pivi serves two very different audiences from one SvelteKit app:
//
//   - the TV shell (`/`, `/home`, `/apps/*`, `/play/*`, `/api/graphql`, …),
//     which is for the kiosk browser on this machine and nobody else
//   - the phone remote (`/remote/<pairing token>`), which has to be reachable
//     from any phone on the LAN
//
// Exposing one listener to the network would put the whole TV shell and the
// GraphQL endpoint on the wifi alongside the remote. So this opens two:
// a loopback listener that serves everything, and a LAN listener that serves
// only the handful of paths the remote page actually needs, 404ing the rest.
// Both share the same request handler, so there's no proxy hop, no second
// copy of the app, and no way for the two to drift apart.
//
// The LAN listener binds the machine's LAN address specifically rather than
// 0.0.0.0, which lets it reuse the *same port number* as the loopback one.
// That matters: `src/hooks.server.ts` builds the pairing QR's URL from
// `event.url.port`, taken from the request the TV made on loopback. Same port
// on both listeners means that URL is correct for the phone as-is.

import http from 'node:http';
import { networkInterfaces } from 'node:os';
import process from 'node:process';
import { handler } from '../build/handler.js';

// How long in-flight requests get before the process exits regardless. Kept
// short because, per the comment in shutdown(), this delay is paid on every
// stop rather than only on a busy one.
const SHUTDOWN_GRACE_MS = 5_000;

/**
 * Paths the phone remote is allowed to reach over the LAN.
 *
 * `/remote/...` covers both the page itself and its PWA assets (manifest,
 * service worker, icons — `static/remote/`). `/_app/immutable/...` is the
 * client bundle, `/_app/version.json` is what SvelteKit polls for its
 * version check.
 *
 * Deliberately NOT included:
 *   - `/_app/remote/...`, SvelteKit's remote-function endpoint. The remote
 *     page is entirely client-side (it talks to the TV over the pairing
 *     WebSocket, see src/lib/pairing/session.ts), so it never calls one, and
 *     leaving the endpoint open would hand the LAN every query in
 *     src/api/handlers/.
 *   - `/api/graphql` and the `/api/stream*` routes, for the same reason.
 *
 * If the remote ever does need server data, add the specific path here rather
 * than widening these patterns, and re-check ALLOWED_METHODS below.
 */
const ALLOWED_PATHS = [/^\/remote(?:\/|$)/, /^\/_app\/immutable\//, /^\/_app\/version\.json$/];

// The remote only ever reads. Refusing everything else means a stray POST to
// an allowed path can't reach a form action or command handler.
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

function isRemoteRequest(req) {
	if (!ALLOWED_METHODS.has(req.method)) return false;
	// Query string and fragment are irrelevant to the decision, and `req.url`
	// is always an origin-form path here (Node rejects anything else for a
	// plain HTTP server).
	const pathname = req.url.split(/[?#]/, 1)[0];
	return ALLOWED_PATHS.some((pattern) => pattern.test(pathname));
}

function lanAddress() {
	// Same rule as src/api/lan.ts, which is what puts the address into the QR
	// code — these two have to agree on which interface is "the" LAN one.
	const interfaces = Object.values(networkInterfaces()).flat();
	return interfaces.find((iface) => iface?.family === 'IPv4' && !iface.internal)?.address ?? null;
}

function env(name, fallback) {
	const value = process.env[name];
	return value === undefined || value === '' ? fallback : value;
}

function port(name, fallback) {
	const raw = env(name, String(fallback));
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
		throw new Error(`${name} must be a port number, got ${JSON.stringify(raw)}`);
	}
	return parsed;
}

function notFound(res) {
	res.statusCode = 404;
	res.end();
}

function createServer({ filter }) {
	return http.createServer((req, res) => {
		if (filter && !filter(req)) return notFound(res);
		handler(req, res, () => notFound(res));
	});
}

function listen(server, host, portNumber, label) {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen({ host, port: portNumber }, () => {
			server.off('error', reject);
			console.log(`pivi: ${label} listening on http://${host}:${portNumber}`);
			resolve();
		});
	});
}

const internalHost = env('PIVI_HOST', '127.0.0.1');
const internalPort = port('PIVI_PORT', 3000);
const remotePort = port('PIVI_REMOTE_PORT', internalPort);

const internal = createServer({ filter: null });
await listen(internal, internalHost, internalPort, 'TV shell (local only)');

if (remotePort !== internalPort) {
	// See the header comment: the QR code's port comes from the TV's own
	// request, so it will advertise internalPort no matter what this is.
	console.warn(
		`pivi: PIVI_REMOTE_PORT (${remotePort}) differs from PIVI_PORT (${internalPort}). ` +
			'The pairing QR code advertises the latter, so phones will scan an unreachable ' +
			'URL unless something else forwards it.'
	);
}

// The address the phone-remote listener is bound to is not stable for the life
// of the process, which is why this is a poll rather than one-shot detection at
// startup:
//
//   - wifi provisioning (src/api/wifiCommands.ts) means the device may boot with
//     no network at all, raise its own access point (putting it on 10.42.0.1),
//     and then join a real network minutes later on a completely different
//     address. The remote has to be reachable at every step — that AP *is* how
//     the phone reaches it to do the provisioning in the first place.
//   - a DHCP lease can change under a long-running device.
//
// An explicit PIVI_REMOTE_HOST still wins, and then this settles immediately and
// never rebinds: it is the escape hatch for a fixed address, a second NIC, or
// 0.0.0.0 in a container with its own network namespace.
const REMOTE_SYNC_INTERVAL_MS = 3_000;

/** @type {{ server: import('node:http').Server, host: string } | null} */
let remote = null;
let syncing = false;
let warnedAboutMissingAddress = false;

function desiredRemoteHost() {
	return env('PIVI_REMOTE_HOST', lanAddress());
}

async function syncRemoteListener() {
	// listen() is async, and the interval keeps firing while it is in flight —
	// without this guard a slow bind could be raced into two listeners.
	if (syncing || shuttingDown) return;
	syncing = true;
	try {
		await rebindIfNeeded(desiredRemoteHost());
	} finally {
		syncing = false;
	}
}

function boundTo(desired) {
	return desired === (remote?.host ?? null);
}

function unbindRemote() {
	if (!remote) return;
	console.log(`pivi: phone remote no longer reachable on ${remote.host}, unbinding`);
	remote.server.closeAllConnections();
	remote.server.close();
	remote = null;
}

// Only once per stretch of having no address: this runs every few seconds, and a
// device sitting on a setup screen would otherwise fill the journal.
function warnMissingAddress() {
	if (warnedAboutMissingAddress) return;
	warnedAboutMissingAddress = true;
	console.warn(
		'pivi: no non-loopback IPv4 address yet — the phone remote is not being served. ' +
			'Set PIVI_REMOTE_HOST explicitly if this machine reaches the LAN some other way.'
	);
}

async function bindRemote(desired) {
	const server = createServer({ filter: isRemoteRequest });
	try {
		await listen(server, desired, remotePort, 'phone remote (LAN)');
		remote = { server, host: desired };
	} catch (error) {
		// An address that appeared in the interface list but can't be bound yet
		// (still tentative, or the old listener hasn't fully let go) is normal
		// during a transition — the next tick tries again.
		console.warn(`pivi: could not bind the phone remote to ${desired}: ${error.message}`);
		server.close();
	}
}

async function rebindIfNeeded(desired) {
	if (boundTo(desired)) return;
	unbindRemote();
	if (desired === null) return warnMissingAddress();
	warnedAboutMissingAddress = false;
	await bindRemote(desired);
}

let shuttingDown = false;

function activeServers() {
	return remote ? [internal, remote.server] : [internal];
}

await syncRemoteListener();
const remoteSyncTimer = setInterval(() => void syncRemoteListener(), REMOTE_SYNC_INTERVAL_MS);

function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`pivi: ${signal} received, shutting down`);

	clearInterval(remoteSyncTimer);
	for (const server of activeServers()) {
		server.closeIdleConnections();
		server.close();
	}

	// Closing the HTTP listeners is not enough to end the process: the pairing
	// relay holds a WebSocketServer of its own (src/api/ws/relay.ts, started as
	// a side effect of the first request that loads the GraphQL handler) and
	// nothing closes it, so the event loop stays alive indefinitely. Left alone
	// that turns every `systemctl restart` into a SIGTERM timeout followed by a
	// SIGKILL. So give in-flight requests the grace period, then exit for real.
	//
	// `unref` keeps this from *holding* the process open — if there is nothing
	// else running, the process still exits immediately rather than waiting.
	const force = setTimeout(() => {
		for (const server of activeServers()) server.closeAllConnections();
		process.exit(0);
	}, SHUTDOWN_GRACE_MS);
	force.unref();

	// The app registers cleanup on this (see adapter-node's docs — it's what
	// `build/index.js` emits too), e.g. the pairing relay's socket teardown.
	process.emit('sveltekit:shutdown', signal);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
