// SponsorBlock (sponsor.ajay.app) crowdsources exactly the kind of
// skippable section (sponsor reads, subscribe reminders, channel
// intros/outros, previews/recaps) this plugin has no way to detect on its
// own -- this just hands its data to the generic skip-segment plugin
// contract (#lib/plugins/host's SkipSegment), so the player never needs to
// know SponsorBlock exists.
import type { SkipSegment } from '#lib/plugins/host';

const SPONSORBLOCK_API = 'https://sponsor.ajay.app/api/skipSegments';

// The subset of SponsorBlock's own category list that's actually a range to
// skip. Left out on purpose: `poi_highlight` is a single moment to jump *to*,
// not a range to skip, and `music_offtopic`'s own action is muting audio, not
// cutting video -- neither fits this plugin contract's "skip a range" shape.
const SKIP_CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview'];

const CATEGORY_LABELS: Record<string, string> = {
	sponsor: 'Sponsor',
	selfpromo: 'Self-promotion',
	interaction: 'Interaction reminder',
	intro: 'Intro',
	outro: 'Outro',
	preview: 'Preview/recap'
};

type SponsorBlockSegment = {
	category: string;
	actionType: string;
	segment: [number, number];
};

export async function fetchSkipSegments(videoId: string): Promise<SkipSegment[]> {
	const url = new URL(SPONSORBLOCK_API);
	url.searchParams.set('videoID', videoId);
	url.searchParams.set('categories', JSON.stringify(SKIP_CATEGORIES));

	const response = await fetch(url);
	// SponsorBlock 404s (rather than an empty array) when nobody's submitted
	// any segments for this video at all -- the common case, not a failure.
	if (response.status === 404) return [];
	if (!response.ok) throw new Error(`SponsorBlock returned ${response.status}`);

	const results = (await response.json()) as SponsorBlockSegment[];
	return results
		.filter((result) => result.actionType === 'skip')
		.map((result) => ({
			startSeconds: result.segment[0],
			endSeconds: result.segment[1],
			label: CATEGORY_LABELS[result.category] ?? result.category
		}));
}
