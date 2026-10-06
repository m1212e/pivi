import {
	DEFAULT_QUALITY,
	QUALITY_OPTIONS,
	bestInitialQuality,
	isMseCandidate,
	qualityModeFor,
	type QualityMeta,
	type QualityMode,
	type QualityOption
} from './quality';
import { fetchTrackIndexes } from './segmentIndex';
import type { SessionUrls } from './urls';

type Deps = {
	urls: SessionUrls;
	/** Resolves a tier's codecs, undefined when the lookup failed. */
	fetchMeta: (option: QualityOption) => Promise<QualityMeta | undefined>;
	/** The default tier comes with the initial session info, so it is never fetched twice. */
	defaultMeta: QualityMeta | undefined;
};

/**
 * Lets the play page show real mode icons per tier and open on the best one,
 * by resolving each tier's codecs and probing MSE candidates for a segment
 * index. Must be created during component init.
 */
export function createQualityCatalog({ urls, fetchMeta, defaultMeta }: Deps) {
	let meta = $state<Partial<Record<QualityOption, QualityMeta>>>({
		[DEFAULT_QUALITY]: defaultMeta
	});
	// undefined means not probed yet, or never an MSE candidate.
	let mseAvailability = $state<Partial<Record<QualityOption, boolean>>>({});

	const modeFor = (option: QualityOption): QualityMode | undefined =>
		qualityModeFor(meta[option], mseAvailability[option]);

	// Same modes as the list icons, so the phone shows the same indicators.
	const modes = $derived(
		Object.fromEntries(
			QUALITY_OPTIONS.map((option) => [option, modeFor(option)]).filter(
				(entry): entry is [QualityOption, QualityMode] => entry[1] !== undefined
			)
		) as Partial<Record<QualityOption, QualityMode>>
	);

	async function load(option: QualityOption): Promise<QualityMeta | undefined> {
		if (meta[option]) return meta[option];
		const resolved = await fetchMeta(option);
		if (resolved) meta = { ...meta, [option]: resolved };
		return resolved;
	}

	// Codecs alone can't tell if MSE works, only a real index fetch can.
	async function probe(option: QualityOption, tierMeta: QualityMeta) {
		if (!isMseCandidate(tierMeta)) return;
		try {
			await fetchTrackIndexes(urls, tierMeta, option);
			mseAvailability = { ...mseAvailability, [option]: true };
		} catch {
			mseAvailability = { ...mseAvailability, [option]: false };
		}
	}

	/**
	 * Resolves every tier up front so the icons are real and the initial pick
	 * can compare them. Settles once all tiers are done, failures included.
	 */
	async function resolveAll(): Promise<void> {
		await Promise.allSettled(
			QUALITY_OPTIONS.map(async (option) => {
				const resolved = await load(option);
				if (resolved) await probe(option, resolved);
			})
		);
	}

	/**
	 * Meta for a tier the user switched to, possibly before resolveAll got
	 * there. Probing a freshly loaded tier runs in the background, playback
	 * doesn't wait on it.
	 */
	async function ensure(option: QualityOption): Promise<QualityMeta | undefined> {
		const known = meta[option];
		if (known) return known;
		const resolved = await load(option);
		if (resolved) void probe(option, resolved);
		return resolved;
	}

	return {
		get meta() {
			return meta;
		},
		get modes() {
			return modes;
		},
		modeFor,
		resolveAll,
		ensure,
		/** Best tier confirmed for MSE, else the default. Only meaningful after resolveAll. */
		bestInitial: () => bestInitialQuality(mseAvailability)
	};
}
