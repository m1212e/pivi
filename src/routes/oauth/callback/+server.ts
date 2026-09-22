// Where every plugin's PhoneAuthHandoff redirect_uri points (see
// #lib/plugins/auth's PhoneAuthHandoff and plugins/runtime.ts's
// getPublicOrigin handler). One shared route rather than one per plugin —
// `state` is namespaced `<pluginId>:<nonce>` by the plugin itself, so this
// only needs to know which running plugin to hand the code to, not
// anything about what the login was for.
import { error, redirect } from '@sveltejs/kit';
import { getYoutubePlugin } from '#api/plugins/manager';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) error(400, 'Missing code or state');

	const [pluginId] = state.split(':');

	// Only one plugin exists today — a real multi-plugin system would look
	// this up in a registry (src/api/plugins/manager.ts) instead of a
	// hardcoded dispatch.
	if (pluginId === 'youtube') {
		const plugin = await getYoutubePlugin();
		plugin.deliverOAuthCode(code, state);
	} else {
		error(404, `Unknown plugin: ${pluginId}`);
	}

	// The phone is already paired — no token needed to reconnect the remote.
	redirect(302, '/remote');
};
