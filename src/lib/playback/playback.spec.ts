import { describe, expect, it } from 'vitest';
import {
	DEFAULT_QUALITY,
	bestInitialQuality,
	isQualityOption,
	qualityModeFor,
	strategyFor,
	type QualityMeta
} from './quality';
import { clampSeek, settleTimeUpdate } from './seek';
import { nextSkipStep, skipTarget, type SkipInput, type SkipSegment } from './skipSegments';
import {
	isOfferedSubtitle,
	loadSkipActive,
	loadSubtitleLanguage,
	loadVolume,
	saveSubtitleLanguage,
	saveVolume
} from './preferences';
import type { KeyValueStorage } from '../storage';
import { createSessionUrls, nextSessionHref } from './urls';
import { describeError } from './errors';
import { bufferedAheadSeconds, formatTime } from './time';

const meta = (overrides: Partial<QualityMeta> = {}): QualityMeta => ({
	direct: false,
	vcodec: 'avc1',
	acodec: 'opus',
	videoContainer: 'mp4',
	audioContainer: 'webm',
	...overrides
});

describe('quality strategy', () => {
	it('plays direct streams directly, whatever else is known', () => {
		expect(strategyFor(meta({ direct: true }))).toBe('direct');
	});

	it('uses MSE only with a proxied stream and a separate audio track', () => {
		expect(strategyFor(meta())).toBe('mse');
		expect(strategyFor(meta({ acodec: null, audioContainer: null }))).toBe('ffmpeg');
		expect(strategyFor(meta({ audioContainer: null }))).toBe('ffmpeg');
	});

	it('keeps an MSE candidate unknown until its index was probed', () => {
		expect(qualityModeFor(undefined, undefined)).toBeUndefined();
		expect(qualityModeFor(meta(), undefined)).toBeUndefined();
		expect(qualityModeFor(meta(), true)).toBe('mse');
		expect(qualityModeFor(meta(), false)).toBe('ffmpeg');
	});

	it('knows direct and ffmpeg tiers without probing', () => {
		expect(qualityModeFor(meta({ direct: true }), undefined)).toBe('direct');
		expect(qualityModeFor(meta({ audioContainer: null }), undefined)).toBe('ffmpeg');
	});

	it('starts on the highest confirmed MSE tier, else the default', () => {
		expect(bestInitialQuality({ 1080: true, 720: true, 2160: false })).toBe(1080);
		expect(bestInitialQuality({ 2160: false, 1080: false })).toBe(DEFAULT_QUALITY);
		expect(bestInitialQuality({})).toBe(DEFAULT_QUALITY);
	});

	it('only accepts offered tiers', () => {
		expect(isQualityOption(720)).toBe(true);
		expect(isQualityOption(999)).toBe(false);
	});
});

describe('seek bookkeeping', () => {
	it('clamps into the video', () => {
		expect(clampSeek(-5, 100)).toBe(0);
		expect(clampSeek(500, 100)).toBe(100);
		expect(clampSeek(42, 100)).toBe(42);
	});

	it('passes updates through with no seek pending', () => {
		expect(settleTimeUpdate(null, 0, 12, 0)).toEqual({ apply: true, target: null });
	});

	it('ignores stale updates until the seek lands', () => {
		const target = { seconds: 60, issuedAt: 1000 };
		expect(settleTimeUpdate(target, 0, 10, 2000)).toEqual({ apply: false, target });
		expect(settleTimeUpdate(target, 0, 59.5, 2000)).toEqual({ apply: true, target: null });
	});

	it('adds the ffmpeg offset when checking where playback is', () => {
		const target = { seconds: 60, issuedAt: 1000 };
		expect(settleTimeUpdate(target, 60, 0.5, 2000).apply).toBe(true);
		expect(settleTimeUpdate(target, 60, 30, 2000).apply).toBe(false);
	});

	it('trusts the element again when a seek never lands', () => {
		const target = { seconds: 60, issuedAt: 1000 };
		expect(settleTimeUpdate(target, 0, 10, 1000 + 8000)).toEqual({ apply: true, target: null });
	});
});

describe('skip segments', () => {
	const seg = (startSeconds: number, endSeconds: number): SkipSegment => ({
		startSeconds,
		endSeconds,
		label: 'sponsor'
	});
	const input = (overrides: Partial<SkipInput> = {}): SkipInput => ({
		segments: [],
		decided: new Set(),
		active: null,
		position: 0,
		playing: true,
		buffering: false,
		...overrides
	});

	it('shows the toggle inside the lead window only', () => {
		const s = seg(60, 90);
		expect(nextSkipStep(input({ segments: [s], position: 56 }))).toEqual({
			kind: 'show',
			segment: null
		});
		expect(nextSkipStep(input({ segments: [s], position: 58 }))).toEqual({
			kind: 'show',
			segment: s
		});
	});

	it('keeps showing an active segment until its start, then resolves it', () => {
		const s = seg(60, 90);
		expect(nextSkipStep(input({ segments: [s], active: s, position: 59 })).kind).toBe('show');
		expect(nextSkipStep(input({ segments: [s], active: s, position: 60 }))).toEqual({
			kind: 'resolve',
			segment: s
		});
	});

	it('does not offer segments already decided', () => {
		const s = seg(60, 90);
		const step = nextSkipStep(input({ segments: [s], decided: new Set([s]), position: 58 }));
		expect(step).toEqual({ kind: 'show', segment: null });
	});

	it('resolves a segment at the very start only once playback is real', () => {
		const s = seg(0, 15);
		expect(nextSkipStep(input({ segments: [s], position: 0.2, buffering: true })).kind).toBe(
			'show'
		);
		expect(nextSkipStep(input({ segments: [s], position: 0.2, playing: false })).kind).toBe('show');
		expect(nextSkipStep(input({ segments: [s], position: 0.2 }))).toEqual({
			kind: 'resolve',
			segment: s
		});
	});

	it('only jumps ahead when enabled and playing', () => {
		const s = seg(60, 90);
		expect(skipTarget(s, true, true)).toBe(90);
		expect(skipTarget(s, false, true)).toBeNull();
		expect(skipTarget(s, true, false)).toBeNull();
	});
});

describe('preferences', () => {
	const memory = (
		initial: Record<string, string> = {}
	): KeyValueStorage & {
		data: Record<string, string>;
	} => {
		const data = { ...initial };
		return {
			data,
			getItem: (key) => data[key] ?? null,
			setItem: (key, value) => void (data[key] = value),
			removeItem: (key) => void delete data[key]
		};
	};
	const throwing: KeyValueStorage = {
		getItem: () => {
			throw new Error('blocked');
		},
		setItem: () => {
			throw new Error('blocked');
		},
		removeItem: () => {
			throw new Error('blocked');
		}
	};

	it('defaults without storage or when it throws', () => {
		for (const storage of [null, throwing]) {
			expect(loadVolume(storage)).toBe(1);
			expect(loadSkipActive(storage)).toBe(true);
			expect(loadSubtitleLanguage(storage)).toBeNull();
			expect(() => saveVolume(storage, 0.5)).not.toThrow();
		}
	});

	it('clamps and sanitises the stored volume', () => {
		expect(loadVolume(memory({ 'pivi:player:volume': '7' }))).toBe(1);
		expect(loadVolume(memory({ 'pivi:player:volume': '-1' }))).toBe(0);
		expect(loadVolume(memory({ 'pivi:player:volume': 'loud' }))).toBe(1);
	});

	it('round trips volume and subtitle language, and clears with null', () => {
		const storage = memory();
		saveVolume(storage, 0.25);
		expect(loadVolume(storage)).toBe(0.25);
		saveSubtitleLanguage(storage, 'de');
		expect(loadSubtitleLanguage(storage)).toBe('de');
		saveSubtitleLanguage(storage, null);
		expect(loadSubtitleLanguage(storage)).toBeNull();
	});

	it('reads the skip toggle as a boolean string', () => {
		expect(loadSkipActive(memory({ 'pivi:player:skipActive': 'false' }))).toBe(false);
		expect(loadSkipActive(memory({ 'pivi:player:skipActive': 'true' }))).toBe(true);
	});

	it('accepts off or an offered language only', () => {
		const tracks = [{ language: 'en' }, { language: 'de' }];
		expect(isOfferedSubtitle(tracks, null)).toBe(true);
		expect(isOfferedSubtitle(tracks, 'de')).toBe(true);
		expect(isOfferedSubtitle(tracks, 'fr')).toBe(false);
	});
});

describe('urls', () => {
	const urls = createSessionUrls('yt/app', 'a b');

	it('encodes ids and carries quality and offset', () => {
		expect(urls.stream(30, 720)).toBe('/api/stream/yt%2Fapp/a%20b?t=30&quality=720');
		expect(urls.track('video', 1080)).toBe('/api/stream-track/yt%2Fapp/a%20b/video?quality=1080');
		expect(urls.trackIndex('audio', 'webm', 480)).toBe(
			'/api/stream-track/yt%2Fapp/a%20b/audio/index?container=webm&quality=480'
		);
		expect(urls.subtitle('pt-BR')).toBe('/api/stream-subtitle/yt%2Fapp/a%20b/pt-BR');
	});

	it('builds the next entry of a sequence', () => {
		expect(nextSessionHref('app', 'next', 'playlist:1')).toBe(
			'/play/app/next?context=playlist%3A1'
		);
	});
});

describe('describeError', () => {
	it('reads shaka errors, DOM exceptions, errors and anything else', () => {
		expect(describeError({ category: 4, code: 4001, message: 'x' })).toBe(
			'Shaka error (category 4, code 4001): x'
		);
		expect(describeError(new DOMException('nope', 'NotSupportedError'))).toBe(
			'NotSupportedError: nope'
		);
		expect(describeError(new Error('boom'))).toBe('boom');
		expect(describeError('plain')).toBe('plain');
	});

	it('reads the MediaError off a video error event', () => {
		const event = new Event('error');
		Object.defineProperty(event, 'target', { value: { error: { code: 3, message: '' } } });
		expect(describeError(event)).toBe('MediaError 3: (no message)');
	});
});

describe('time helpers', () => {
	it('formats positions', () => {
		expect(formatTime(65)).toBe('1:05');
		expect(formatTime(-1)).toBe('0:00');
		expect(formatTime(NaN)).toBe('0:00');
	});

	it('measures what is buffered past the playhead', () => {
		const ranges = {
			length: 2,
			start: (i: number) => [0, 50][i],
			end: (i: number) => [20, 80][i]
		};
		expect(bufferedAheadSeconds(ranges, 10)).toBe(10);
		expect(bufferedAheadSeconds(ranges, 60)).toBe(20);
		expect(bufferedAheadSeconds(ranges, 30)).toBe(0);
	});
});
