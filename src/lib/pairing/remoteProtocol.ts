import { NotificationType, NotificationType0 } from 'vscode-jsonrpc';
import { z } from 'zod';

// Phone -> TV

export const moveParamsSchema = z.object({ dx: z.number(), dy: z.number() });
export const moveNotification = new NotificationType<z.infer<typeof moveParamsSchema>>(
	'remote/move'
);

export const selectNotification = new NotificationType0('remote/select');
export const backNotification = new NotificationType0('remote/back');
// Distinct from `back` (browser history back, only shown when there's
// somewhere to go back to) — this always jumps straight to /home regardless
// of navigation depth, so it's shown unconditionally on the phone.
export const goHomeNotification = new NotificationType0('remote/goHome');

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
	canGoBack: z.boolean(),
	// Whether the "Home" button on the phone is worth showing -- true only
	// while the TV is actually inside an app or the player, i.e. somewhere
	// "Home" would take it somewhere new. Not shown on the home screen
	// itself (nothing to go home to) or on the pre-login profile picker.
	canGoHome: z.boolean()
});
export const stateNotification = new NotificationType<z.infer<typeof stateParamsSchema>>(
	'remote/state'
);

export const remoteConnectedNotification = new NotificationType0('remote/remoteConnected');
export const remoteDisconnectedNotification = new NotificationType0('remote/remoteDisconnected');

// Host -> phone, sent directly (not via the TV's own connection — see
// relay.ts's sendToPhones) whenever a plugin publishes a PhoneAuthHandoff
// (src/lib/plugins/auth.ts). Generic on purpose: any plugin that needs the
// phone to complete a login (or, someday, anything else that needs a real
// browser tab) gets this for free rather than building its own version.
export const openUrlParamsSchema = z.object({ url: z.string() });
export const openUrlNotification = new NotificationType<z.infer<typeof openUrlParamsSchema>>(
	'remote/openUrl'
);
