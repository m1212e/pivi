// The host<->plugin protocol (host.ts) as a plain JSON document: every method,
// who sends it, whether it expects a reply, which manifest feature gates it, and
// JSON Schema for its parameters and result. This is what a plugin author in a
// language other than TypeScript implements against; docs/plugin-protocol.schema.json
// is generated from it (scripts/generate-plugin-protocol.ts) and a test keeps
// the two from drifting apart.
import { z } from 'zod';
import { dashboardContributionSchema } from './dashboard';
import { pluginScreenSchema, uiEventSchema } from './ui';
import {
	getPublicOriginRequest,
	oauthCodeParamsSchema,
	oauthCodeNotification,
	activateNotification,
	pluginAuthSchema,
	publicOriginResultSchema,
	publishAuthNotification,
	publishDashboardNotification,
	publishScreenNotification,
	PROTOCOL_VERSION,
	readyNotification,
	readyParamsSchema,
	resolvedStreamSchema,
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
	from: 'plugin' | 'host';
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
		from: 'plugin',
		kind: 'notification',
		description:
			'First message, sent once the plugin can receive requests. Nothing else is sent to it before.',
		params: readyParamsSchema
	},
	{
		method: activateNotification.method,
		from: 'host',
		kind: 'notification',
		description: 'Sent once after ready: the plugin may start publishing.'
	},
	{
		method: shutdownNotification.method,
		from: 'host',
		kind: 'notification',
		description: 'The plugin should exit. It is killed shortly after regardless.'
	},
	{
		method: publishDashboardNotification.method,
		from: 'plugin',
		kind: 'notification',
		feature: 'dashboard',
		description: 'The cards this plugin contributes to the home dashboard. Replaces the last set.',
		params: dashboardContributionSchema
	},
	{
		method: publishScreenNotification.method,
		from: 'plugin',
		kind: 'notification',
		feature: 'screen',
		description: 'A declarative screen. Replaces the last version of the screen with that id.',
		params: pluginScreenSchema
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
		method: publishAuthNotification.method,
		from: 'plugin',
		kind: 'notification',
		feature: 'auth',
		description:
			'A sign-in for the user to complete on another device (a device code, or a login URL for the phone).',
		params: pluginAuthSchema
	},
	{
		method: oauthCodeNotification.method,
		from: 'host',
		kind: 'notification',
		feature: 'auth',
		description:
			'The phone finished a login URL handoff and the provider redirected back; `state` is the plugin’s own.',
		params: oauthCodeParamsSchema
	},
	{
		method: getPublicOriginRequest.method,
		from: 'plugin',
		kind: 'request',
		feature: 'auth',
		description: 'A base URL the phone can reach this device on, for building a redirect URI.',
		result: publicOriginResultSchema
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
	}
];

const toSchema = (schema: z.ZodType | undefined) =>
	schema ? z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) : undefined;

export function buildProtocolDocument() {
	return {
		title: 'pivi plugin protocol',
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
