// The host/app protocol (protocol.ts) as a JSON document, so app authors outside
// TypeScript have something to implement against. scripts/apps.ts publishes it
// as app-protocol.schema.json with each release.
import { z } from 'zod';
import { dashboardContributionSchema } from './dashboard';
import { appScreenSchema, uiEventSchema } from './ui';
import {
	activateNotification,
	activateParamsSchema,
	localeNotification,
	openOnPhoneNotification,
	openOnPhoneParamsSchema,
	publishDashboardNotification,
	pingRequest,
	publishScreenNotification,
	PROTOCOL_VERSION,
	readyNotification,
	readyParamsSchema,
	refreshDashboardNotification,
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
} from './protocol';
import { featureSchema, type Feature } from './manifest';

// One row per protocol method, so the published document can't drift from protocol.ts.
type MethodSpec = {
	method: string;
	// Who sends it.
	from: 'app' | 'host';
	kind: 'request' | 'notification';
	// The manifest feature that has to be declared for the host to use it.
	feature?: Feature;
	description: string;
	params?: z.ZodType;
	result?: z.ZodType;
};

// Descriptions are written for third party app authors, not for this codebase.
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
		method: refreshDashboardNotification.method,
		from: 'host',
		kind: 'notification',
		feature: 'dashboard',
		description:
			'The home screen was opened. Publish the dashboard again with fresh content if it can go stale.'
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
		method: openOnPhoneNotification.method,
		from: 'app',
		kind: 'notification',
		feature: 'screen',
		description:
			'Ask the paired phone to open an https link, e.g. a sign-in page. The phone asks the user first. Ignored without a connected phone, and when sent more than once every few seconds.',
		params: openOnPhoneParamsSchema
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
		method: pingRequest.method,
		from: 'host',
		kind: 'request',
		description:
			'Sent after another request timed out. Answer right away, any response will do. An app that does not answer is stopped.'
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

// Input side of each schema, since that is what the sender has to produce.
// Unrepresentable zod types become `any` instead of failing the release build.
const toSchema = (schema: z.ZodType | undefined) =>
	schema ? z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) : undefined;

/** Called by scripts/apps.ts at release time to write the published protocol schema. */
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
