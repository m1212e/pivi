// Size caps for what an app sends, applied in the schemas so an untrusted app
// can't make the host hold, forward or render unbounded data. Each one is far
// above what a real screen, card or stream needs.
import { z } from 'zod';

/** Screen ids, event ids, session ids and other opaque handles. */
export const idSchema = z.string().max(1024);

/** Image, stream and link URLs. */
export const urlSchema = z.string().max(8 * 1024);

/** Titles, descriptions, labels and other text shown to the user. */
export const textSchema = z.string().max(10_000);

/** Codec names, language tags and other short tokens. */
export const tokenSchema = z.string().max(256);

/** Entries in any one list (cards, children, tracks, segments). */
export const MAX_LIST_ITEMS = 1_000;

// What the host enforces on a running app beyond the schemas. Part of the contract
// (an app that exceeds them loses messages or gets stopped), so it lives here and
// the host and `pivi-app dev` apply the same numbers.

/** UI nodes in one screen. A screen over it is dropped. */
export const MAX_SCREEN_NODES = 5_000;
/** Distinct screen ids an app may keep published at once. */
export const MAX_SCREENS = 32;
/** What all of an app's published screens may add up to, serialized. */
export const MAX_SCREEN_BYTES = 8 << 20;
/** One protocol message from the app. Larger ones are dropped. */
export const MAX_MESSAGE_BYTES = 4 << 20;
/** Messages per second an app may send before the host stops reading for a moment. */
export const MAX_MESSAGES_PER_SECOND = 5_000;
/** `app/openOnPhone` at most once per this long, since each one prompts on the phone. */
export const OPEN_ON_PHONE_INTERVAL_MS = 5_000;
/** Chat lines the host keeps per open chat. */
export const CHAT_BACKLOG = 150;

/** How long the host waits before it treats an app as hung and stops it. */
export const HOST_TIMEOUTS = {
	/** From start to `app/ready`. */
	readyMs: 60_000,
	/** For any request but resolveStream. */
	requestMs: 15_000,
	/** For `app/resolveStream`, which may run an extractor. */
	resolveStreamMs: 45_000,
	/** For the `host/ping` the host sends after a request timed out. */
	pingMs: 5_000
} as const;

/** Links the host hands on (open on the phone) must be https, compared by protocol, not by prefix. */
export function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}
