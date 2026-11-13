// Lets the root layout resolve a session while the stand-in for the player
// shows, so the player itself mounts without waiting.
import { client } from '#lib/api/rumbleClient/client';
import { screenStartHeight } from './quality';

/**
 * Settles once the server has the session's stream cached, so the player's own
 * lookup (same height, same cache entry) answers right away. Never rejects,
 * a failure is left for the player to show.
 */
export async function warmPlaybackSession(appId: string, sessionId: string): Promise<void> {
	try {
		await client.query.appPlaybackInfo({
			__args: { appId, sessionId, maxHeight: screenStartHeight() },
			title: true
		});
	} catch {
		// The player asks again and shows its error screen.
	}
}
