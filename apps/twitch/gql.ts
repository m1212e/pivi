// Twitch's own GraphQL endpoint, the one twitch.tv itself uses. Anonymous
// requests with the website's public client id can read the public lists
// (live streams, categories, search) and get playback tokens. Signed in
// (auth.ts), requests go out as the Twitch TV app with the account's token,
// which is what makes `currentUser` and the account's follows answer. It is
// not a documented API, so every query here keeps to long-stable fields, and
// a shape change surfaces as a retry card rather than a crash.
import { accessToken, recoverFromRejection, TV_CLIENT_ID } from './auth';

const ENDPOINT = 'https://gql.twitch.tv/gql';
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
// Well inside the host's request timeout, which kills an app that doesn't answer.
const TIMEOUT_MS = 10_000;

type GqlResponse<T> = { data?: T; errors?: { message: string }[] };

async function headersFor(anonymous: boolean): Promise<Record<string, string>> {
	const token = anonymous ? undefined : await accessToken();
	return token
		? { 'Client-Id': TV_CLIENT_ID, Authorization: `OAuth ${token}` }
		: { 'Client-Id': WEB_CLIENT_ID };
}

async function post(query: string, variables: Record<string, unknown>, anonymous: boolean) {
	return fetch(ENDPOINT, {
		method: 'POST',
		headers: { ...(await headersFor(anonymous)), 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
}

/**
 * One query, as the signed-in account when there is one. `anonymous` forces
 * the website's identity, for requests that must not depend on the account.
 */
export async function gql<T>(
	query: string,
	variables: Record<string, unknown> = {},
	{ anonymous = false } = {}
): Promise<T> {
	let response = await post(query, variables, anonymous);
	// A revoked or silently expired token: renew once, or go on signed out.
	if (response.status === 401 && !anonymous) {
		await recoverFromRejection();
		response = await post(query, variables, anonymous);
	}
	if (!response.ok) throw new Error(`Twitch GQL answered ${response.status}`);
	const body = (await response.json()) as GqlResponse<T>;
	if (body.errors?.length) throw new Error(`Twitch GQL: ${body.errors[0].message}`);
	if (!body.data) throw new Error('Twitch GQL returned no data');
	return body.data;
}

/** One live stream as every list in this app shows it. */
export type LiveStream = {
	login: string;
	displayName: string;
	title: string;
	viewers: number;
	preview: string;
	game?: string;
};

/** A category (Twitch calls them games), shown as box art. */
export type Category = { id: string; name: string; boxArt: string; viewers: number };

/** A channel from search, live or not. */
export type Channel = {
	login: string;
	displayName: string;
	avatar: string;
	stream?: LiveStream;
};

// 16:9 at a size that stays sharp on a 1080p TV card.
const STREAM_FIELDS = `
	title
	viewersCount
	previewImageURL(width: 640, height: 360)
	game { displayName }
`;
const STREAM_NODE = `
	${STREAM_FIELDS}
	broadcaster { login displayName }
`;

type RawStream = {
	title: string | null;
	viewersCount: number | null;
	previewImageURL: string | null;
	game: { displayName: string } | null;
};
type RawStreamNode = RawStream & {
	broadcaster: { login: string; displayName: string } | null;
};
type Edges<T> = { edges: { node: T | null }[] | null };

function toStream(raw: RawStream, login: string, displayName: string): LiveStream {
	return {
		login,
		displayName,
		title: raw.title ?? '',
		viewers: raw.viewersCount ?? 0,
		preview: raw.previewImageURL ?? '',
		game: raw.game?.displayName
	};
}

function fromEdges<T, R>(edges: Edges<R> | null | undefined, map: (node: R) => T | undefined): T[] {
	return (edges?.edges ?? []).flatMap((edge) => {
		const item = edge.node ? map(edge.node) : undefined;
		return item ? [item] : [];
	});
}

function streamFromNode(node: RawStreamNode): LiveStream | undefined {
	return node.broadcaster
		? toStream(node, node.broadcaster.login, node.broadcaster.displayName)
		: undefined;
}

// Anonymous requests can't page: passing a cursor (`after`) fails Twitch's
// integrity check, which only a real browser session passes. So every list
// is one request at the largest size the field accepts, and there is no
// infinite scroll.
const TOP_STREAMS = 30;
const LIST_SIZE = 100;

/** The most watched live streams right now, across all categories. */
export async function topStreams(): Promise<LiveStream[]> {
	const data = await gql<{ streams: Edges<RawStreamNode> | null }>(
		`query($first: Int!) {
			streams(first: $first) { edges { node { ${STREAM_NODE} } } }
		}`,
		{ first: TOP_STREAMS }
	);
	return fromEdges(data.streams, streamFromNode);
}

type RawGame = {
	id: string;
	displayName: string;
	viewersCount: number | null;
	boxArtURL: string | null;
};

function toCategory(raw: RawGame): Category {
	return {
		id: raw.id,
		name: raw.displayName,
		boxArt: raw.boxArtURL ?? '',
		viewers: raw.viewersCount ?? 0
	};
}

// Box art is 3:4, the shape of the shell's poster cards.
const GAME_FIELDS = 'id displayName viewersCount boxArtURL(width: 285, height: 380)';

/** Categories by how many are watching them. */
export async function topCategories(): Promise<Category[]> {
	const data = await gql<{ games: Edges<RawGame> | null }>(
		`query($first: Int!) {
			games(first: $first, options: { sort: VIEWER_COUNT }) { edges { node { ${GAME_FIELDS} } } }
		}`,
		{ first: LIST_SIZE }
	);
	return fromEdges(data.games, toCategory);
}

/** Live streams in one category, most watched first. */
export async function categoryStreams(id: string): Promise<LiveStream[]> {
	const data = await gql<{ game: { streams: Edges<RawStreamNode> | null } | null }>(
		`query($id: ID!, $first: Int!) {
			game(id: $id) { streams(first: $first) { edges { node { ${STREAM_NODE} } } } }
		}`,
		{ id, first: LIST_SIZE }
	);
	return fromEdges(data.game?.streams, streamFromNode);
}

type RawChannel = {
	login: string;
	displayName: string;
	profileImageURL: string | null;
	stream: RawStream | null;
};

/** What a search finds: channels (live ones first) and categories. */
export type SearchResults = { channels: Channel[]; categories: Category[] };

export async function search(query: string): Promise<SearchResults> {
	const data = await gql<{
		searchFor: {
			channels: { items: RawChannel[] | null } | null;
			games: { items: RawGame[] | null } | null;
		} | null;
	}>(
		`query($query: String!) {
			searchFor(userQuery: $query, platform: "web") {
				channels { items { login displayName profileImageURL(width: 300) stream { ${STREAM_FIELDS} } } }
				games { items { ${GAME_FIELDS} } }
			}
		}`,
		{ query }
	);
	const channels = (data.searchFor?.channels?.items ?? []).map((raw): Channel => ({
		login: raw.login,
		displayName: raw.displayName,
		avatar: raw.profileImageURL ?? '',
		stream: raw.stream ? toStream(raw.stream, raw.login, raw.displayName) : undefined
	}));
	return {
		channels,
		categories: (data.searchFor?.games?.items ?? []).map(toCategory)
	};
}

/** The signed-in account, as the sidebar shows it. */
export type Account = { login: string; displayName: string; avatar: string };

/** Who the token belongs to, undefined when Twitch doesn't know it (signed out). */
export async function currentAccount(): Promise<Account | undefined> {
	const data = await gql<{
		currentUser: { login: string; displayName: string; profileImageURL: string | null } | null;
	}>(`query { currentUser { login displayName profileImageURL(width: 70) } }`);
	const user = data.currentUser;
	return user
		? { login: user.login, displayName: user.displayName, avatar: user.profileImageURL ?? '' }
		: undefined;
}

type RawFollowedUser = { login: string; displayName: string; stream: RawStream | null };

/** Live channels the signed-in account follows, most watched first. */
export async function followedLive(): Promise<LiveStream[]> {
	const data = await gql<{
		currentUser: { followedLiveUsers: Edges<RawFollowedUser> | null } | null;
	}>(
		`query($first: Int!) {
			currentUser { followedLiveUsers(first: $first) { edges { node { login displayName stream { ${STREAM_FIELDS} } } } } }
		}`,
		{ first: LIST_SIZE }
	);
	if (!data.currentUser) throw new Error('Not signed in');
	return fromEdges(data.currentUser.followedLiveUsers, (node) =>
		node.stream ? toStream(node.stream, node.login, node.displayName) : undefined
	).sort((a, b) => b.viewers - a.viewers);
}

/** A live channel's current viewer count, undefined once it's offline. */
export async function viewerCount(login: string): Promise<number | undefined> {
	const data = await gql<{ user: { stream: { viewersCount: number | null } | null } | null }>(
		`query($login: String!) { user(login: $login) { stream { viewersCount } } }`,
		{ login },
		{ anonymous: true }
	);
	return data.user?.stream?.viewersCount ?? undefined;
}
