// The live badge's rules, shared by the TV player and the phone remote so
// both agree on when someone is watching behind and how a count reads.
import * as m from '#lib/paraglide/messages';
import { getLocale } from '#lib/paraglide/runtime';

// Shaka's own drift around the edge is a few seconds, only more than that
// counts as watching behind.
const BEHIND_THRESHOLD_SECONDS = 8;

/** Whether to offer "jump to live" and show the delay instead of the viewer count. */
export function isBehindLive(latency: number | null): latency is number {
	return latency !== null && latency > BEHIND_THRESHOLD_SECONDS;
}

/** "12.3K viewers", in the TV's language. Null without a count. */
export function viewersLabel(viewers: number | null): string | null {
	if (viewers === null) return null;
	const count = new Intl.NumberFormat(getLocale(), {
		notation: 'compact',
		maximumFractionDigits: 1
	}).format(viewers);
	return m.live_viewers({ count });
}
