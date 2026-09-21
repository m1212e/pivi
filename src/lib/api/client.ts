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
	fetchOptions: { credentials: 'include' }
});
