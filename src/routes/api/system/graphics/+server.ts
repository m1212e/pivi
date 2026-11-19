// Read by the TV's graphics page. Loopback only, like everything under /api
// (hooks.server.ts), since it includes the kiosk's log.
import { graphicsReport } from '#api/graphicsReport';

export const GET = async () =>
	new Response(await graphicsReport(), {
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
