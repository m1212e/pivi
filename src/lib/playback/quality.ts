// Quality tiers and how each one plays. Shared by the TV player, its quality
// picker and the phone remote so all three show the same tiers and mode icons.

/** Tiers the quality picker offers. Ordered highest to lowest, `bestInitialQuality` relies on that. */
export const QUALITY_OPTIONS = [2160, 1440, 1080, 720, 480, 360] as const;
/** A tier the picker offers, guarded by isQualityOption for input from the phone. */
export type QualityOption = (typeof QUALITY_OPTIONS)[number];

/** Tier the player opens on before the others are probed. Often served pre-muxed, so it starts fastest. */
export const DEFAULT_QUALITY: QualityOption = 720;

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

/** Drops quality values from the phone that the TV doesn't offer. */
export function isQualityOption(value: number): value is QualityOption {
	return (QUALITY_OPTIONS as readonly number[]).includes(value);
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

/** Lets the player open on the highest tier confirmed for real MSE instead of always the default. */
export function bestInitialQuality(
	mseAvailability: Partial<Record<QualityOption, boolean>>
): QualityOption {
	return QUALITY_OPTIONS.find((option) => mseAvailability[option] === true) ?? DEFAULT_QUALITY;
}
