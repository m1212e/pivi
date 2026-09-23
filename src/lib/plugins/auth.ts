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

// The default login mechanism: a normal OAuth redirect flow, completed on
// the paired phone (real keyboard, password manager, 2FA autofill) rather
// than a per-plugin login screen on the TV. `state` is the plugin's own
// CSRF nonce (round-tripped through the redirect so it can verify the
// callback matches the flow it started); the host also uses it to route
// the resulting code back to the right plugin (see
// src/api/plugins/pendingAuth.ts) so it's namespaced with the plugin id.
export const phoneAuthHandoffSchema = z.object({
	pluginId: z.string(),
	loginUrl: z.string(),
	redirectUrl: z.string(),
	state: z.string(),
	status: z.enum(['pending', 'complete', 'error'])
});
