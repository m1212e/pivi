import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCommand } from './commands';
import { Harness } from './harness';

const fixture = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;

let harness: Harness | undefined;
afterEach(async () => {
	await harness?.close();
	harness = undefined;
});

async function run(name: string) {
	harness = new Harness({
		dir: fixture(name),
		// Bundle against the SDK's sources, so the tests need no SDK build.
		conditions: ['pivi-source']
	});
	await harness.start();
	await harness.settle(800);
	return harness;
}

describe('the harness with a well-behaved app', () => {
	it('records what the app publishes and routes ui events', async () => {
		const h = await run('good');
		expect(h.problems).toEqual([]);
		expect(h.dashboard.current).toEqual({ cards: [] });
		expect([...h.screens.keys()]).toEqual(['main']);

		expect(await executeCommand(h, 'screen main')).toContain('button "Go"');
		await executeCommand(h, 'event main go');
		expect([...h.screens.keys()]).toContain('second');
	});

	it('answers ping and refuses requests for features it did not declare', async () => {
		const h = await run('good');
		expect(await executeCommand(h, 'ping')).toMatch(/pong/);
		expect(await executeCommand(h, 'stream x')).toMatch(/"playback" is not declared/);
	});
});

describe('the harness with a broken app', () => {
	it('reports everything the host would reject or drop', async () => {
		const h = await run('bad');
		const problems = h.problems.map((p) => p.message).join('\n');
		expect(problems).toMatch(/app\/publishDashboard: the host rejects this/);
		// The manifest declares no `screen`, so the host drops the publish.
		expect(problems).toMatch(/app\/publishScreen: the host drops this/);

		const reply = await h.request('app/resolveStream', { sessionId: 'a' });
		expect(reply.valid).toBe(false);
		expect(h.problems.map((p) => p.message).join('\n')).toMatch(/rejects this answer/);
	});

	it('blocks connections outside network.domains', async () => {
		const h = await run('bad');
		await h.settle(500);
		const blocked = [...(h.proxy?.connections.values() ?? [])].filter((c) => !c.allowed);
		expect(blocked.map((c) => c.host)).toContain('blocked.example.org');
		expect(await executeCommand(h, 'domains')).toMatch(/BLOCKED\s+blocked\.example\.org/);
	});
});

describe('the harness with storage', () => {
	it('mounts only granted volumes and keeps storage across restarts', async () => {
		const dir = fixture('storage');
		rmSync(join(dir, '.pivi-dev'), { recursive: true, force: true });

		const first = await run('storage');
		const card = () => first.dashboard.current?.cards[0];
		expect(card()).toMatchObject({ title: 'starts=1', meta: 'storage=true cache=false' });

		await executeCommand(first, 'restart');
		expect(card()).toMatchObject({ title: 'starts=2' });
		rmSync(join(dir, '.pivi-dev'), { recursive: true, force: true });
	});
});
