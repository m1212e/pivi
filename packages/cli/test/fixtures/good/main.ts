import { defineApp } from '@pivi/sdk/app';

defineApp((app) => ({
	onActivate() {
		app.publishDashboard({ cards: [] });
		app.publishScreen({
			screenId: 'main',
			root: { type: 'button', label: 'Go', onSelect: 'go' }
		});
	},
	onUiEvent(event) {
		if (event.eventId === 'go') {
			app.publishScreen({ screenId: 'second', root: { type: 'text', value: 'Went' } });
		}
	}
}));
