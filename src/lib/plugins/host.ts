// The plugin<->host RPC boundary (see SKETCH.md's "Plugin sandboxing"
// decision): one child process per plugin, everything it can do or be told
// crosses this channel as a JSON-RPC 2.0 call over vscode-jsonrpc — the
// same library (and the same request/notification split) the Language
// Server Protocol uses for its editor<->language-server child process, which
// is the model this is copying. Using it instead of a hand-rolled message
// envelope also means request/response correlation (matching a response
// back to its request) is handled by the library instead of by us — no more
// manually-paired httpRequest/httpResponse messages with a requestId to
// track by hand.
import { NotificationType, NotificationType0, RequestType } from 'vscode-jsonrpc';
import { z } from 'zod';
import { pluginManifestSchema } from './manifest';
import { dashboardContributionSchema } from './dashboard';
import { pluginScreenSchema, uiEventSchema } from './ui';
import { sessionRequestSchema, sessionEndedSchema } from './session';
import { deviceCodeAuthSchema, phoneAuthHandoffSchema } from './auth';

// Plugin -> host

export const readyNotification = new NotificationType<z.infer<typeof pluginManifestSchema>>(
	'plugin/ready'
);

export const publishDashboardNotification = new NotificationType<
	z.infer<typeof dashboardContributionSchema>
>('plugin/publishDashboard');

export const publishScreenNotification = new NotificationType<z.infer<typeof pluginScreenSchema>>(
	'plugin/publishScreen'
);

export const requestSessionResultSchema = z.object({ granted: z.boolean() });
export type RequestSessionResult = z.infer<typeof requestSessionResultSchema>;

export const requestSessionRequest = new RequestType<
	z.infer<typeof sessionRequestSchema>,
	RequestSessionResult,
	void
>('plugin/requestSession');

export const pluginAuthSchema = z.union([deviceCodeAuthSchema, phoneAuthHandoffSchema]);

export const publishAuthNotification = new NotificationType<z.infer<typeof pluginAuthSchema>>(
	'plugin/publishAuth'
);

// A plain, JSON-serializable subset of fetch's RequestInit — everything
// crossing this boundary goes over JSON, so no AbortSignal/streaming body.
export const httpRequestParamsSchema = z.object({
	url: z.string(),
	method: z.string().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	body: z.string().optional()
});
export type HttpRequestParams = z.infer<typeof httpRequestParamsSchema>;

export const httpResponseResultSchema = z.object({
	status: z.number(),
	headers: z.record(z.string(), z.string()),
	body: z.string()
});
export type HttpResponseResult = z.infer<typeof httpResponseResultSchema>;

// The plugin process has no direct network access beyond what its manifest
// declares — outbound requests are proxied through the host, which enforces
// the declared domain allowlist per call.
export const httpRequestRequest = new RequestType<HttpRequestParams, HttpResponseResult, void>(
	'plugin/httpRequest'
);

export const logParamsSchema = z.object({
	level: z.enum(['info', 'warn', 'error']),
	message: z.string()
});

export const logNotification = new NotificationType<z.infer<typeof logParamsSchema>>('plugin/log');

// Host -> plugin

export const activateNotification = new NotificationType0('host/activate');

export const uiEventNotification = new NotificationType<z.infer<typeof uiEventSchema>>(
	'host/uiEvent'
);

export const sessionEndedNotification = new NotificationType<z.infer<typeof sessionEndedSchema>>(
	'host/sessionEnded'
);

export const shutdownNotification = new NotificationType0('host/shutdown');
