// The app-side runtime for TypeScript apps (Node and Bun only, it owns
// stdin/stdout). `defineApp` is the whole host protocol behind one object of
// handlers, so an app only writes what is specific to its service.
import type { MessageConnection } from 'vscode-jsonrpc';
import type { z } from 'zod';
import type { dashboardContributionSchema } from './dashboard';
import {
	activateNotification,
	chatMessagesNotification,
	closeChatNotification,
	localeNotification,
	openChatNotification,
	openOnPhoneNotification,
	PROTOCOL_VERSION,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	refreshDashboardNotification,
	resolveLiveStatusRequest,
	resolveNextRequest,
	resolveSkipSegmentsRequest,
	resolveStreamRequest,
	shutdownNotification,
	uiEventNotification,
	type ChatBatch,
	type resolveLiveStatusParamsSchema,
	type resolveLiveStatusResultSchema,
	type resolveNextParamsSchema,
	type resolveNextResultSchema,
	type resolveSkipSegmentsParamsSchema,
	type resolveSkipSegmentsResultSchema,
	type resolveStreamParamsSchema,
	type ResolvedStream
} from './protocol';
import { createStdioConnection } from './stdioConnection';
import type { appScreenSchema, uiEventSchema } from './ui';

export { createStdioConnection } from './stdioConnection';

type Awaitable<T> = T | Promise<T>;
type LogLevel = 'info' | 'warn' | 'error';

/** What `defineApp` hands back for talking to the host. */
export interface AppContext {
	/** The raw connection, for anything the helpers don't cover. */
	readonly connection: MessageConnection;
	/** The cards and actions this app puts on the home screen (feature `dashboard`). */
	publishDashboard(dashboard: z.infer<typeof dashboardContributionSchema>): void;
	/** The app's screen, replacing the one shown (feature `screen`). */
	publishScreen(screen: z.infer<typeof appScreenSchema>): void;
	/** Shows a link on the paired phone. */
	openOnPhone(url: string): void;
	/** New chat lines for an open chat (feature `chat`). */
	sendChat(sessionId: string, batch: ChatBatch): void;
	/** Logs to stderr, the stream the host captures. */
	log(level: LogLevel, message: string): void;
}

/**
 * The handlers an app provides. Every one is optional; declare the matching
 * feature in the manifest for each request handler you add, the host only sends
 * what the manifest declares.
 */
export interface AppHandlers {
	/**
	 * The host allows publishing from now on. Start loading data here, not
	 * before: anything published earlier is dropped.
	 */
	onActivate?(params: { locale: string }): Awaitable<void>;
	/** The TV's language became known or changed (a BCP 47 tag such as `de-DE`). */
	onLocale?(params: { locale: string }): void;
	/** The home screen opened, so its cards may be stale (feature `dashboard`). */
	onRefreshDashboard?(): void;
	/** The user did something on a published screen (feature `screen`). */
	onUiEvent?(event: z.infer<typeof uiEventSchema>): void;
	/** Exit cleanly. Defaults to `process.exit(0)`. */
	onShutdown?(): void;

	/** Something playable for a session id the app put in a card (feature `playback`). */
	resolveStream?(params: z.infer<typeof resolveStreamParamsSchema>): Awaitable<ResolvedStream>;
	/** Ranges the player skips (feature `skipSegments`). */
	resolveSkipSegments?(
		params: z.infer<typeof resolveSkipSegmentsParamsSchema>
	): Awaitable<z.infer<typeof resolveSkipSegmentsResultSchema>>;
	/** The session to play after this one (feature `playback`). */
	resolveNext?(
		params: z.infer<typeof resolveNextParamsSchema>
	): Awaitable<z.infer<typeof resolveNextResultSchema>>;
	/** Live details such as the viewer count (feature `playback`). */
	resolveLiveStatus?(
		params: z.infer<typeof resolveLiveStatusParamsSchema>
	): Awaitable<z.infer<typeof resolveLiveStatusResultSchema>>;

	/** A player shows this session's chat: connect and call `sendChat` (feature `chat`). */
	onOpenChat?(sessionId: string, app: AppContext): void;
	/** Nobody shows this session's chat anymore: disconnect (feature `chat`). */
	onCloseChat?(sessionId: string): void;
}

/**
 * Connects to the host and runs the app: sends `app/ready`, then answers the
 * host with `handlers`. Call it once at startup, before anything else prints
 * (it moves `console.log` to stderr, stdout is the protocol channel).
 *
 * `handlers` may be a function of the context, for handlers that publish.
 *
 * @example
 * defineApp((app) => ({
 *   onActivate: () => app.publishDashboard({ cards: [] }),
 *   resolveStream: async ({ sessionId }) => ({
 *     videoUrl: await lookup(sessionId),
 *     vcodec: 'h264',
 *     videoContainer: 'hls',
 *     title: 'Some stream',
 *     duration: 0,
 *     live: true
 *   })
 * }));
 */
export function defineApp(handlers: AppHandlers | ((app: AppContext) => AppHandlers)): AppContext {
	const connection = createStdioConnection();
	const app: AppContext = {
		connection,
		publishDashboard: (dashboard) =>
			void connection.sendNotification(publishDashboardNotification, dashboard),
		publishScreen: (screen) => void connection.sendNotification(publishScreenNotification, screen),
		openOnPhone: (url) => void connection.sendNotification(openOnPhoneNotification, { url }),
		sendChat: (sessionId, batch) =>
			void connection.sendNotification(chatMessagesNotification, { sessionId, ...batch }),
		log: (level, message) => console.error(`[${level}] ${message}`)
	};
	const h = typeof handlers === 'function' ? handlers(app) : handlers;

	void connection.sendNotification(readyNotification, { protocol: PROTOCOL_VERSION });

	// Registered right after ready, before anything is awaited, so an activate
	// that arrives straight away is never missed.
	connection.onNotification(activateNotification, (params) => {
		Promise.resolve(h.onActivate?.(params)).catch((err) =>
			app.log('error', `onActivate failed: ${String(err)}`)
		);
	});
	connection.onNotification(localeNotification, (params) => h.onLocale?.(params));
	connection.onNotification(refreshDashboardNotification, () => h.onRefreshDashboard?.());
	connection.onNotification(uiEventNotification, (event) => h.onUiEvent?.(event));
	connection.onNotification(shutdownNotification, () =>
		(h.onShutdown ?? (() => process.exit(0)))()
	);

	if (h.resolveStream) connection.onRequest(resolveStreamRequest, h.resolveStream);
	if (h.resolveSkipSegments) {
		connection.onRequest(resolveSkipSegmentsRequest, h.resolveSkipSegments);
	}
	if (h.resolveNext) connection.onRequest(resolveNextRequest, h.resolveNext);
	if (h.resolveLiveStatus) connection.onRequest(resolveLiveStatusRequest, h.resolveLiveStatus);

	if (h.onOpenChat) {
		const open = h.onOpenChat;
		connection.onNotification(openChatNotification, ({ sessionId }) => open(sessionId, app));
	}
	if (h.onCloseChat) {
		const close = h.onCloseChat;
		connection.onNotification(closeChatNotification, ({ sessionId }) => close(sessionId));
	}
	return app;
}
