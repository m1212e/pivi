// Thin layer over vscode-jsonrpc's MessageConnection: the library owns
// framing, request/response correlation, and transport (stdio, a Node IPC
// channel, a WebSocket, or the push-based pairing transport in
// pairing/rpcTransport.ts), which is exactly what any of pivi's process/
// device boundaries need and is deliberately not reinvented per boundary.
// It doesn't validate payloads on its own, though, so every send/handle
// still goes through the matching zod schema — that's the actual runtime
// enforcement point for both the plugin RPC contracts (plugins/*.ts) and
// the phone-remote command protocol (pairing/remoteProtocol.ts).
import type {
	Disposable,
	MessageConnection,
	NotificationType,
	RequestHandler,
	RequestParam,
	RequestType
} from 'vscode-jsonrpc';
import type { z } from 'zod';

export function sendNotification<P>(
	connection: MessageConnection,
	type: NotificationType<P>,
	schema: z.ZodType<P>,
	params: P
): Promise<void> {
	// The cast is needed because `RequestParam<P>` is a conditional type
	// vscode-jsonrpc can't resolve against an unresolved generic `P` here —
	// it collapses to plain `P` for every concrete P these contracts use.
	return connection.sendNotification(type, schema.parse(params) as RequestParam<P>);
}

export function onNotification<P>(
	connection: MessageConnection,
	type: NotificationType<P>,
	schema: z.ZodType<P>,
	handler: (params: P) => void
): Disposable {
	return connection.onNotification(type, (raw) => handler(schema.parse(raw)));
}

export async function sendRequest<P, R>(
	connection: MessageConnection,
	type: RequestType<P, R, void>,
	paramsSchema: z.ZodType<P>,
	resultSchema: z.ZodType<R>,
	params: P
): Promise<R> {
	const result = await connection.sendRequest(type, paramsSchema.parse(params) as RequestParam<P>);
	return resultSchema.parse(result);
}

export function onRequest<P, R>(
	connection: MessageConnection,
	type: RequestType<P, R, void>,
	paramsSchema: z.ZodType<P>,
	resultSchema: z.ZodType<R>,
	handler: (params: P) => R | Promise<R>
): Disposable {
	// Same unresolved-generic issue as the RequestParam casts above, this
	// time on the handler's call signature rather than a params value.
	const wrapped = async (raw: P): Promise<R> =>
		resultSchema.parse(await handler(paramsSchema.parse(raw)));
	return connection.onRequest(type, wrapped as RequestHandler<P, R, void>);
}
