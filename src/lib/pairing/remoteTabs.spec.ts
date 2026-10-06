import { describe, expect, it } from 'vitest';
import { requiredTabFor } from './remoteTabs';
import { MOVE_THRESHOLD, createTrackpadGestures } from './trackpadGestures';

const idle = { hasPinPad: false, hasTextInput: false, profiles: [], hasPlayer: false };

describe('requiredTabFor', () => {
	it('defaults to the trackpad', () => {
		expect(requiredTabFor(idle)).toBe('trackpad');
	});

	it('prefers the pin pad over everything else', () => {
		expect(
			requiredTabFor({ hasPinPad: true, hasTextInput: true, profiles: [{}], hasPlayer: true })
		).toBe('pin');
	});

	it('orders keyboard before profiles before player', () => {
		expect(requiredTabFor({ ...idle, hasTextInput: true, hasPlayer: true })).toBe('keyboard');
		expect(requiredTabFor({ ...idle, profiles: [{}], hasPlayer: true })).toBe('profiles');
		expect(requiredTabFor({ ...idle, hasPlayer: true })).toBe('player');
	});
});

describe('trackpad gestures', () => {
	function setup() {
		const log: string[] = [];
		const gestures = createTrackpadGestures({
			press: () => log.push('press'),
			release: () => log.push('release'),
			cancel: () => log.push('cancel'),
			move: (dx, dy) => log.push(`move ${dx},${dy}`)
		});
		return { log, gestures };
	}

	it('releases a tap', () => {
		const { log, gestures } = setup();
		gestures.start({ x: 0, y: 0 });
		gestures.end();
		expect(log).toEqual(['press', 'release']);
	});

	it('ignores jitter below the threshold', () => {
		const { log, gestures } = setup();
		gestures.start({ x: 0, y: 0 });
		gestures.move({ x: MOVE_THRESHOLD, y: 0 });
		gestures.end();
		expect(log).toEqual(['press', 'release']);
	});

	it('cancels the press once on the first swipe step and never releases', () => {
		const { log, gestures } = setup();
		gestures.start({ x: 0, y: 0 });
		gestures.move({ x: 100, y: 0 });
		gestures.move({ x: 100, y: 80 });
		gestures.end();
		expect(log).toEqual(['press', 'cancel', 'move 100,0', 'move 0,80']);
	});

	it('cancels when the OS interrupts a pending press', () => {
		const { log, gestures } = setup();
		gestures.start({ x: 0, y: 0 });
		gestures.interrupt();
		expect(log).toEqual(['press', 'cancel']);
	});
});
