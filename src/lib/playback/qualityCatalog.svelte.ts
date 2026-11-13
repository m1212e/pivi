import {
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
	/** Tiers the app offers for this session, highest first. Empty for an app without a quality choice. */
	qualities: readonly QualityOption[];
	/** Tier the initial info was resolved for, undefined when the app has no tiers. */
	startQuality: QualityOption | undefined;
	/** Resolves a tier's codecs, undefined when the lookup failed. */
	fetchMeta: (option: QualityOption | undefined) => Promise<QualityMeta | undefined>;
	/** The start tier comes with the initial session info, so it is never fetched twice. */
	defaultMeta: QualityMeta | undefined;
};

// An app without tiers has exactly one stream, kept under this key.
const keyOf = (option: QualityOption | undefined) => option ?? 'auto';

/**
 * Lets the play page show real mode icons per tier and open on the best one,
 * by resolving each tier's codecs and probing MSE candidates for a segment
 * index. Must be created during component init.
 */
export function createQualityCatalog({
	urls,
	qualities,
	startQuality,
	fetchMeta,
	defaultMeta
}: Deps) {
	let meta = $state<Partial<Record<string, QualityMeta>>>({
		[keyOf(startQuality)]: defaultMeta
	});
	// undefined means not probed yet, or never an MSE candidate.
	let mseAvailability = $state<Partial<Record<QualityOption, boolean>>>({});

	const metaFor = (option: QualityOption | undefined): QualityMeta | undefined =>
		meta[keyOf(option)];

	const modeFor = (option: QualityOption): QualityMode | undefined =>
		qualityModeFor(metaFor(option), mseAvailability[option]);

	// Same modes as the list icons, so the phone shows the same indicators.
	const modes = $derived(
		Object.fromEntries(
			qualities
				.map((option) => [option, modeFor(option)] as const)
				.filter((entry): entry is [QualityOption, QualityMode] => entry[1] !== undefined)
		) as Partial<Record<QualityOption, QualityMode>>
	);

	async function load(option: QualityOption | undefined): Promise<QualityMeta | undefined> {
		const known = metaFor(option);
		if (known) return known;
		const resolved = await fetchMeta(option);
		if (resolved) meta = { ...meta, [keyOf(option)]: resolved };
		return resolved;
	}

	// Codecs alone can't tell if MSE works, only a real index fetch can.
	async function probe(option: QualityOption | undefined, tierMeta: QualityMeta) {
		if (option === undefined || !isMseCandidate(tierMeta)) return;
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
		const options = qualities.length > 0 ? qualities : [undefined];
		await Promise.allSettled(
			options.map(async (option) => {
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
	async function ensure(option: QualityOption | undefined): Promise<QualityMeta | undefined> {
		const known = metaFor(option);
		if (known) return known;
		const resolved = await load(option);
		if (resolved) void probe(option, resolved);
		return resolved;
	}

	return {
		metaFor,
		get modes() {
			return modes;
		},
		modeFor,
		resolveAll,
		ensure,
		/**
		 * Best tier confirmed for MSE, else the start tier. Tiers above the start
		 * tier are skipped, they exceed what the screen can show. Only meaningful
		 * after resolveAll.
		 */
		bestInitial: () =>
			bestInitialQuality(
				startQuality === undefined ? qualities : qualities.filter((o) => o <= startQuality),
				mseAvailability,
				startQuality
			)
	};
}
