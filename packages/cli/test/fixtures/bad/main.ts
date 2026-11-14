// A deliberately broken app for the harness tests: it publishes an invalid card, answers
// resolveStream with a stream the host would reject and publishes a screen it never declared.
import { defineApp } from '@pivi/sdk/app';

defineApp((app) => ({
	onActivate() {
		app.publishDashboard({ cards: [{ kind: 'nope' }] } as never);
		app.publishScreen({ screenId: 'main', root: { type: 'spinner' } });
		// Not allowed by the manifest: the proxy has to refuse this.
		fetch('https://blocked.example.org/').catch(() => {});
	},
	resolveStream: () => ({ videoUrl: 'http://insecure.example.com/x.mp4' }) as never
}));
