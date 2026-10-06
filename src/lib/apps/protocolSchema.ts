// The host<->app protocol (host.ts) as a plain JSON document: every method,
// who sends it, whether it expects a reply, which manifest feature gates it, and
// JSON Schema for its parameters and result. This is what an app author in a
// language other than TypeScript implements against; docs/app-protocol.schema.json
// is generated from it (scripts/generate-app-protocol.ts) and a test keeps
// the two from drifting apart.
import { z } from 'zod';
import { dashboardContributionSchema } from './dashboard';
import { appScreenSchema, uiEventSchema } from './ui';
import {
	activateNotification,
	activateParamsSchema,
	localeNotification,
	publishDashboardNotification,
	publishScreenNotification,
	PROTOCOL_VERSION,
	readyNotification,
	readyParamsSchema,
	resolvedStreamSchema,
	resolveNextParamsSchema,
	resolveNextRequest,
	resolveNextResultSchema,
	resolveSkipSegmentsParamsSchema,
	resolveSkipSegmentsRequest,
	resolveSkipSegmentsResultSchema,
	resolveStreamParamsSchema,
	resolveStreamRequest,
	shutdownNotification,
	uiEventNotification
} from './host';
import { featureSchema, type Feature } from './manifest';

type MethodSpec = {
	method: string;
	// Who sends it.
	from: 'app' | 'host';
	// A request gets a response; a notification doesn't.
	kind: 'request' | 'notification';
	// The manifest feature that has to be declared for the host to use it.
	feature?: Feature;
	description: string;
	params?: z.ZodType;
	result?: z.ZodType;
};

const METHODS: MethodSpec[] = [
	{
		method: readyNotification.method,
		from: 'app',
		kind: 'notification',
		description:
			'First message, sent once the app can receive requests. Nothing else is sent to it before.',
		params: readyParamsSchema
	},
	{
		method: activateNotification.method,
		from: 'host',
		kind: 'notification',
		description: 'Sent once after ready: the app may start publishing.',
		params: activateParamsSchema
	},
	{
		method: localeNotification.method,
		from: 'host',
		kind: 'notification',
		description: 'The host language changed since activate. Same params.',
		params: activateParamsSchema
	},
	{
		method: shutdownNotification.method,
		from: 'host',
		kind: 'notification',
		description: 'The app should exit. It is killed shortly after regardless.'
	},
	{
		method: publishDashboardNotification.method,
		from: 'app',
		kind: 'notification',
		feature: 'dashboard',
		description: 'The cards this app contributes to the home dashboard. Replaces the last set.',
		params: dashboardContributionSchema
	},
	{
		method: publishScreenNotification.method,
		from: 'app',
		kind: 'notification',
		feature: 'screen',
		description: 'A declarative screen. Replaces the last version of the screen with that id.',
		params: appScreenSchema
	},
	{
		method: uiEventNotification.method,
		from: 'host',
		kind: 'notification',
		feature: 'screen',
		description: 'The user interacted with a node of a published screen that carried an event id.',
		params: uiEventSchema
	},
	{
		method: resolveStreamRequest.method,
		from: 'host',
		kind: 'request',
		feature: 'playback',
		description:
			'Resolve a session id to a playable stream. URLs must be on a domain the manifest declares.',
		params: resolveStreamParamsSchema,
		result: resolvedStreamSchema
	},
	{
		method: resolveSkipSegmentsRequest.method,
		from: 'host',
		kind: 'request',
		feature: 'skipSegments',
		description: 'Skippable stretches of a session’s stream.',
		params: resolveSkipSegmentsParamsSchema,
		result: resolveSkipSegmentsResultSchema
	},
	{
		method: resolveNextRequest.method,
		from: 'host',
		kind: 'request',
		feature: 'playback',
		description:
			'The session to play after this one ended, from the context its action carried. Optional, answer with no sessionId when there is none.',
		params: resolveNextParamsSchema,
		result: resolveNextResultSchema
	}
];

const toSchema = (schema: z.ZodType | undefined) =>
	schema ? z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) : undefined;

export function buildProtocolDocument() {
	return {
		title: 'pivi app protocol',
		protocol: PROTOCOL_VERSION,
		transport:
			'JSON-RPC 2.0 over the container entrypoint’s stdin/stdout, one UTF-8 JSON message per line. stderr is the log stream; nothing else may be written to stdout.',
		features: featureSchema.options,
		methods: METHODS.map(({ params, result, ...method }) => ({
			...method,
			params: toSchema(params),
			result: toSchema(result)
		}))
	};
}
