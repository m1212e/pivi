import type { Client } from '@urql/core';
import { makeQuery } from '@m1212e/rumble/client';
import { urqlClient } from './client';
import { schema } from './rumbleClient/schema';
import type { Query } from './rumbleClient/client';

// client.query.* resolves with the first result it sees, which under the shared
// client's 'cache-and-network' policy is whatever the cache holds, possibly
// minutes old. Polls that need to notice server side changes go through this
// view instead, it forces every query onto the network but still writes into
// the shared cache.
const networkOnlyClient = new Proxy(urqlClient, {
	get(target, prop, receiver) {
		if (prop === 'query') {
			return ((query, variables, context) =>
				target.query(query, variables, {
					...context,
					requestPolicy: 'network-only'
				})) satisfies Client['query'];
		}
		return Reflect.get(target, prop, receiver);
	}
});

/** Like client.query, but always a real round trip. */
export const freshQuery = makeQuery<Query>({ urqlClient: networkOnlyClient, schema });
