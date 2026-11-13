// Quality tiers and how each one plays. Shared by the TV player, its quality
// picker and the phone remote so all three show the same tiers and mode icons.

/** A video height the app offers. The list differs per app and session, it comes with the resolved stream. */
export type QualityOption = number;

// Used when the screen size is unknown. Often served pre-muxed, so it starts fastest.
const FALLBACK_START_HEIGHT = 720;

/**
 * Cap for the first resolve, before the app has said which tiers it has.
 * Anything above the screen's pixel height can't look better, so that is the
 * ceiling. Only a preference, `startQuality` picks the closest tier the app
 * really offers.
 */
export function preferredStartHeight(screenHeightPx: number | undefined): number {
	return screenHeightPx && screenHeightPx > 0 ? Math.round(screenHeightPx) : FALLBACK_START_HEIGHT;
}

/** `preferredStartHeight` for this device's screen, the fallback during SSR. */
export function screenStartHeight(): number {
	// Physical pixels, so a 4K TV scaled to 1080 CSS pixels still counts as 2160.
	return preferredStartHeight(
		typeof window === 'undefined' ? undefined : window.screen.height * window.devicePixelRatio
	);
}

/** Containers the stream resolver reports, needed to build the MSE MIME types. */
export type Container = 'mp4' | 'webm';
/** How a tier plays, shown as an icon in the quality picker and on the phone. */
export type QualityMode = 'direct' | 'mse' | 'ffmpeg';

/** Codec info the server resolves per tier, decides which playback path a tier can take. */
export type QualityMeta = {
	direct: boolean;
	vcodec: string;
	acodec: string | null;
	videoContainer: Container;
	audioContainer: Container | null;
};

/** Narrowed by isMseCandidate, so the MSE setup can rely on a separate audio track. */
export type MseQualityMeta = QualityMeta & { acodec: string; audioContainer: Container };

/** Highest first without duplicates, so tiers always read the same however the app ordered them. */
export function normalizeQualities(raw: readonly number[] | undefined): QualityOption[] {
	return [...new Set(raw ?? [])].sort((a, b) => b - a);
}

/** Drops quality values from the phone that the session doesn't offer. */
export function isOfferedQuality(qualities: readonly number[], value: number): boolean {
	return qualities.includes(value);
}

/**
 * Tier the player opens on before the others are probed, the highest one under
 * the preferred height. Undefined when the app has no quality choice.
 */
export function startQuality(
	qualities: readonly number[],
	preferredHeight: number
): QualityOption | undefined {
	const ordered = normalizeQualities(qualities);
	return ordered.find((option) => option <= preferredHeight) ?? ordered.at(-1);
}

/** Converts the play page's GraphQL result. The server only reports mp4 or webm, GraphQL just has no literal union type. */
export function toQualityMeta(result: {
	direct: boolean;
	vcodec: string;
	acodec: string | null;
	videoContainer: string;
	audioContainer: string | null;
}): QualityMeta {
	return {
		direct: result.direct,
		vcodec: result.vcodec,
		acodec: result.acodec,
		videoContainer: result.videoContainer as Container,
		audioContainer: result.audioContainer as Container | null
	};
}

/** MSE needs a proxied stream with a separate audio track to pair with. Gates both the engine's MSE path and the per tier probe. */
export function isMseCandidate(meta: QualityMeta): meta is MseQualityMeta {
	return !meta.direct && !!meta.acodec && !!meta.audioContainer;
}

/** Mirrors the engine's setupPlayback choice, so the icons can predict it without playing. MSE can still fail at runtime. */
export function strategyFor(meta: QualityMeta): QualityMode {
	if (meta.direct) return 'direct';
	return isMseCandidate(meta) ? 'mse' : 'ffmpeg';
}

/**
 * Feeds the mode icons in the picker and on the phone. Undefined while unknown,
 * an MSE candidate stays that way until its segment index was probed.
 */
export function qualityModeFor(
	meta: QualityMeta | undefined,
	mseAvailable: boolean | undefined
): QualityMode | undefined {
	if (!meta) return undefined;
	const strategy = strategyFor(meta);
	if (strategy !== 'mse') return strategy;
	if (mseAvailable === undefined) return undefined;
	return mseAvailable ? 'mse' : 'ffmpeg';
}

/**
 * Lets the player open on the highest tier confirmed for real MSE instead of
 * always the start tier. Expects `qualities` highest first.
 */
export function bestInitialQuality(
	qualities: readonly number[],
	mseAvailability: Partial<Record<QualityOption, boolean>>,
	fallback: QualityOption | undefined
): QualityOption | undefined {
	return qualities.find((option) => mseAvailability[option] === true) ?? fallback;
}
