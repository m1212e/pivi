import type { CombinedError } from '@urql/core';

// `client.mutate.*`/`client.query.*` throw urql's CombinedError on a GraphQL
// error (see @m1212e/rumble/client) — this pulls out a message worth showing.
export function graphQLErrorMessage(err: unknown, fallback: string) {
	const combined = err as Partial<CombinedError> | undefined;
	return combined?.graphQLErrors?.[0]?.message || fallback;
}
