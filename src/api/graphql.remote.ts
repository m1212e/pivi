import { execute } from 'graphql';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { GET } from '../routes/api/graphql/+server';

// Lets the urql client run GraphQL in process during SSR instead of making an
// HTTP call to our own endpoint (see lib/api/client.ts).
const graphqlRequestSchema = z.object({
	query: z.any(),
	variables: z.record(z.string(), z.any()).optional()
});

const performQuery = async (p: z.infer<typeof graphqlRequestSchema>) => {
	const requestEvent = await getRequestEvent();
	// Same yoga instance and context as the real endpoint, so resolvers behave
	// identically whichever way they are reached.
	const envelop = GET.getEnveloped(requestEvent);
	const contextValue = envelop.contextFactory ? await envelop.contextFactory() : undefined;

	return execute({
		schema: envelop.schema,
		document: p.query,
		variableValues: p.variables,
		contextValue
	});
};

/** Used by the urql client (lib/api/client.ts) for queries during SSR. */
export const graphqlQuery = query(graphqlRequestSchema, performQuery);
/** Same as graphqlQuery for mutations, a command since remote queries are meant for reads. */
export const graphqlMutation = command(graphqlRequestSchema, performQuery);
