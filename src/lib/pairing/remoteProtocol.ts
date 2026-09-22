import { NotificationType, NotificationType0 } from 'vscode-jsonrpc';
import { z } from 'zod';

// Phone -> TV

export const moveParamsSchema = z.object({ dx: z.number(), dy: z.number() });
export const moveNotification = new NotificationType<z.infer<typeof moveParamsSchema>>(
	'remote/move'
);

export const selectNotification = new NotificationType0('remote/select');
export const backNotification = new NotificationType0('remote/back');

export const keyParamsSchema = z.object({ value: z.string() });
export const keyNotification = new NotificationType<z.infer<typeof keyParamsSchema>>('remote/key');

export const textParamsSchema = z.object({ value: z.string() });
export const textNotification = new NotificationType<z.infer<typeof textParamsSchema>>(
	'remote/text'
);

export const enterNotification = new NotificationType0('remote/enter');
export const requestStateNotification = new NotificationType0('remote/requestState');

// TV -> phone

export const stateParamsSchema = z.object({
	hasPinPad: z.boolean(),
	hasTextInput: z.boolean(),
	canGoBack: z.boolean()
});
export const stateNotification = new NotificationType<z.infer<typeof stateParamsSchema>>(
	'remote/state'
);

export const remoteConnectedNotification = new NotificationType0('remote/remoteConnected');
export const remoteDisconnectedNotification = new NotificationType0('remote/remoteDisconnected');
