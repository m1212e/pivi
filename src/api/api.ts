import { schemaBuilder, createYoga } from './rumble';
import { dev } from '$app/env';

schemaBuilder.queryType({});
schemaBuilder.mutationType({});

import './handlers/register';

export const yogaInstance = createYoga({
	graphqlEndpoint: '/api/graphql',
	maskedErrors: !dev,
	fetchAPI: { Response }
});
