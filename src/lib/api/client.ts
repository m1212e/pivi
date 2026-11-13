import {
	Client,
	CombinedError,
	cacheExchange,
	fetchExchange,
	makeOperation,
	type Exchange
} from '@urql/core';
import { empty, filter, fromPromise, map, merge, mergeMap, pipe } from 'wonka';
import { browser } from '$app/env';
import { graphqlMutation, graphqlQuery } from '../../api/graphql.remote';

// During SSR, runs queries and mutations in process through the SvelteKit
// remote functions instead of an HTTP round trip to our own GraphQL endpoint.
// The browser always falls through to fetchExchange.
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

// The generated client captures this one Client instance, so it can't be
// swapped for a fresh one when the active profile changes (login/register),
// and urql's document cache has no clear() of its own. Instead, after a
// reset the first execution of every query goes network-only, which both
// skips whatever the previous profile's cache holds for it and overwrites
// that entry with the new result.
let resetPending = false;
const refreshedSinceReset = new Set<number>();

/** Call after the active profile changes so no cached data of the old one is shown. */
export function resetClientState() {
	resetPending = true;
	refreshedSinceReset.clear();
}

// Implements the network-only-once-per-query rule described above.
const freshAfterResetExchange: Exchange =
	({ forward }) =>
	(operations) =>
		forward(
			pipe(
				operations,
				map((operation) => {
					if (!resetPending || operation.kind !== 'query') return operation;
					if (refreshedSinceReset.has(operation.key)) return operation;
					refreshedSinceReset.add(operation.key);
					return makeOperation(operation.kind, operation, {
						...operation.context,
						requestPolicy: 'network-only'
					});
				})
			)
		);

// Remote functions only make sense server side, the browser has no in-process endpoint.
const exchanges: Exchange[] = [];
if (!browser) exchanges.push(remoteFunctionsExchange);
exchanges.push(freshAfterResetExchange, cacheExchange, fetchExchange);

/** The one GraphQL client, shared by the generated rumble client and freshQuery so they share a cache. */
export const urqlClient = new Client({
	url: '/api/graphql',
	exchanges,
	fetchOptions: { credentials: 'include' },
	// graphql-yoga serves subscriptions over SSE on the same endpoint, and
	// fetchExchange only picks up "subscription" operations (as used by
	// liveQuery) when this is set, otherwise they're left unhandled.
	fetchSubscriptions: true,
	// Several pages poll a liveQuery on a timer for data rumble can't push, like
	// an app's dashboard. 'cache-first' would answer those from cache
	// forever, 'cache-and-network' keeps the fast cached answer but revalidates.
	requestPolicy: 'cache-and-network'
});
