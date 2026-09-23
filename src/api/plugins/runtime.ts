// The actual plugin host: spawns a plugin's entry point as a child process
// and talks to it over the JSON-RPC contract in src/lib/plugins/host.ts.
// This is the first real implementation of SKETCH.md's "one child process
// per plugin, RPC boundary, capability manifest" decision — until now only
// the contract types existed.
import { spawn, type ChildProcess } from 'node:child_process';
// The bare package, not a /node subpath — see rpcRal.ts for why (its
// conditional-only export doesn't resolve consistently under this
// project's Vite setup). ensureRal() below installs the RAL
// createMessageConnection needs, which that subpath would otherwise have
// done as a side effect of importing it.
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc';
import { ensureRal } from '#lib/rpcRal';
import { PushMessageReader, SinkMessageWriter } from '#lib/rpcTransport';
import type { PluginManifest } from '#lib/plugins/manifest';
import type { DashboardContribution } from '#lib/plugins/dashboard';
import type { PluginScreen, UiEvent } from '#lib/plugins/ui';
import {
	activateNotification,
	credentialGetRequest,
	credentialGetResultSchema,
	credentialSetParamsSchema,
	credentialSetRequest,
	getPublicOriginRequest,
	httpRequestParamsSchema,
	httpRequestRequest,
	httpResponseResultSchema,
	logNotification,
	logParamsSchema,
	oauthCodeNotification,
	pluginAuthSchema,
	profileChangedNotification,
	publicOriginResultSchema,
	publishAuthNotification,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	resolvedStreamSchema,
	resolveSkipSegmentsRequest,
	resolveStreamRequest,
	shutdownNotification,
	uiEventNotification,
	type ResolvedStream,
	type SkipSegment
} from '#lib/plugins/host';
import { dashboardContributionSchema } from '#lib/plugins/dashboard';
import { pluginManifestSchema } from '#lib/plugins/manifest';
import { pluginScreenSchema } from '#lib/plugins/ui';
import { openUrlNotification } from '#lib/pairing/remoteProtocol';
import { getActiveProfileUser, onActiveProfileChanged } from '../activeProfile';
import { getLanAddress } from '../lan';
import { sendToPhones } from '../ws/relay';
import { getPluginCredential, setPluginCredential } from './credentials';

export type PluginInstance = {
	manifest: PluginManifest;
	getDashboard(): DashboardContribution | undefined;
	getScreen(screenId: string): PluginScreen | undefined;
	getAuth(): ReturnType<typeof pluginAuthSchema.parse> | undefined;
	sendUiEvent(event: UiEvent): void;
	deliverOAuthCode(code: string, state: string): void;
	resolveStream(sessionId: string, maxHeight?: number): Promise<ResolvedStream>;
	resolveSkipSegments(sessionId: string): Promise<SkipSegment[]>;
	dispose(): void;
};

function hostAllowsDomain(manifest: PluginManifest, url: string): boolean {
	const { hostname } = new URL(url);
	return manifest.capabilities.some(
		(c) =>
			c.type === 'network' && c.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`))
	);
}

export type PluginUpdateKind = 'dashboard' | 'auth' | 'screen';

export async function loadPlugin(
	entryPath: string,
	// Lets a caller (manager.ts) push these onto a real GraphQL subscription
	// (src/api/plugins/pubsub.ts) instead of the frontend having to poll for
	// changes — this is the seam that makes that possible for any plugin,
	// not just YouTube.
	onUpdate?: (kind: PluginUpdateKind, screenId?: string) => void
): Promise<PluginInstance> {
	// Not node:child_process's `fork` — its default execPath resolved to a
	// plain Node binary in dev even though the app itself runs under Bun,
	// and plain Node can't resolve the extensionless `#lib/*` subpath
	// imports (package.json's "imports" field) the way Bun does. Spawning
	// `bun run` explicitly, with an `ipc` stdio slot, gets the exact same
	// send()/on('message') channel `fork` would have given us.
	const child: ChildProcess = spawn('bun', ['run', entryPath], {
		stdio: ['ignore', 'inherit', 'inherit', 'ipc']
	});

	const reader = new PushMessageReader();
	const writer = new SinkMessageWriter((msg) => child.send(msg));
	child.on('message', (msg) => reader.push(msg as never));
	child.on('exit', () => reader.close());

	ensureRal();
	const connection: MessageConnection = createMessageConnection(reader, writer);

	let manifest: PluginManifest | undefined;
	let dashboard: DashboardContribution | undefined;
	const screens = new Map<string, PluginScreen>();
	let auth: ReturnType<typeof pluginAuthSchema.parse> | undefined;

	const ready = new Promise<PluginManifest>((resolve) => {
		connection.onNotification(readyNotification, (raw) => {
			manifest = pluginManifestSchema.parse(raw);
			resolve(manifest);
		});
	});

	connection.onNotification(publishDashboardNotification, (raw) => {
		dashboard = dashboardContributionSchema.parse(raw);
		onUpdate?.('dashboard');
	});

	connection.onNotification(publishScreenNotification, (raw) => {
		const screen = pluginScreenSchema.parse(raw);
		screens.set(screen.screenId, screen);
		onUpdate?.('screen', screen.screenId);
	});

	connection.onNotification(publishAuthNotification, (raw) => {
		auth = pluginAuthSchema.parse(raw);
		onUpdate?.('auth');

		// A PhoneAuthHandoff (as opposed to a DeviceCodeAuth) means the phone
		// itself needs to complete the login — push it straight to whatever's
		// currently paired. Routing the resulting code back to this plugin
		// once the redirect lands doesn't need anything registered here: the
		// plugin's own `state` is namespaced with its plugin id (see
		// plugins/youtube/auth.ts), so src/routes/oauth/callback can find the
		// right running plugin through the manager directly.
		if ('loginUrl' in auth) {
			sendToPhones({
				jsonrpc: '2.0',
				method: openUrlNotification.method,
				params: { url: auth.loginUrl }
			});
		}
	});

	connection.onNotification(logNotification, (raw) => {
		const { level, message } = logParamsSchema.parse(raw);
		console[level](`[plugin${manifest ? `:${manifest.id}` : ''}] ${message}`);
	});

	connection.onRequest(httpRequestRequest, async (raw) => {
		const params = httpRequestParamsSchema.parse(raw);
		if (!manifest || !hostAllowsDomain(manifest, params.url)) {
			throw new Error(`Plugin has no network capability for ${params.url}`);
		}
		const response = await fetch(params.url, {
			method: params.method,
			headers: params.headers,
			body: params.body
		});
		const body = await response.text();
		return httpResponseResultSchema.parse({
			status: response.status,
			headers: Object.fromEntries(response.headers.entries()),
			body
		});
	});

	connection.onRequest(credentialGetRequest, async () => {
		const user = await getActiveProfileUser();
		if (!user || !manifest) return credentialGetResultSchema.parse({ value: null });
		const value = await getPluginCredential(user.id, manifest.id);
		return credentialGetResultSchema.parse({ value });
	});

	connection.onRequest(credentialSetRequest, async (raw) => {
		const { value } = credentialSetParamsSchema.parse(raw);
		const user = await getActiveProfileUser();
		if (!user || !manifest) throw new Error('No active profile to store a plugin credential for');
		await setPluginCredential(user.id, manifest.id, value);
	});

	connection.onRequest(getPublicOriginRequest, () => {
		// Dev-only fallback port — a real deployment would get this from
		// wherever adapter-node's own PORT is actually configured.
		const port = process.env.PORT ?? '5173';
		const host = getLanAddress() ?? 'localhost';
		return publicOriginResultSchema.parse({ origin: `http://${host}:${port}` });
	});

	connection.listen();
	await ready;

	connection.sendNotification(activateNotification);

	// Every plugin gets this regardless of whether it actually has any
	// account-bound state -- one that doesn't care just never listens for it.
	const unsubscribeActiveProfile = onActiveProfileChanged(() => {
		connection.sendNotification(profileChangedNotification);
	});

	return {
		manifest: manifest!,
		getDashboard: () => dashboard,
		getScreen: (screenId) => screens.get(screenId),
		getAuth: () => auth,
		sendUiEvent: (event) => connection.sendNotification(uiEventNotification, event),
		deliverOAuthCode: (code, state) =>
			connection.sendNotification(oauthCodeNotification, { code, state }),
		resolveStream: async (sessionId, maxHeight) =>
			resolvedStreamSchema.parse(
				await connection.sendRequest(resolveStreamRequest, { sessionId, maxHeight })
			),
		resolveSkipSegments: async (sessionId) => {
			try {
				const { segments } = await connection.sendRequest(resolveSkipSegmentsRequest, {
					sessionId
				});
				return segments;
			} catch {
				// The plugin has no handler registered for this request at all --
				// same as it having nothing to report.
				return [];
			}
		},
		dispose: () => {
			unsubscribeActiveProfile();
			connection.sendNotification(shutdownNotification);
			connection.dispose();
			child.kill();
		}
	};
}
