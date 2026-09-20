import { schemaBuilder, createYoga } from './rumble';
import { dev } from '$app/environment';

schemaBuilder.queryType({});
schemaBuilder.mutationType({});

// registers every handler module's queries/mutations against the schema builder above
import './handlers/register';

export const yogaInstance = createYoga({
	graphqlEndpoint: '/api/graphql',
	maskedErrors: !dev,
	// SvelteKit checks the route handler's return value with `instanceof Response`;
	// without this, yoga's bundled Response comes from a different realm and fails that check.
	fetchAPI: { Response }
});
