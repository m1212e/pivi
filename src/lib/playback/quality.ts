// Ordered highest to lowest, `bestInitialQuality` relies on that.
export const QUALITY_OPTIONS = [2160, 1440, 1080, 720, 480, 360] as const;
export type QualityOption = (typeof QUALITY_OPTIONS)[number];

// Often served pre-muxed, so it starts fastest.
export const DEFAULT_QUALITY: QualityOption = 720;

export type Container = 'mp4' | 'webm';
export type QualityMode = 'direct' | 'mse' | 'ffmpeg';

export type QualityMeta = {
	direct: boolean;
	vcodec: string;
	acodec: string | null;
	videoContainer: Container;
	audioContainer: Container | null;
};

export type MseQualityMeta = QualityMeta & { acodec: string; audioContainer: Container };

export function isQualityOption(value: number): value is QualityOption {
	return (QUALITY_OPTIONS as readonly number[]).includes(value);
}

// The server only reports mp4 or webm, GraphQL just has no literal union type.
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

// MSE needs a proxied stream with a separate audio track to pair with.
export function isMseCandidate(meta: QualityMeta): meta is MseQualityMeta {
	return !meta.direct && !!meta.acodec && !!meta.audioContainer;
}

/** What setupPlayback does for this tier. MSE can still fail at runtime and fall back. */
export function strategyFor(meta: QualityMeta): QualityMode {
	if (meta.direct) return 'direct';
	return isMseCandidate(meta) ? 'mse' : 'ffmpeg';
}

/**
 * The mode a tier will play in, as far as is known. An MSE candidate stays
 * undefined until its segment index was probed, since only that tells if
 * real MSE works. `meta` undefined means the tier is still resolving.
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

/** Highest tier confirmed to do real MSE, else the default. */
export function bestInitialQuality(
	mseAvailability: Partial<Record<QualityOption, boolean>>
): QualityOption {
	return QUALITY_OPTIONS.find((option) => mseAvailability[option] === true) ?? DEFAULT_QUALITY;
}
