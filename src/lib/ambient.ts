// Quiet, continuous background music for the home screen: a slow, cheerful
// D-major chord progression of soft, low pads that never stops, with a gentle
// "swirl" -- each group of voices drifts slowly in loudness, brightness and
// stereo position, each at its own unrelated pace, so the sound is always
// moving but never builds, never repeats a pattern you could notice and
// never demands attention. Everything is synthesized (no assets), stays low
// (nothing above ~280 Hz), and fades in and out.

import { openBus } from './sounds';

// Open voicings, bass first, all low. Every chord is plain major with its
// bright third present -- no minor or suspended chords anywhere, so the mood
// never turns wistful or unresolved -- and the progression is I-IV-V-IV in D
// (D, G, A, G), the classic uplifting loop that always lands back home. All
// notes stay inside D major, so every chord is consonant with the next.
const CHORDS: number[][] = [
	[73.4, 110, 146.8, 185, 220], // D major: D2 A2 D3 F#3 A3
	[98, 123.5, 146.8, 196, 246.9], // G major: G2 B2 D3 G3 B3
	[110, 164.8, 220, 277.2], // A major: A2 E3 A3 C#4
	[98, 123.5, 146.8, 196, 246.9] // G major again, leading back to D
];

// Seconds each chord holds before the next one takes over; chords overlap by
// their long attack/release, so the changes are felt rather than heard and
// there is never a gap.
const CHORD_SECONDS = 16;
const PAD_ATTACK = 5;
const PAD_RELEASE = 6;

// The swirl. Voices are dealt round-robin into these lanes, and each lane
// has its own slow LFOs (Hz) for loudness, filter brightness and left/right
// position. The rates are deliberately unrelated, so the three lanes drift
// in and out of step instead of pulsing together.
const LANES = [
	{ tremolo: 0.07, filter: 0.05, pan: 0.04 },
	{ tremolo: 0.11, filter: 0.08, pan: 0.065 },
	{ tremolo: 0.045, filter: 0.13, pan: 0.09 }
];
const TREMOLO_BASE = 0.9;
const TREMOLO_DEPTH = 0.1;
const FILTER_BASE_HZ = 900;
const FILTER_DEPTH_HZ = 300;
const PAN_DEPTH = 0.5;

// Master level of the whole layer, and its fade times.
const LEVEL = 0.5;
const FADE_IN_SECONDS = 8;
const FADE_OUT_SECONDS = 2.5;
// Hold off at the start so the home intro chord can play on its own first.
const START_DELAY_MS = 5500;
const SCHEDULE_AHEAD_SECONDS = 2;
const WET = 0.55;

type Running = {
	ctx: AudioContext;
	bus: GainNode;
	// Where voices connect: one persistent, modulated input per lane.
	lanes: AudioNode[];
	oscillators: Set<OscillatorNode>;
	lfos: OscillatorNode[];
	timer: ReturnType<typeof setTimeout> | undefined;
	nextChordAt: number;
	chordIndex: number;
};

let running: Running | undefined;
let startTimer: ReturnType<typeof setTimeout> | undefined;
let wanted = false;
let removeGestureRetry: (() => void) | undefined;

// A slow sine that wobbles `target` by +/- `depth` around its own value.
function lfo(ctx: AudioContext, rate: number, depth: number, target: AudioParam) {
	const osc = ctx.createOscillator();
	const amount = ctx.createGain();
	osc.frequency.value = rate;
	amount.gain.value = depth;
	osc.connect(amount).connect(target);
	osc.start();
	return osc;
}

// One lane: input -> tremolo -> low-pass -> panner -> bus, each of the three
// stages slowly modulated at that lane's own rates.
function buildLane(ctx: AudioContext, bus: AudioNode, rates: (typeof LANES)[number]) {
	const tremolo = ctx.createGain();
	tremolo.gain.value = TREMOLO_BASE;
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = FILTER_BASE_HZ;
	filter.Q.value = 0.4;
	const panner = ctx.createStereoPanner();
	tremolo.connect(filter).connect(panner).connect(bus);
	const lfos = [
		lfo(ctx, rates.tremolo, TREMOLO_DEPTH, tremolo.gain),
		lfo(ctx, rates.filter, FILTER_DEPTH_HZ, filter.frequency),
		lfo(ctx, rates.pan, PAN_DEPTH, panner.pan)
	];
	return { input: tremolo, lfos };
}

function tone(
	state: Running,
	lane: AudioNode,
	freq: number,
	at: number,
	duration: number,
	gain: number,
	type: OscillatorType = 'sine'
) {
	const { ctx, oscillators } = state;
	const osc = ctx.createOscillator();
	const env = ctx.createGain();
	const end = at + duration;
	osc.type = type;
	osc.frequency.value = freq;
	// Linear fade in, hold, linear fade out: unlike a one-shot's exponential
	// decay this sustains, which is what makes it a pad rather than a pluck.
	env.gain.setValueAtTime(0, at);
	env.gain.linearRampToValueAtTime(gain, at + PAD_ATTACK);
	env.gain.setValueAtTime(gain, end - PAD_RELEASE);
	env.gain.linearRampToValueAtTime(0, end);
	osc.connect(env).connect(lane);
	osc.start(at);
	osc.stop(end + 0.05);
	oscillators.add(osc);
	osc.onended = () => {
		oscillators.delete(osc);
		osc.disconnect();
		env.disconnect();
	};
}

function scheduleChord(state: Running, at: number) {
	const chord = CHORDS[state.chordIndex % CHORDS.length];
	state.chordIndex++;
	const duration = CHORD_SECONDS + PAD_RELEASE;
	chord.forEach((freq, i) => {
		// Bass-up stagger, and a hair of random detune per voice, so repeats of
		// the loop never sound mechanically identical.
		const entry = at + i * 0.6;
		const drift = 1 + (Math.random() - 0.5) * 0.002;
		// Low notes sound quieter to the ear at equal amplitude, hence the lift.
		const gain = (i === 0 ? 0.08 : 0.055) * (1 - i * 0.06);
		const lane = state.lanes[i % state.lanes.length];
		tone(state, lane, freq * drift, entry, duration - i * 0.6, gain);
		tone(state, lane, freq * 1.002 * drift, entry, duration - i * 0.6, gain * 0.5, 'triangle');
	});
}

// Schedules everything that falls inside the next lookahead window, then
// re-arms itself. Audio-clock timing, so a late timer never makes it audibly
// stutter -- it just schedules a little further ahead on the next tick.
function tick() {
	const state = running;
	if (!state) return;
	const horizon = state.ctx.currentTime + SCHEDULE_AHEAD_SECONDS * 2;
	while (state.nextChordAt < horizon) {
		scheduleChord(state, state.nextChordAt);
		state.nextChordAt += CHORD_SECONDS;
	}
	state.timer = setTimeout(tick, SCHEDULE_AHEAD_SECONDS * 1000);
}

async function begin() {
	const output = await openBus(WET);
	if (!wanted || running) {
		output?.bus.disconnect();
		return;
	}
	if (!output) {
		// Autoplay blocked: try again on the first real gesture, if still wanted.
		const retry = () => {
			removeGestureRetry?.();
			if (wanted && !running) void begin();
		};
		const types = ['pointerdown', 'keydown', 'touchstart'];
		for (const type of types) document.addEventListener(type, retry, { once: true, capture: true });
		removeGestureRetry = () => {
			for (const type of types) document.removeEventListener(type, retry, { capture: true });
			removeGestureRetry = undefined;
		};
		return;
	}
	const { ctx, bus } = output;
	// The bus's own gain sits ahead of both its dry output and its reverb
	// send, so it doubles as the fader for the whole layer.
	const now = ctx.currentTime;
	bus.gain.setValueAtTime(0, now);
	bus.gain.linearRampToValueAtTime(LEVEL, now + FADE_IN_SECONDS);
	const laneNodes = LANES.map((rates) => buildLane(ctx, bus, rates));
	running = {
		ctx,
		bus,
		lanes: laneNodes.map((lane) => lane.input),
		oscillators: new Set(),
		lfos: laneNodes.flatMap((lane) => lane.lfos),
		timer: undefined,
		nextChordAt: now + 0.1,
		chordIndex: 0
	};
	tick();
}

export function startAmbient() {
	if (wanted) return;
	wanted = true;
	startTimer = setTimeout(() => void begin(), START_DELAY_MS);
}

export function stopAmbient() {
	wanted = false;
	clearTimeout(startTimer);
	removeGestureRetry?.();
	const state = running;
	if (!state) return;
	running = undefined;
	clearTimeout(state.timer);
	const now = state.ctx.currentTime;
	state.bus.gain.cancelScheduledValues(now);
	state.bus.gain.setValueAtTime(state.bus.gain.value, now);
	state.bus.gain.linearRampToValueAtTime(0, now + FADE_OUT_SECONDS);
	setTimeout(
		() => {
			for (const osc of state.oscillators) {
				try {
					osc.stop();
				} catch {
					// Already stopped.
				}
			}
			for (const osc of state.lfos) osc.stop();
			state.bus.disconnect();
		},
		FADE_OUT_SECONDS * 1000 + 100
	);
}
