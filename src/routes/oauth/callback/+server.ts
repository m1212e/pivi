// Where every plugin's PhoneAuthHandoff redirect_uri points (see
// #lib/plugins/auth's PhoneAuthHandoff and plugins/runtime.ts's
// getPublicOrigin handler). One shared route rather than one per plugin —
// `state` is namespaced `<pluginId>:<nonce>` by the plugin itself, so this
// only needs to know which running plugin to hand the code to, not
// anything about what the login was for.
import { error, redirect } from '@sveltejs/kit';
import { getPlugin } from '#api/plugins/manager';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) error(400, 'Missing code or state');

	const [pluginId] = state.split(':');

	let plugin;
	try {
		plugin = await getPlugin(pluginId);
	} catch {
		error(404, `Unknown plugin: ${pluginId}`);
	}
	plugin.deliverOAuthCode(code, state);

	// The phone is already paired — no token needed to reconnect the remote.
	redirect(302, '/remote');
};
