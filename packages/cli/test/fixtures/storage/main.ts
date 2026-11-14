// Counts its own starts in /storage and reports which volumes it has, so the harness tests can
// check that dev storage persists across restarts and that only granted volumes exist.
import { defineApp } from '@pivi/sdk/app';
import { hasCache, hasStorage, readJson, storagePath, writeJson } from '@pivi/sdk/storage';

const FILE = storagePath('starts.json');

defineApp((app) => ({
	async onActivate() {
		const starts = ((await readJson<number>(FILE)) ?? 0) + 1;
		await writeJson(FILE, starts);
		app.publishDashboard({
			cards: [
				{
					kind: 'suggestion',
					id: 'starts',
					title: `starts=${starts}`,
					meta: `storage=${hasStorage()} cache=${hasCache()}`,
					image: 'https://example.com/x.jpg',
					action: { type: 'openOnPhone', url: 'https://example.com' }
				}
			]
		});
	}
}));
