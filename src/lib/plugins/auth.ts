// On-screen login almost never needs custom UI: render it with the same
// Tier 1 primitives (a code, a QR, a status line) instead of a per-plugin
// login screen. See SKETCH.md's "Login" decision.
import { z } from 'zod';

export const deviceCodeAuthSchema = z.object({
	pluginId: z.string(),
	verificationUrl: z.string(),
	// If the service supports it, encode this straight into the QR instead
	// of the plain verificationUrl, so scanning skips the code-entry step.
	verificationUrlComplete: z.string().optional(),
	userCode: z.string(),
	expiresInSeconds: z.number(),
	pollIntervalSeconds: z.number(),
	status: z.enum(['pending', 'complete', 'expired', 'error'])
});

export type DeviceCodeAuth = z.infer<typeof deviceCodeAuthSchema>;

// For services without a device-flow grant: hand the actual login webview
// to the paired phone (real keyboard, password manager, 2FA autofill)
// rather than rendering a form on the TV, reusing the same pairing
// mechanism as src/lib/pairing.
export const phoneAuthHandoffSchema = z.object({
	pluginId: z.string(),
	loginUrl: z.string(),
	redirectUrl: z.string()
});

export type PhoneAuthHandoff = z.infer<typeof phoneAuthHandoffSchema>;
