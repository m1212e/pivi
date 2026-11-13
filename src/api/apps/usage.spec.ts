import { createPubSub } from 'graphql-yoga';
import { describe, expect, it, vi } from 'vitest';
import { createUsageTracker, releaseWhenDone } from './usage';

describe('the usage tracker', () => {
	const setup = () => {
		let time = 0;
		const usage = createUsageTracker(100, () => time);
		return { usage, advance: (ms: number) => (time += ms) };
	};

	it('calls an app idle once the window passed without use', () => {
		const { usage, advance } = setup();
		usage.touch('demo');
		advance(99);
		expect(usage.idle(['demo'])).toEqual([]);
		advance(1);
		expect(usage.idle(['demo'])).toEqual(['demo']);
	});

	it('restarts the window on every use', () => {
		const { usage, advance } = setup();
		usage.touch('demo');
		advance(80);
		usage.touch('demo');
		advance(80);
		expect(usage.idle(['demo'])).toEqual([]);
	});

	it('never calls a held app idle, and starts the window when the hold ends', () => {
		const { usage, advance } = setup();
		const release = usage.hold('demo');
		advance(1_000);
		expect(usage.idle(['demo'])).toEqual([]);
		release();
		release();
		advance(99);
		expect(usage.idle(['demo'])).toEqual([]);
		advance(1);
		expect(usage.idle(['demo'])).toEqual(['demo']);
	});

	it('keeps an app held while any of several holds is open', () => {
		const { usage, advance } = setup();
		const first = usage.hold('demo');
		const second = usage.hold('demo');
		first();
		advance(1_000);
		expect(usage.idle(['demo'])).toEqual([]);
		second();
		advance(100);
		expect(usage.idle(['demo'])).toEqual(['demo']);
	});

	it('judges apps independently and leaves one it never saw alone', () => {
		const { usage, advance } = setup();
		usage.touch('a');
		advance(50);
		usage.touch('b');
		advance(50);
		expect(usage.idle(['a', 'b', 'unknown'])).toEqual(['a']);
	});
});

describe('releaseWhenDone', () => {
	it('releases on unsubscribe even while waiting for the next event', async () => {
		const pubsub = createPubSub<{ topic: [number] }>();
		const release = vi.fn();
		const iterator = releaseWhenDone(pubsub.subscribe('topic'), release);

		const pending = iterator.next();
		await iterator.return?.();
		expect(release).toHaveBeenCalledTimes(1);
		await expect(pending).resolves.toMatchObject({ done: true });
	});

	it('passes events through until then', async () => {
		const pubsub = createPubSub<{ topic: [number] }>();
		const release = vi.fn();
		const iterator = releaseWhenDone(pubsub.subscribe('topic'), release);

		const next = iterator.next();
		pubsub.publish('topic', 7);
		await expect(next).resolves.toEqual({ done: false, value: 7 });
		expect(release).not.toHaveBeenCalled();
		await iterator.return?.();
	});
});
