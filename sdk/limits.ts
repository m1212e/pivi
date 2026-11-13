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
