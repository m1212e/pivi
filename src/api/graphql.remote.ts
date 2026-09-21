import { execute } from 'graphql';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { GET } from '../routes/api/graphql/+server';

const graphqlRequestSchema = z.object({
	query: z.any(),
	variables: z.record(z.string(), z.any()).optional()
});

const performQuery = async (p: z.infer<typeof graphqlRequestSchema>) => {
	const requestEvent = await getRequestEvent();
	const envelop = GET.getEnveloped(requestEvent);
	const contextValue = envelop.contextFactory ? await envelop.contextFactory() : undefined;

	return execute({
		schema: envelop.schema,
		document: p.query,
		variableValues: p.variables,
		contextValue
	});
};

export const graphqlQuery = query(graphqlRequestSchema, performQuery);
export const graphqlMutation = command(graphqlRequestSchema, performQuery);
