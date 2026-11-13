import { schemaBuilder, createYoga } from './rumble';
import { dev } from '$app/env';

// Root types start empty, handlers add their fields to them.
schemaBuilder.queryType({});
schemaBuilder.mutationType({});

import './handlers/register';

/** The GraphQL server, mounted by routes/api/graphql/+server.ts. */
export const yogaInstance = createYoga({
	graphqlEndpoint: '/api/graphql',
	// Real error messages only in dev, production hides internals from clients.
	maskedErrors: !dev,
	fetchAPI: { Response, ReadableStream }
});
