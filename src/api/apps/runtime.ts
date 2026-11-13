// The app host: talks to one running app over the JSON-RPC protocol in
// sdk/protocol.ts, carried on the stdin/stdout of the sandboxed process
// (src/api/apps/sandbox). Everything here treats the app as untrusted: its
// messages are schema-checked, anything it publishes that it didn't declare in
// its manifest is dropped, and URLs it hands back are held to the domains that
// manifest declared.
//
// What an app may *do* isn't decided here. That's the sandbox it was started
// in (network, storage, cache). This file decides what the host will *believe*
// and *forward* from it.
//
// The bare vscode-jsonrpc package, not a /node subpath. See rpcRal.ts for why
// (its conditional-only export doesn't resolve consistently under this
// project's Vite setup), and ensureRal() installs the RAL createMessageConnection
// needs.
import { getHostLocale } from './hostLocale';
import {
	CancellationTokenSource,
	createMessageConnection,
	type MessageConnection,
	type RequestParam,
	type RequestType
} from 'vscode-jsonrpc';
import { ensureRal } from '#sdk/rpcRal';
import { PushMessageReader, SinkMessageWriter } from '#sdk/rpcTransport';
import { encodeMessage, LineSplitter } from '#sdk/ndjson';
import { domainsAllow, type Feature, type PermissionKey, type AppManifest } from '#sdk/manifest';
import type { DashboardContribution } from '#sdk/dashboard';
import type { AppScreen, UiEvent } from '#sdk/ui';
import {
	activateNotification,
	localeNotification,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	readyParamsSchema,
	resolvedStreamSchema,
	resolveNextRequest,
	resolveNextResultSchema,
	resolveSkipSegmentsRequest,
	resolveSkipSegmentsResultSchema,
	resolveStreamRequest,
	shutdownNotification,
	SUPPORTED_PROTOCOLS,
	uiEventNotification,
	type ResolvedStream,
	type SkipSegment
} from '#sdk/protocol';
import { dashboardContributionSchema } from '#sdk/dashboard';
import { appScreenSchema } from '#sdk/ui';
import { sanitizeDashboard, sanitizeScreen } from './sanitize';
import type { RunningSandbox, SandboxHandlers } from './sandbox/types';

/**
 * A running app as handed out by manager.ts's getApp to the screen, playback
 * and stream code. Everything crossing it is already validated and filtered,
 * so callers never touch the raw protocol.
 */
export type AppInstance = {
	manifest: AppManifest;
	getDashboard(): DashboardContribution | undefined;
	getScreen(screenId: string): AppScreen | undefined;
	sendUiEvent(event: UiEvent): void;
	setLocale(locale: string): void;
	resolveStream(sessionId: string, maxHeight?: number): Promise<ResolvedStream>;
	resolveSkipSegments(sessionId: string): Promise<SkipSegment[]>;
	resolveNext(sessionId: string, context: string): Promise<string | undefined>;
	// Whether the host may fetch (or show) a URL this app supplied: the
	// app has to have been granted network, and the URL has to be on one of
	// the domains its manifest declared. Anything else is the app trying to
	// make the host reach somewhere the user never allowed.
	allowsUrl(url: string): boolean;
	dispose(): Promise<void>;
};

/** What changed, so subscribers only refetch the part that did. */
export type AppUpdateKind = 'dashboard' | 'screen';

/**
 * Keeps this module to the protocol alone. Booting the sandbox and publishing
 * updates are wired in by manager.ts (and by the sandbox e2e test).
 */
export type LoadAppOptions = {
	manifest: AppManifest;
	granted: readonly PermissionKey[];
	// Boots the sandbox and wires its streams to the given handlers.
	start: (handlers: SandboxHandlers) => Promise<RunningSandbox>;
	// Lets a caller (manager.ts) push changes onto a real GraphQL subscription
	// instead of the frontend having to poll for them.
	onUpdate?: (kind: AppUpdateKind, screenId?: string) => void;
	// The process ended without being asked to (a crash, an OOM kill).
	onCrash?: (code: number | null) => void;
};

// How long an app gets to say it's ready. Generous: it includes booting the
// VM and the app's own startup.
const READY_TIMEOUT_MS = 60_000;
// How long a shutdown notification gets before the sandbox is killed anyway.
const SHUTDOWN_GRACE_MS = 2_000;
// Per log line, see createStderrLogger.
const MAX_LOG_LINE = 2_000;
// How long a request to the app may take before the host gives up on it, so a
// hung app can't hang the player or the stream routes waiting on it. Resolving
// a stream runs the app's own extractor, which is the slow one.
const RESOLVE_STREAM_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 15_000;
// Distinct screens an app may keep published, so it can't grow host memory by
// publishing under ever new ids.
const MAX_SCREENS = 32;

function hasFeature(manifest: AppManifest, feature: Feature): boolean {
	return manifest.features.includes(feature);
}

// Same rule for the app's own requests and the host's, so an app can't use the
// host to reach a domain it was never allowed to.
function urlAllowed(
	manifest: AppManifest,
	granted: readonly PermissionKey[],
	rawUrl: string
): boolean {
	if (!granted.includes('network') || !manifest.network) return false;
	try {
		const url = new URL(rawUrl);
		return (
			(url.protocol === 'https:' || url.protocol === 'http:') &&
			domainsAllow(manifest.network.domains, url.hostname)
		);
	} catch {
		return false;
	}
}

// Cancels the request on the app's side too, so it can stop the work.
async function requestWithTimeout<P, R>(
	connection: MessageConnection,
	type: RequestType<P, R, void>,
	params: P,
	timeoutMs: number
): Promise<unknown> {
	const cancellation = new CancellationTokenSource();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			cancellation.cancel();
			reject(new Error(`${type.method} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});
	try {
		// Same cast as #lib/rpc's: `RequestParam<P>` can't resolve against a generic P.
		const request = connection.sendRequest(type, params as RequestParam<P>, cancellation.token);
		return await Promise.race([request, timeout]);
	} finally {
		clearTimeout(timer);
		cancellation.dispose();
	}
}

// stderr is the app's log. Line-buffered, and each line capped, so a
// misbehaving app can't flood the host's own log.
function createStderrLogger(appId: string) {
	const splitter = new LineSplitter(MAX_LOG_LINE * 4);
	return (chunk: Uint8Array) => {
		try {
			for (const line of splitter.push(chunk)) {
				console.error(`[app:${appId}] ${line.slice(0, MAX_LOG_LINE)}`);
			}
		} catch {
			console.error(`[app:${appId}] (log line too long, dropped)`);
		}
	};
}

// Latest accepted publish per kind, served to the UI without asking the app.
type PublishedState = {
	dashboard?: DashboardContribution;
	screens: Map<string, AppScreen>;
};

// The app's inbound side. Each handler validates first and ignores what fails,
// since the app is untrusted and a bad message must not take the host down.
function wireNotifications(
	connection: MessageConnection,
	options: LoadAppOptions,
	published: PublishedState,
	onReady: (protocol: number) => void
) {
	const { manifest, granted, onUpdate } = options;
	const allows = (url: string) => urlAllowed(manifest, granted, url);
	const drop = (what: string) =>
		console.warn(`[app:${manifest.id}] ignored ${what}: not declared in its manifest`);

	connection.onNotification(readyNotification, (raw) => {
		const parsed = readyParamsSchema.safeParse(raw);
		if (parsed.success) onReady(parsed.data.protocol);
	});

	connection.onNotification(publishDashboardNotification, (raw) => {
		if (!hasFeature(manifest, 'dashboard')) return drop('a dashboard');
		const parsed = dashboardContributionSchema.safeParse(raw);
		if (!parsed.success) return;
		published.dashboard = sanitizeDashboard(parsed.data, allows);
		onUpdate?.('dashboard');
	});

	connection.onNotification(publishScreenNotification, (raw) => {
		if (!hasFeature(manifest, 'screen')) return drop('a screen');
		const parsed = appScreenSchema.safeParse(raw);
		if (!parsed.success) return;
		const screen = sanitizeScreen(parsed.data, allows);
		if (!screen) return void console.warn(`[app:${manifest.id}] ignored an oversized screen`);
		const isNew = !published.screens.has(screen.screenId);
		if (isNew && published.screens.size >= MAX_SCREENS) {
			return void console.warn(
				`[app:${manifest.id}] ignored a screen past the ${MAX_SCREENS} limit`
			);
		}
		published.screens.set(screen.screenId, screen);
		onUpdate?.('screen', screen.screenId);
	});
}

/**
 * Called by manager.ts to start an app. Resolves only once it is ready and
 * speaks its manifest's protocol, and stops the sandbox otherwise, so callers
 * never get a half-started app.
 */
export async function loadApp(options: LoadAppOptions): Promise<AppInstance> {
	const { manifest, granted } = options;
	// Checked again here, not just at install: an app installed under an older
	// host can't even say `ready` in a protocol this one speaks, so it would
	// otherwise boot a VM only to time out.
	if (!SUPPORTED_PROTOCOLS.includes(manifest.protocol)) {
		throw new Error(`${manifest.id} speaks app protocol ${manifest.protocol}; update it`);
	}
	const published: PublishedState = { screens: new Map() };

	const reader = new PushMessageReader();

	let disposing = false;
	let readySettled = false;
	let resolveReady!: (protocol: number) => void;
	let rejectReady!: (error: Error) => void;
	const ready = new Promise<number>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	// A rejection nobody awaits yet (the sandbox dying before loadApp reaches
	// `await ready`) must not surface as an unhandled one.
	ready.catch(() => {});

	let markExited!: () => void;
	const exited = new Promise<void>((resolve) => (markExited = resolve));

	const logStderr = createStderrLogger(manifest.id);
	const splitter = new LineSplitter();

	const sandbox: RunningSandbox = await options.start({
		onStdout(chunk) {
			try {
				for (const line of splitter.push(chunk)) {
					try {
						reader.push(JSON.parse(line));
					} catch {
						console.warn(`[app:${manifest.id}] dropped an unparsable protocol line`);
					}
				}
			} catch {
				// The splitter throws when a line exceeds its cap, which is app misbehavior.
				console.error(`[app:${manifest.id}] message too large; stopping it`);
				void sandbox.stop();
			}
		},
		onStderr: logStderr,
		onExit(code) {
			markExited();
			reader.close();
			if (!readySettled) rejectReady(new Error(`App exited before it was ready (${code})`));
			if (!disposing) options.onCrash?.(code);
		}
	});

	// Write failures are ignored since a dead sandbox is reported through onExit.
	const writer = new SinkMessageWriter((message) => {
		sandbox.write(encodeMessage(message)).catch(() => {});
	});

	ensureRal();
	const connection = createMessageConnection(reader, writer);
	wireNotifications(connection, options, published, (protocol) => {
		readySettled = true;
		resolveReady(protocol);
	});
	connection.listen();

	const timeout = setTimeout(
		() => rejectReady(new Error('App never became ready')),
		READY_TIMEOUT_MS
	);
	try {
		const protocol = await ready;
		if (!SUPPORTED_PROTOCOLS.includes(protocol) || protocol !== manifest.protocol) {
			throw new Error(`App speaks protocol ${protocol}, its manifest says ${manifest.protocol}`);
		}
	} catch (error) {
		disposing = true;
		connection.dispose();
		await sandbox.stop().catch(() => {});
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	// Only now, so the app doesn't act on a locale before it has been vetted.
	connection.sendNotification(activateNotification, { locale: getHostLocale() });

	return {
		manifest,
		getDashboard: () => published.dashboard,
		getScreen: (screenId) => published.screens.get(screenId),
		allowsUrl: (url) => urlAllowed(manifest, granted, url),

		setLocale(locale) {
			connection.sendNotification(localeNotification, { locale });
		},

		sendUiEvent(event) {
			if (hasFeature(manifest, 'screen')) connection.sendNotification(uiEventNotification, event);
		},

		async resolveStream(sessionId, maxHeight) {
			if (!hasFeature(manifest, 'playback')) throw new Error('This app cannot play media');
			return resolvedStreamSchema.parse(
				await requestWithTimeout(
					connection,
					resolveStreamRequest,
					{ sessionId, maxHeight },
					RESOLVE_STREAM_TIMEOUT_MS
				)
			);
		},

		async resolveSkipSegments(sessionId) {
			if (!hasFeature(manifest, 'skipSegments')) return [];
			try {
				const result = await requestWithTimeout(
					connection,
					resolveSkipSegmentsRequest,
					{ sessionId },
					REQUEST_TIMEOUT_MS
				);
				return resolveSkipSegmentsResultSchema.parse(result).segments;
			} catch {
				// A failing or malformed answer is treated as nothing to report.
				return [];
			}
		},

		async resolveNext(sessionId, context) {
			if (!hasFeature(manifest, 'playback')) return undefined;
			try {
				const result = await requestWithTimeout(
					connection,
					resolveNextRequest,
					{ sessionId, context },
					REQUEST_TIMEOUT_MS
				);
				return resolveNextResultSchema.parse(result).sessionId;
			} catch {
				// Apps that don't sequence playback just don't answer.
				return undefined;
			}
		},

		async dispose() {
			if (disposing) return;
			disposing = true;
			connection.sendNotification(shutdownNotification);
			// Give it a moment to leave on its own before the sandbox is torn down.
			await Promise.race([
				exited,
				new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))
			]);
			connection.dispose();
			await sandbox.stop().catch(() => {});
		}
	};
}
