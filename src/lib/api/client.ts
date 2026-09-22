import { Client, CombinedError, cacheExchange, fetchExchange, type Exchange } from '@urql/core';
import { empty, filter, fromPromise, merge, mergeMap, pipe } from 'wonka';
import { browser } from '$app/env';
import { graphqlMutation, graphqlQuery } from '../../api/graphql.remote';

// Runs queries/mutations through the SvelteKit remote functions during SSR
// (an in-process call) instead of the browser's HTTP round-trip to our own
// GraphQL endpoint. The browser always falls through to fetchExchange below —
// pivi has no offline/cache-persistence needs, just this SSR shortcut.
const remoteFunctionsExchange: Exchange = ({ forward }) => {
	return (operations) => {
		const handledHere = pipe(
			operations,
			filter((operation) => operation.kind !== 'teardown' && !browser),
			mergeMap((operation) => {
				const caller =
					operation.kind === 'query'
						? graphqlQuery
						: operation.kind === 'mutation'
							? graphqlMutation
							: undefined;
				if (!caller) return empty;

				return fromPromise(
					(async () => {
						const result = await caller({
							query: operation.query,
							variables: operation.variables as Exclude<typeof operation.variables, void>
						});

						return {
							operation,
							data: structuredClone(result.data),
							error: Array.isArray(result.errors)
								? new CombinedError({ graphQLErrors: result.errors })
								: undefined,
							extensions: result.extensions ? { ...result.extensions } : undefined,
							stale: false
						};
					})()
				);
			})
		);

		const forwarded = pipe(
			operations,
			filter((operation) => operation.kind === 'teardown' || browser),
			forward
		);

		return merge([handledHere, forwarded]);
	};
};

const exchanges: Exchange[] = [];
if (!browser) exchanges.push(remoteFunctionsExchange);
exchanges.push(cacheExchange, fetchExchange);

export const urqlClient = new Client({
	url: '/api/graphql',
	exchanges,
	fetchOptions: { credentials: 'include' },
	// graphql-yoga serves subscriptions over SSE on the same endpoint, and
	// fetchExchange only picks up "subscription" operations (as used by
	// liveQuery) when this is set — otherwise they're left unhandled.
	fetchSubscriptions: true,
	// Several pages poll a liveQuery on a plain setInterval instead of a real
	// subscription (anything not backed by a DB table rumble can push
	// updates for — the YouTube plugin's auth/screen/dashboard fields, the
	// pairing QR refresh): urql's default 'cache-first' policy serves those
	// repeat identical queries straight from cache and never re-fetches, so
	// the UI silently never sees the change on the server (e.g. a device
	// code appearing after "Sign in" is clicked). 'cache-and-network' keeps
	// the fast cached response but always revalidates over the network too.
	requestPolicy: 'cache-and-network'
});
