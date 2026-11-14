// The app from the README, run as a child process by app.spec.ts.
import { defineApp } from '../src/app';

defineApp((app) => ({
	onActivate() {
		app.publishDashboard({
			cards: [
				{
					kind: 'suggestion',
					id: 'demo',
					title: 'Big Buck Bunny',
					meta: 'Blender Foundation',
					image: 'https://example.com/bunny.jpg',
					action: { type: 'session', sessionId: 'bunny' }
				}
			]
		});
	},
	resolveStream: ({ sessionId }) => ({
		videoUrl: `https://example.com/${sessionId}.mp4`,
		vcodec: 'h264',
		videoContainer: 'mp4',
		title: 'Big Buck Bunny',
		duration: 596
	})
}));
