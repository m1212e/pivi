// vscode-jsonrpc carries the app host RPC (api/apps/runtime.ts) and the phone
// remote protocol (RemoteBridge, remoteController) but never validates
// payloads. These wrappers are where the zod contracts (apps/*.ts,
// pairing/remoteProtocol.ts) actually get enforced at runtime.
import type { Disposable, MessageConnection, NotificationType, RequestParam } from 'vscode-jsonrpc';
import type { z } from 'zod';

/** Validates before sending, so a bad payload fails at the sender where the bug is. */
export function sendNotification<P>(
	connection: MessageConnection,
	type: NotificationType<P>,
	schema: z.ZodType<P>,
	params: P
): Promise<void> {
	// The cast is needed because `RequestParam<P>` is a conditional type
	// vscode-jsonrpc can't resolve against an unresolved generic `P` here.
	// It collapses to plain `P` for every concrete P these contracts use.
	return connection.sendNotification(type, schema.parse(params) as RequestParam<P>);
}

/** Rejects malformed input from the other side before it reaches the handler. */
export function onNotification<P>(
	connection: MessageConnection,
	type: NotificationType<P>,
	schema: z.ZodType<P>,
	handler: (params: P) => void
): Disposable {
	return connection.onNotification(type, (raw) => handler(schema.parse(raw)));
}
