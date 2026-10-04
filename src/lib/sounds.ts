// Synthesized UI sound effects for the TV surface, in the spirit of Steam Big
// Picture: short, soft, low-passed blips rather than harsh beeps. Generated
// with WebAudio so there are no audio assets to ship, and every sound is
// quiet by design -- this is feedback, not a notification.

type Note = {
	freq: number;
	// Seconds after the sound's start.
	at: number;
	duration: number;
	gain: number;
	type?: OscillatorType;
	// Optional pitch glide to this frequency over the note's duration.
	glideTo?: number;
	// A band-passed noise burst centred on `freq` instead of an oscillator --
	// gives a tap its physical contact texture.
	noise?: boolean;
	// Resonance of the noise band-pass; higher rings more like a pitched tap.
	q?: number;
	// Attack time in seconds; defaults to a near-instant click-free onset.
	attack?: number;
};

const MASTER_GAIN = 0.5;

let context: AudioContext | undefined;
let master: GainNode | undefined;

function ensureContext(): AudioContext | undefined {
	if (typeof AudioContext === 'undefined') return undefined;
	if (!context) {
		try {
			context = new AudioContext();
			const filter = context.createBiquadFilter();
			filter.type = 'lowpass';
			filter.frequency.value = 3200;
			master = context.createGain();
			master.gain.value = MASTER_GAIN;
			master.connect(filter).connect(context.destination);
		} catch {
			return undefined;
		}
	}
	return context;
}

// Remote-driven sounds aren't triggered by a user gesture in this page, so a
// browser enforcing its autoplay policy leaves the context suspended (and a
// full page load, like login -> /home, resets that). The kiosk is launched
// with --autoplay-policy=no-user-gesture-required and never hits this.
const RESUME_GRACE_MS = 150;
let warnedBlocked = false;

function whenRunning(ctx: AudioContext): Promise<boolean> {
	if (ctx.state === 'running') return Promise.resolve(true);
	// Don't wait indefinitely: a sound that plays seconds late (on the next
	// click, say) is worse than none, and resume() stays pending until a gesture.
	const timeout = new Promise<boolean>((done) => setTimeout(() => done(false), RESUME_GRACE_MS));
	const resumed = ctx.resume().then(
		() => ctx.state === 'running',
		() => false
	);
	return Promise.race([resumed, timeout]);
}

// Any real gesture unlocks the context for every later sound.
if (typeof document !== 'undefined') {
	const unlock = () => {
		if (context?.state === 'suspended') void context.resume().catch(() => {});
	};
	for (const type of ['pointerdown', 'keydown', 'touchstart'])
		document.addEventListener(type, unlock, { capture: true, passive: true });
}

// A generated room impulse (decaying stereo noise) -- no audio assets. Only
// sounds that ask for a `wet` amount are sent to it, so taps stay dry.
let reverb: ConvolverNode | undefined;

function reverbInput(ctx: AudioContext): ConvolverNode {
	if (reverb) return reverb;
	const seconds = 2.4;
	const length = Math.floor(ctx.sampleRate * seconds);
	const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
	for (let channel = 0; channel < 2; channel++) {
		const data = impulse.getChannelData(channel);
		for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
	}
	reverb = ctx.createConvolver();
	reverb.buffer = impulse;
	reverb.connect(master!);
	return reverb;
}

let noiseBuffer: AudioBuffer | undefined;

function noiseSource(
	ctx: AudioContext,
	freq: number,
	q: number
): AudioNode & { start(when: number): void; stop(when: number): void } {
	if (!noiseBuffer) {
		noiseBuffer = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
		const data = noiseBuffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	}
	const source = ctx.createBufferSource();
	source.buffer = noiseBuffer;
	const band = ctx.createBiquadFilter();
	band.type = 'bandpass';
	band.frequency.value = freq;
	band.Q.value = q;
	source.connect(band);
	// Expose the filter as the output node while keeping start/stop on the source.
	return Object.assign(band, {
		start: (when: number) => source.start(when),
		stop: (when: number) => source.stop(when)
	});
}

function playNote(ctx: AudioContext, out: AudioNode, start: number, note: Note) {
	const env = ctx.createGain();
	const t0 = start + note.at;
	const t1 = t0 + note.duration;
	let osc: AudioNode & { start(when: number): void; stop(when: number): void };
	if (note.noise) {
		osc = noiseSource(ctx, note.freq, note.q ?? 0.8);
	} else {
		const oscillator = ctx.createOscillator();
		oscillator.type = note.type ?? 'sine';
		oscillator.frequency.setValueAtTime(note.freq, t0);
		if (note.glideTo) oscillator.frequency.exponentialRampToValueAtTime(note.glideTo, t1);
		osc = oscillator;
	}
	// Fast attack, exponential decay: the "soft bloop" envelope.
	env.gain.setValueAtTime(0.0001, t0);
	env.gain.exponentialRampToValueAtTime(
		note.gain,
		t0 + (note.attack ?? Math.min(0.008, note.duration / 10))
	);
	env.gain.exponentialRampToValueAtTime(0.0001, t1);
	osc.connect(env).connect(out);
	osc.start(t0);
	osc.stop(t1 + 0.02);
}

// A fresh output bus into the shared master chain (and, for `wet` > 0, the
// reverb too), or undefined when the browser's autoplay policy has the
// context blocked. Each caller gets its own bus so it can fade or disconnect
// independently of everything else.
export async function openBus(wet = 0): Promise<{ ctx: AudioContext; bus: GainNode } | undefined> {
	const ctx = ensureContext();
	if (!ctx || !master) return undefined;
	if (!(await whenRunning(ctx))) {
		if (!warnedBlocked) {
			warnedBlocked = true;
			console.warn(
				'[sounds] Audio is blocked by the browser autoplay policy until the page gets a user ' +
					'gesture. Launch the browser with --autoplay-policy=no-user-gesture-required.'
			);
		}
		return undefined;
	}
	const bus = ctx.createGain();
	bus.connect(master);
	if (wet > 0) {
		const send = ctx.createGain();
		send.gain.value = wet;
		bus.connect(send).connect(reverbInput(ctx));
	}
	return { ctx, bus };
}

async function play(notes: Note[], wet = 0) {
	const output = await openBus(wet);
	if (!output) return;
	const start = output.ctx.currentTime + 0.005;
	for (const note of notes) playNote(output.ctx, output.bus, start, note);
}

const SOUNDS = {
	// Focus moving between items: a very short, soft tick.
	move: [{ freq: 400, glideTo: 360, at: 0, duration: 0.075, gain: 0.2 }],
	// Activating something: the dry, woody "tock" of the old iOS keyboard
	// click. Very short (~20 ms) with an almost instant attack: a resonant
	// noise burst gives the hollow-wood ring, a tiny sine that drops slightly
	// in pitch gives it a defined "tok", and a faint low thump adds body.
	select: [
		{ freq: 1250, q: 4, at: 0, duration: 0.03, gain: 0.65, noise: true },
		{ freq: 1050, glideTo: 750, at: 0, duration: 0.025, gain: 0.27 },
		{ freq: 240, glideTo: 170, at: 0, duration: 0.03, gain: 0.24 }
	],
	// Landing on the home screen: a warm, slowly blooming chord rather than a
	// bright arpeggio (which reads as an 8-bit jingle). Just three notes, a
	// plain D major triad (D3 F#3 A3) -- the major third is what makes it
	// read as happy, and all of it sits low so nothing is sharp. Each pitch
	// is doubled by a slightly detuned partner for a string-pad shimmer. Slow
	// attacks, staggered entries from the bottom up, long decays; reverb is
	// added in playSound.
	home: [
		{ freq: 146.8, at: 0, duration: 3.8, gain: 0.28, attack: 0.5 },
		{ freq: 147.6, at: 0, duration: 3.8, gain: 0.17, attack: 0.5, type: 'triangle' },
		{ freq: 185, at: 0.3, duration: 3.5, gain: 0.22, attack: 0.65 },
		{ freq: 185.7, at: 0.3, duration: 3.5, gain: 0.13, attack: 0.65, type: 'triangle' },
		{ freq: 220, at: 0.6, duration: 3.2, gain: 0.2, attack: 0.8 },
		{ freq: 221.2, at: 0.6, duration: 3.2, gain: 0.12, attack: 0.8, type: 'triangle' }
	]
} satisfies Record<string, Note[]>;

export type SoundName = keyof typeof SOUNDS;

// How much of each sound goes through the reverb; anything not listed is dry.
const REVERB_WET: Partial<Record<SoundName, number>> = { home: 0.45 };

export function playSound(name: SoundName) {
	void play(SOUNDS[name], REVERB_WET[name]);
}
