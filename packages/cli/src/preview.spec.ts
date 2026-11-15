import { afterEach, expect, it } from 'vitest';
import { Harness } from './harness';
import { startPreview, type Preview } from './preview';

const fixture = new URL('../test/fixtures/good', import.meta.url).pathname;
let harness: Harness | undefined;
let preview: Preview | undefined;
afterEach(async () => {
	await preview?.close();
	await harness?.close();
});

it('serves the page, the published state, and sends UI events to the app', async () => {
	harness = new Harness({ dir: fixture, conditions: ['pivi-source'] });
	await harness.start();
	await harness.settle(800);
	preview = await startPreview(harness);
	expect(preview.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

	const page = await fetch(preview.url).then((r) => r.text());
	expect(page).toContain('<title>pivi preview</title>');
	// App text is only ever set through textContent.
	expect(page).not.toContain('innerHTML');

	const state = await fetch(`${preview.url}state`).then((r) => r.json());
	expect(Object.keys(state.screens)).toEqual(['main']);
	expect(state.dashboard).toEqual({ cards: [] });

	await fetch(`${preview.url}event`, {
		method: 'POST',
		body: JSON.stringify({ screenId: 'main', eventId: 'go' })
	});
	await harness.settle(800);
	const after = await fetch(`${preview.url}state`).then((r) => r.json());
	expect(Object.keys(after.screens)).toContain('second');
});

it('says which port is taken', async () => {
	harness = new Harness({ dir: fixture, conditions: ['pivi-source'] });
	preview = await startPreview(harness);
	const port = Number(new URL(preview.url).port);
	await expect(startPreview(harness, port)).rejects.toThrow(`Port ${port} is in use`);
});
