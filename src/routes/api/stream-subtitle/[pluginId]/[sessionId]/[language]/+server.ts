// Fetches one subtitle track's actual VTT content server-side and hands it
// back as a plain, whole-file response -- unlike stream-track's byte-range
// relay, a caption file is a few KB at most, so there's no segment index or
// Range forwarding to do here, just a single proxied fetch. Generic over any
// plugin, same as stream-track: it only ever touches the generic
// ResolvedStream shape (see #lib/plugins/host's SubtitleTrack).
import { error } from '@sveltejs/kit';
import { resolveStreamOrError } from '#api/plugins/trackResolution';
import type { RequestHandler } from './$types';

// Two things wrong with a plugin's own caption file as-is (YouTube's
// auto-generated ones very much included), both fixed here before it ever
// reaches the browser:
//
// 1. Horizontal pinning. A cue's `align`/`position` settings can pin its box
//    to one side of the screen -- CSS can't override this (`::cue {
//    text-align: ... }` only ever affects text alignment *within* an
//    already-positioned box, never the box's own position/alignment
//    anchor), so the settings themselves have to go, falling every cue back
//    to WebVTT's real default (horizontally centered).
//
// 2. Overlapping "rolling" cues. YouTube's auto-captions chain consecutive,
//    time-overlapping cues that repeat and build on each other's text word
//    by word (e.g. one cue for "what you", the next for "what you got us",
//    the next for the full sentence, each starting before the last one's
//    own end) -- a deliberate effect for YouTube's own JS caption renderer,
//    which swaps text in place rather than stacking cues. Player natively
//    through a plain <track> instead, any moment where two of these are
//    simultaneously active renders as two full, near-duplicate lines
//    stacked on screen at once. Capping every cue's end at the very next
//    cue's start (timestamps compare correctly as plain strings -- WebVTT's
//    own HH:MM:SS.mmm format is fixed-width) guarantees only one is ever
//    showing at a time, regardless of what the source file's own timing
//    intended.
//
// `line`/`size`/`vertical` are left untouched -- they're not implicated in
// either problem, and stripping them bought nothing but risk once overlap
// itself is actually gone.
const CUE_TIMING_LINE = /^(\S+)\s*-->\s*(\S+)(.*)$/;

function stripHorizontalSettings(settings: string): string {
	return settings
		.replace(/\balign:\S+/g, '')
		.replace(/\bposition:\S+/g, '')
		.trim();
}

// One cue's timing line, with its end capped at the next cue's start (an
// auto-caption track's own cues routinely overlap, which renders as two
// stacked lines) and its horizontal placement settings dropped.
function rewriteTimingLine(match: RegExpMatchArray, nextStart: string | undefined): string {
	const [, start, end, settings] = match;
	const cappedEnd = nextStart && end > nextStart ? nextStart : end;
	const cleaned = stripHorizontalSettings(settings);
	return `${start} --> ${cappedEnd}${cleaned ? ` ${cleaned}` : ''}`;
}

function normalizeVtt(vtt: string): string {
	// A cue block is itself possibly multiple lines (an optional identifier,
	// the timing line, one or more text lines); blocks are separated by a
	// blank line. Splitting this way (rather than a flat line-by-line pass)
	// is what makes it possible to look at cue N+1's start while still
	// editing cue N's own timing line.
	const blocks = vtt.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/));

	const cues = blocks.flatMap((lines, blockIndex) =>
		lines
			.map((line, lineIndex) => ({ blockIndex, lineIndex, match: line.match(CUE_TIMING_LINE) }))
			.filter(
				(entry): entry is { blockIndex: number; lineIndex: number; match: RegExpMatchArray } =>
					entry.match !== null
			)
	);

	for (let i = 0; i < cues.length; i++) {
		const { blockIndex, lineIndex, match } = cues[i];
		blocks[blockIndex][lineIndex] = rewriteTimingLine(match, cues[i + 1]?.match[1]);
	}

	return blocks.map((lines) => lines.join('\n')).join('\n\n');
}

export const GET: RequestHandler = async ({ params }) => {
	const { pluginId, sessionId, language } = params;
	// Deliberately not keyed by quality the way stream-track's own `?quality=`
	// is: a caption track is identical regardless of resolution, and tying
	// this URL to the player's current quality would force the browser to
	// reload (and un-select) it on every quality switch for no reason. Costs
	// one extra resolveStreamCached entry (a real yt-dlp call, once) the first
	// time a session's captions are actually turned on, cached for the same
	// 5 minutes as every other quality tier's own entry after that.
	const resolved = await resolveStreamOrError(pluginId, sessionId, undefined);
	const track = resolved.subtitleTracks?.find((t) => t.language === language);
	if (!track) error(404, `No subtitle track for language "${language}"`);

	const upstream = await fetch(track.url);
	if (!upstream.ok) error(502, `Subtitle source returned ${upstream.status}`);

	const vtt = await upstream.text();
	return new Response(normalizeVtt(vtt), {
		// `no-store`, not just omitted -- this route's own normalization logic
		// is still actively changing, and a stale cached copy from before some
		// future fix would otherwise silently keep "working" the old way in
		// whichever browser already fetched it once, with no visible sign
		// anything was ever served from cache.
		headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store' }
	});
};
