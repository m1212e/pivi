import { describe, expect, it, vi } from 'vitest';
import type { AppManifest } from '#sdk/manifest';
import { encodeMessage } from '#sdk/ndjson';
import { PROTOCOL_VERSION } from '#sdk/protocol';
import { loadApp, urlAllowed } from './runtime';
import type { RunningSandbox, SandboxHandlers } from './sandbox/types';

const manifest = {
	id: 'demo',
	permissions: ['network'],
	network: { domains: ['*.example.com'] }
} as unknown as AppManifest;

describe('urlAllowed', () => {
	it('allows https on a declared domain', () => {
		expect(urlAllowed(manifest, ['network'], 'https://cdn.example.com/a', false)).toBe(true);
	});

	it('refuses plain http in production', () => {
		expect(urlAllowed(manifest, ['network'], 'http://cdn.example.com/a', false)).toBe(false);
	});

	it('allows plain http in development', () => {
		expect(urlAllowed(manifest, ['network'], 'http://cdn.example.com/a', true)).toBe(true);
	});

	it('refuses other domains and schemes either way', () => {
		for (const allowHttp of [true, false]) {
			expect(urlAllowed(manifest, ['network'], 'https://example.org/', allowHttp)).toBe(false);
			expect(urlAllowed(manifest, ['network'], 'ftp://cdn.example.com/', allowHttp)).toBe(false);
		}
	});

	it('refuses everything without the network grant', () => {
		expect(urlAllowed(manifest, [], 'https://cdn.example.com/a', true)).toBe(false);
	});
});

// A sandbox whose app says ready and then never answers a real request, with
// a CPU counter the test controls. `answersPing` makes it busy rather than hung.
function fakeSandbox(
	options: { ready?: boolean; answersPing?: boolean; cpuTimeNs?: () => number } = {}
) {
	const kill = vi.fn(() => Promise.resolve());
	const start = (handlers: SandboxHandlers): Promise<RunningSandbox> => {
		if (options.ready !== false) {
			setTimeout(() =>
				handlers.onStdout(
					encodeMessage({
						jsonrpc: '2.0',
						method: 'app/ready',
						params: { protocol: PROTOCOL_VERSION }
					})
				)
			);
		}
		const decoder = new TextDecoder();
		return Promise.resolve({
			write: (data: Uint8Array) => {
				for (const line of decoder.decode(data).split('\n').filter(Boolean)) {
					const message = JSON.parse(line) as { id?: number; method?: string };
					if (options.answersPing && message.method === 'host/ping') {
						handlers.onStdout(encodeMessage({ jsonrpc: '2.0', id: message.id, result: null }));
					}
				}
				return Promise.resolve();
			},
			stop: () => Promise.resolve(),
			kill,
			cpuTimeNs: () => Promise.resolve(options.cpuTimeNs?.())
		});
	};
	return { start, kill };
}

const playbackApp = {
	id: 'demo',
	name: 'Demo',
	protocol: PROTOCOL_VERSION,
	features: ['playback'],
	permissions: []
} as unknown as AppManifest;

describe('the app watchdog', () => {
	it('kills an app that answers neither a request nor the ping after it', async () => {
		const sandbox = fakeSandbox();
		const onForcedStop = vi.fn();
		const app = await loadApp({
			manifest: playbackApp,
			granted: [],
			start: sandbox.start,
			onForcedStop,
			watchdog: { resolveStreamMs: 30, pingMs: 30 }
		});
		await expect(app.resolveStream('x')).rejects.toThrow(/timed out/);
		await vi.waitFor(() => expect(onForcedStop).toHaveBeenCalledWith('unresponsive'));
		expect(sandbox.kill).toHaveBeenCalled();
	});

	it('only fails the request of an app that is slow but still answers a ping', async () => {
		const sandbox = fakeSandbox({ answersPing: true });
		const onForcedStop = vi.fn();
		const app = await loadApp({
			manifest: playbackApp,
			granted: [],
			start: sandbox.start,
			onForcedStop,
			watchdog: { resolveStreamMs: 30, pingMs: 30 }
		});
		await expect(app.resolveStream('x')).rejects.toThrow(/timed out/);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(onForcedStop).not.toHaveBeenCalled();
		expect(sandbox.kill).not.toHaveBeenCalled();
		await app.dispose();
	});

	it('kills an app that never becomes ready', async () => {
		const sandbox = fakeSandbox({ ready: false });
		const onForcedStop = vi.fn();
		await expect(
			loadApp({
				manifest: playbackApp,
				granted: [],
				start: sandbox.start,
				onForcedStop,
				watchdog: { readyMs: 30 }
			})
		).rejects.toThrow(/never became ready/);
		expect(onForcedStop).toHaveBeenCalledWith('unresponsive');
		expect(sandbox.kill).toHaveBeenCalled();
	});

	it('kills an app that keeps its vCPU busy with nothing asked of it', async () => {
		const startedAt = Date.now();
		const sandbox = fakeSandbox({ cpuTimeNs: () => (Date.now() - startedAt) * 1e6 });
		const onForcedStop = vi.fn();
		await loadApp({
			manifest: playbackApp,
			granted: [],
			start: sandbox.start,
			onForcedStop,
			watchdog: { cpuSampleMs: 10, cpuWindowMs: 60 }
		});
		await vi.waitFor(() => expect(onForcedStop).toHaveBeenCalledWith('cpu'));
		expect(sandbox.kill).toHaveBeenCalled();
	});

	it('leaves an idle app alone', async () => {
		const sandbox = fakeSandbox({ cpuTimeNs: () => 0 });
		const onForcedStop = vi.fn();
		const app = await loadApp({
			manifest: playbackApp,
			granted: [],
			start: sandbox.start,
			onForcedStop,
			watchdog: { cpuSampleMs: 10, cpuWindowMs: 60 }
		});
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(onForcedStop).not.toHaveBeenCalled();
		await app.dispose();
		expect(sandbox.kill).not.toHaveBeenCalled();
	});
});
