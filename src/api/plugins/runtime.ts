// The plugin host: talks to one running plugin over the JSON-RPC protocol in
// src/lib/plugins/host.ts, carried on the stdin/stdout of the sandboxed process
// (src/api/plugins/sandbox). Everything here treats the plugin as untrusted: its
// messages are schema-checked, anything it publishes that it didn't declare in
// its manifest is dropped, and URLs it hands back are held to the domains that
// manifest declared.
//
// What a plugin may *do* isn't decided here — that's the sandbox it was started
// in (network, storage, cache). This file decides what the host will *believe*
// and *forward* from it.
//
// The bare vscode-jsonrpc package, not a /node subpath — see rpcRal.ts for why
// (its conditional-only export doesn't resolve consistently under this
// project's Vite setup); ensureRal() installs the RAL createMessageConnection
// needs.
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc';
import { ensureRal } from '#lib/rpcRal';
import { PushMessageReader, SinkMessageWriter } from '#lib/rpcTransport';
import { encodeMessage, LineSplitter } from '#lib/plugins/ndjson';
import {
	domainsAllow,
	type Feature,
	type PermissionKey,
	type PluginManifest
} from '#lib/plugins/manifest';
import type { DashboardContribution } from '#lib/plugins/dashboard';
import type { PluginScreen, UiEvent } from '#lib/plugins/ui';
import {
	activateNotification,
	getPublicOriginRequest,
	oauthCodeNotification,
	oauthCodeParamsSchema,
	pluginAuthSchema,
	publicOriginResultSchema,
	publishAuthNotification,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	readyParamsSchema,
	resolvedStreamSchema,
	resolveSkipSegmentsRequest,
	resolveSkipSegmentsResultSchema,
	resolveStreamRequest,
	shutdownNotification,
	SUPPORTED_PROTOCOLS,
	uiEventNotification,
	type ResolvedStream,
	type SkipSegment
} from '#lib/plugins/host';
import { dashboardContributionSchema } from '#lib/plugins/dashboard';
import { pluginScreenSchema } from '#lib/plugins/ui';
import { openUrlNotification } from '#lib/pairing/remoteProtocol';
import { getLanAddress } from '../lan';
import { sendToPhones } from '../ws/relay';
import { sanitizeDashboard, sanitizeScreen } from './sanitize';
import type { RunningSandbox, SandboxHandlers } from './sandbox/types';

export type PluginAuth = ReturnType<typeof pluginAuthSchema.parse>;

export type PluginInstance = {
	manifest: PluginManifest;
	getDashboard(): DashboardContribution | undefined;
	getScreen(screenId: string): PluginScreen | undefined;
	getAuth(): PluginAuth | undefined;
	sendUiEvent(event: UiEvent): void;
	deliverOAuthCode(code: string, state: string): void;
	resolveStream(sessionId: string, maxHeight?: number): Promise<ResolvedStream>;
	resolveSkipSegments(sessionId: string): Promise<SkipSegment[]>;
	// Whether the host may fetch (or show) a URL this plugin supplied: the
	// plugin has to have been granted network, and the URL has to be on one of
	// the domains its manifest declared. Anything else is the plugin trying to
	// make the host reach somewhere the user never allowed.
	allowsUrl(url: string): boolean;
	dispose(): Promise<void>;
};

export type PluginUpdateKind = 'dashboard' | 'auth' | 'screen';

export type LoadPluginOptions = {
	manifest: PluginManifest;
	granted: readonly PermissionKey[];
	// Boots the sandbox and wires its streams to the given handlers.
	start: (handlers: SandboxHandlers) => Promise<RunningSandbox>;
	// Lets a caller (manager.ts) push changes onto a real GraphQL subscription
	// instead of the frontend having to poll for them.
	onUpdate?: (kind: PluginUpdateKind, screenId?: string) => void;
	// The process ended without being asked to (a crash, an OOM kill).
	onCrash?: (code: number | null) => void;
};

// How long a plugin gets to say it's ready. Generous: it includes booting the
// VM and the plugin's own startup.
const READY_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 2_000;
const MAX_LOG_LINE = 2_000;

function hasFeature(manifest: PluginManifest, feature: Feature): boolean {
	return manifest.features.includes(feature);
}

function urlAllowed(
	manifest: PluginManifest,
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

// stderr is the plugin's log. Line-buffered, and each line capped, so a
// misbehaving plugin can't flood the host's own log.
function createStderrLogger(pluginId: string) {
	const splitter = new LineSplitter(MAX_LOG_LINE * 4);
	return (chunk: Uint8Array) => {
		try {
			for (const line of splitter.push(chunk)) {
				console.error(`[plugin:${pluginId}] ${line.slice(0, MAX_LOG_LINE)}`);
			}
		} catch {
			console.error(`[plugin:${pluginId}] (log line too long, dropped)`);
		}
	};
}

type PublishedState = {
	dashboard?: DashboardContribution;
	screens: Map<string, PluginScreen>;
	auth?: PluginAuth;
};

function wireNotifications(
	connection: MessageConnection,
	options: LoadPluginOptions,
	published: PublishedState,
	onReady: (protocol: number) => void
) {
	const { manifest, granted, onUpdate } = options;
	const allows = (url: string) => urlAllowed(manifest, granted, url);
	const drop = (what: string) =>
		console.warn(`[plugin:${manifest.id}] ignored ${what}: not declared in its manifest`);

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
		const parsed = pluginScreenSchema.safeParse(raw);
		if (!parsed.success) return;
		const screen = sanitizeScreen(parsed.data, allows);
		published.screens.set(screen.screenId, screen);
		onUpdate?.('screen', screen.screenId);
	});

	connection.onNotification(publishAuthNotification, (raw) => {
		if (!hasFeature(manifest, 'auth')) return drop('a sign-in');
		const parsed = pluginAuthSchema.safeParse(raw);
		if (!parsed.success) return;
		published.auth = parsed.data;
		onUpdate?.('auth');

		// A PhoneAuthHandoff (as opposed to a DeviceCodeAuth) means the phone itself
		// needs to complete the login — push it straight to whatever's currently
		// paired. Routing the resulting code back to this plugin once the redirect
		// lands needs nothing registered here: the plugin's own `state` is
		// namespaced with its id, so src/routes/oauth/callback can find the right
		// running plugin through the manager.
		if ('loginUrl' in parsed.data) {
			sendToPhones({
				jsonrpc: '2.0',
				method: openUrlNotification.method,
				params: { url: parsed.data.loginUrl }
			});
		}
	});

	connection.onRequest(getPublicOriginRequest, () => {
		if (!hasFeature(manifest, 'auth')) throw new Error('Not available to this plugin');
		// Dev-only fallback port — a real deployment sets PORT.
		const port = process.env.PORT ?? '5173';
		const host = getLanAddress() ?? 'localhost';
		return publicOriginResultSchema.parse({ origin: `http://${host}:${port}` });
	});
}

export async function loadPlugin(options: LoadPluginOptions): Promise<PluginInstance> {
	const { manifest, granted } = options;
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
	// A rejection nobody awaits yet (the sandbox dying before loadPlugin reaches
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
						console.warn(`[plugin:${manifest.id}] dropped an unparsable protocol line`);
					}
				}
			} catch {
				console.error(`[plugin:${manifest.id}] message too large; stopping it`);
				void sandbox.stop();
			}
		},
		onStderr: logStderr,
		onExit(code) {
			markExited();
			reader.close();
			if (!readySettled) rejectReady(new Error(`Plugin exited before it was ready (${code})`));
			if (!disposing) options.onCrash?.(code);
		}
	});

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
		() => rejectReady(new Error('Plugin never became ready')),
		READY_TIMEOUT_MS
	);
	try {
		const protocol = await ready;
		if (!SUPPORTED_PROTOCOLS.includes(protocol) || protocol !== manifest.protocol) {
			throw new Error(`Plugin speaks protocol ${protocol}, its manifest says ${manifest.protocol}`);
		}
	} catch (error) {
		disposing = true;
		connection.dispose();
		await sandbox.stop().catch(() => {});
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	connection.sendNotification(activateNotification);

	return {
		manifest,
		getDashboard: () => published.dashboard,
		getScreen: (screenId) => published.screens.get(screenId),
		getAuth: () => published.auth,
		allowsUrl: (url) => urlAllowed(manifest, granted, url),

		sendUiEvent(event) {
			if (hasFeature(manifest, 'screen')) connection.sendNotification(uiEventNotification, event);
		},

		deliverOAuthCode(code, state) {
			if (!hasFeature(manifest, 'auth')) return;
			connection.sendNotification(
				oauthCodeNotification,
				oauthCodeParamsSchema.parse({ code, state })
			);
		},

		async resolveStream(sessionId, maxHeight) {
			if (!hasFeature(manifest, 'playback')) throw new Error('This plugin cannot play media');
			return resolvedStreamSchema.parse(
				await connection.sendRequest(resolveStreamRequest, { sessionId, maxHeight })
			);
		},

		async resolveSkipSegments(sessionId) {
			if (!hasFeature(manifest, 'skipSegments')) return [];
			try {
				const result = await connection.sendRequest(resolveSkipSegmentsRequest, { sessionId });
				return resolveSkipSegmentsResultSchema.parse(result).segments;
			} catch {
				// A failing or malformed answer is treated as nothing to report.
				return [];
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
