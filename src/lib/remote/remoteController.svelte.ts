import { onMount } from 'svelte';
// The bare package, not a /node or /browser subpath. See rpcRal.ts for why.
// ensureRal() installs the RAL createMessageConnection needs.
import {
	createMessageConnection,
	type Message,
	type MessageConnection,
	type NotificationType
} from 'vscode-jsonrpc';
import type { z } from 'zod';
import { ensureRal } from '#sdk/rpcRal';
import { onNotification, sendNotification } from '../rpc';
import { PushMessageReader, SinkMessageWriter } from '#sdk/rpcTransport';
import { mirroredText, recordSent, type SentText } from '../textEntry';
import {
	backNotification,
	enterNotification,
	exitTextNotification,
	goHomeNotification,
	keyNotification,
	keyParamsSchema,
	moveNotification,
	moveParamsSchema,
	openUrlNotification,
	openUrlParamsSchema,
	playerActionNotification,
	playerActionParamsSchema,
	playerQualityNotification,
	playerQualityParamsSchema,
	playerSeekNotification,
	playerSeekParamsSchema,
	playerSubtitleNotification,
	playerSubtitleParamsSchema,
	playerVolumeNotification,
	playerVolumeParamsSchema,
	requestStateNotification,
	selectAppNotification,
	selectAppParamsSchema,
	selectCancelNotification,
	selectPressNotification,
	selectProfileNotification,
	selectProfileParamsSchema,
	selectReleaseNotification,
	stateNotification,
	stateParamsSchema,
	suggestionNotification,
	suggestionParamsSchema,
	textEntryModeNotification,
	textEntryModeParamsSchema,
	textNotification,
	textParamsSchema
} from './remoteProtocol';
import { connectRemoteSession, type RemoteSession } from './session';

/** The TV's last pushed screen state, also typed into the remote page's tab components. */
export type TvState = z.infer<typeof stateParamsSchema>;
type PlayerAction = z.infer<typeof playerActionParamsSchema>['action'];
type RemotePhase = 'connecting' | 'awaiting-approval' | 'not-paired' | 'error' | 'ready';

// Shown until the TV's first push arrives, so the UI renders without null checks.
const INITIAL_TV_STATE: TvState = {
	hasPinPad: false,
	hasTextInput: false,
	textValue: '',
	textMasked: false,
	textFieldId: 0,
	suggestions: [],
	canGoBack: false,
	canGoHome: false,
	profiles: [],
	apps: [],
	hasPlayer: false,
	playing: false,
	position: 0,
	duration: 0,
	quality: 0,
	qualityOptions: [],
	qualityModes: {},
	subtitleTracks: [],
	subtitleLanguage: null,
	diagnosticsOpen: false,
	volume: 0
};

// Haptic feedback lengths in ms, so each kind of action feels distinct.
const BUZZ = { tick: 2, light: 4, normal: 6, strong: 8 } as const;

function buzz(ms: number) {
	navigator.vibrate?.(ms);
}

// The QR code carries the pairing token in the fragment, which the browser
// never sends to the server, so it doesn't show up on the wire or in any
// log. Removed from the address bar right away so it isn't kept in history or
// bookmarked into a home screen shortcut.
function takePairingTokenFromUrl(): string | null {
	const token = location.hash.slice(1);
	if (!token) return null;
	history.replaceState(history.state, '', location.pathname + location.search);
	return token;
}

/**
 * Everything the phone remote page (/remote) needs from the TV, kept out of
 * the page so its tab components only render. Connects on mount and must be
 * created during component init.
 */
export function createRemoteController() {
	let phase = $state<RemotePhase>('connecting');
	let errorMessage = $state('');
	let connected = $state(false);
	// Replaced wholesale on every push, so it carries no per-field reactivity cost worth avoiding.
	let tv = $state.raw<TvState>(INITIAL_TV_STATE);
	let text = $state('');
	let phoneKeyboard = $state(true);
	// Set only when the tab openSignInUrl tried was blocked, so the prompt is a
	// fallback rather than an extra step on the normal path.
	let pendingSignInUrl = $state<string | null>(null);

	let session: RemoteSession | undefined;
	let connection: MessageConnection | undefined;
	// Values this phone sent recently, so the TV echoing them back isn't
	// mistaken for an edit made on the TV (the echo can lag behind typing).
	let recentlySent: SentText[] = [];

	/** Silently does nothing before the connection exists, there is nowhere to send to yet. */
	function send<P>(type: NotificationType<P>, schema: z.ZodType<P>, params: P, haptic?: number) {
		if (!connection) return;
		sendNotification(connection, type, schema, params);
		if (haptic) buzz(haptic);
	}

	function reportTextEntryMode() {
		if (!connected) return;
		send(textEntryModeNotification, textEntryModeParamsSchema, { phoneKeyboard });
	}

	// Reported even while no field is focused, so the TV already knows when one appears.
	$effect(() => {
		void connected;
		void phoneKeyboard;
		reportTextEntryMode();
	});

	function applyTvState(state: TvState) {
		const sameField = state.textFieldId === tv.textFieldId;
		tv = { ...state, suggestions: state.hasTextInput ? state.suggestions : [] };
		// Cheap and idempotent, and covers a TV that reloaded and forgot.
		if (state.hasTextInput) reportTextEntryMode();
		else recentlySent = [];
		// The TV never sends a password field's value, so there is nothing to
		// mirror. The phone keeps what it typed and starts empty on a new field.
		if (state.textMasked) text = sameField ? text : '';
		else text = mirroredText(state, text, recentlySent, Date.now());
	}

	// A new tab, not this one: the remote is the TV's only input device, so
	// navigating it away would strand the TV until the sign-in finished and
	// the user found their way back. On a remote installed to the home screen
	// it would also leave the app entirely.
	function openSignInUrl(url: string) {
		// Deliberately not the 'noopener' window feature: with it, window.open
		// returns null whether it succeeded or was blocked, which would make
		// the check below fire every time. Clearing `opener` on the new window
		// is the equivalent, and is allowed cross-origin.
		const opened = window.open(url, '_blank');
		if (opened) {
			opened.opener = null;
			return;
		}
		// This arrives over the websocket, so there's no user gesture for the
		// popup blocker to accept, which is the normal outcome on mobile
		// Safari. Fall back to a link whose tap *is* one.
		pendingSignInUrl = url;
	}

	onMount(() => {
		let cancelled = false;

		// Registered only from this route (not the root layout) so installing
		// "Pivi Remote" to the home screen doesn't put a service worker in
		// front of the rest of the app. Browsers only allow it in a secure
		// context, so on the plain HTTP LAN address this does nothing.
		navigator.serviceWorker?.register('/remote/sw.js', { scope: '/remote/' }).catch(() => {});

		ensureRal();

		// The writer sends through whatever `session` holds at call time, and
		// nothing sends before the `.then()` below assigns it, so messages the
		// TV pushes right after the handshake can't race it.
		const reader = new PushMessageReader();
		const writer = new SinkMessageWriter((msg) => session?.send(msg as Record<string, unknown>));
		const conn = createMessageConnection(reader, writer);
		connection = conn;

		onNotification(conn, stateNotification, stateParamsSchema, applyTvState);
		// Sent directly by the host (not the TV) when an app hands off a login.
		// A real browser tab, not something we render ourselves: Google's login
		// page refuses to load in an embedded context, and it belongs to a
		// different origin.
		onNotification(conn, openUrlNotification, openUrlParamsSchema, ({ url }) => openSignInUrl(url));
		conn.listen();

		connectRemoteSession(takePairingTokenFromUrl(), {
			// Every message on this channel is a real JSON-RPC frame the TV's connection produced.
			onMessage: (message) => reader.push(message as unknown as Message),
			onClose: () => (connected = false),
			onAwaitingApproval: () => {
				if (!cancelled) phase = 'awaiting-approval';
			}
		})
			.then((result) => {
				if (cancelled) return;
				if (!result) {
					phase = 'not-paired';
					return;
				}
				session = result;
				connected = true;
				phase = 'ready';
				conn.sendNotification(requestStateNotification);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				errorMessage = err instanceof Error ? err.message : String(err);
				phase = 'error';
			});

		return () => {
			cancelled = true;
			conn.dispose();
			session?.close();
		};
	});

	return {
		get phase() {
			return phase;
		},
		get errorMessage() {
			return errorMessage;
		},
		get connected() {
			return connected;
		},
		get tv() {
			return tv;
		},
		/** The phone keyboard's field, follows edits made on the TV. */
		get text() {
			return text;
		},
		set text(value: string) {
			text = value;
		},
		setPhoneKeyboard(value: boolean) {
			phoneKeyboard = value;
		},
		/** A sign-in link the browser refused to open on its own, for SignInPrompt.svelte. */
		get pendingSignInUrl() {
			return pendingSignInUrl;
		},
		dismissSignIn() {
			pendingSignInUrl = null;
		},

		trackpad: {
			press: () => connection?.sendNotification(selectPressNotification),
			release() {
				connection?.sendNotification(selectReleaseNotification);
				buzz(BUZZ.strong);
			},
			cancel: () => connection?.sendNotification(selectCancelNotification),
			move(dx: number, dy: number) {
				send(moveNotification, moveParamsSchema, { dx, dy }, BUZZ.tick);
			}
		},

		back() {
			connection?.sendNotification(backNotification);
			buzz(BUZZ.normal);
		},
		home() {
			connection?.sendNotification(goHomeNotification);
			buzz(BUZZ.normal);
		},
		pinKey: (value: string) => send(keyNotification, keyParamsSchema, { value }, BUZZ.light),
		selectProfile: (id: string) =>
			send(selectProfileNotification, selectProfileParamsSchema, { id }, BUZZ.strong),
		selectApp: (id: string) =>
			send(selectAppNotification, selectAppParamsSchema, { id }, BUZZ.strong),

		/** Sends the current `text` to the TV. Call on every edit. */
		sendText() {
			if (!connection) return;
			recentlySent = recordSent(recentlySent, text, Date.now());
			send(textNotification, textParamsSchema, { value: text });
		},
		submitText() {
			connection?.sendNotification(enterNotification);
			buzz(BUZZ.strong);
		},
		exitText() {
			connection?.sendNotification(exitTextNotification);
			buzz(BUZZ.strong);
		},
		pickSuggestion: (value: string) =>
			send(suggestionNotification, suggestionParamsSchema, { value }, BUZZ.strong),

		playerAction: (action: PlayerAction) =>
			send(
				playerActionNotification,
				playerActionParamsSchema,
				{ action },
				action === 'playPause' ? BUZZ.strong : BUZZ.light
			),
		/** Meant for a settled drag. A seek reopens the stream on the TV, so not per tick. */
		seek: (seconds: number) =>
			send(playerSeekNotification, playerSeekParamsSchema, { seconds }, BUZZ.light),
		selectQuality(quality: number) {
			if (quality === tv.quality) return;
			send(playerQualityNotification, playerQualityParamsSchema, { quality }, BUZZ.strong);
		},
		selectSubtitle(language: string | null) {
			if (language === tv.subtitleLanguage) return;
			send(playerSubtitleNotification, playerSubtitleParamsSchema, { language }, BUZZ.strong);
		},
		/** Cheap on the TV, so meant to fire on every drag tick. */
		setVolume: (volume: number) =>
			send(playerVolumeNotification, playerVolumeParamsSchema, { volume })
	};
}

/** The prop type for remote page children that drive the TV, like PlayerTab.svelte. */
export type RemoteController = ReturnType<typeof createRemoteController>;
