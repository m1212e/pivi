// Search suggestions the way YouTube's TV app asks for them: the "living room"
// client of the suggest endpoint, with the signed-in account's token. That is
// what makes them personal (the web client variant ignores the token), unlike
// youtubei.js's own getSearchSuggestions.
import type { Innertube } from 'youtubei.js';

const ENDPOINT = 'https://suggestqueries-clients6.youtube.com/complete/search';
const LIMIT = 6;

// The answer is JSONP, `window.google.ac.h([query, [[text, ...], ...], ...])`.
export function parseSuggestions(body: string): string[] {
	const start = body.indexOf('(');
	const end = body.lastIndexOf(')');
	if (start < 0 || end < start) return [];
	const data: unknown = JSON.parse(body.slice(start + 1, end));
	const entries = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
	const texts = entries.flatMap((entry: unknown) =>
		Array.isArray(entry) && typeof entry[0] === 'string' ? [entry[0]] : []
	);
	return [...new Set(texts)].slice(0, LIMIT);
}

// Not always UTF-8, the charset comes in the content type.
async function readBody(response: Response): Promise<string> {
	const charset = /charset=([^;]+)/i.exec(response.headers.get('content-type') ?? '')?.[1];
	return new TextDecoder(charset?.trim() ?? 'utf-8').decode(await response.arrayBuffer());
}

export async function fetchSuggestions(innertube: Innertube, query: string): Promise<string[]> {
	const { hl, gl } = innertube.session.context.client;
	const url = new URL(ENDPOINT);
	url.search = new URLSearchParams({ client: 'youtube-lr', ds: 'yt', hl, gl, q: query }).toString();

	const headers: Record<string, string> = {};
	const { oauth, logged_in } = innertube.session;
	if (logged_in && oauth.oauth2_tokens) {
		if (oauth.shouldRefreshToken()) await oauth.refreshAccessToken();
		headers.Authorization = `Bearer ${oauth.oauth2_tokens.access_token}`;
	}

	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`suggestions answered ${response.status}`);
	return parseSuggestions(await readBody(response));
}
