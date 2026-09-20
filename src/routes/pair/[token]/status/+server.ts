import { json } from '@sveltejs/kit';
import { consumeResolvedPairing } from '#lib/server/pairing';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const cookie = consumeResolvedPairing(params.token);
	if (!cookie) return json({ resolved: false });

	return json(
		{ resolved: true },
		{
			headers: { 'set-cookie': cookie }
		}
	);
};
