import { z } from 'zod';
import { usernameIssue } from '#lib/usernameRules';

// Input rules shared by register and login, so bad input is rejected before it
// reaches the database or the lockout counter.
const USERNAME_MESSAGES = {
	too_short: 'Username is too short',
	too_long: 'Username is too long',
	invalid_chars: 'Only letters, numbers, - and _ are allowed'
} as const;

const usernameSchema = z
	.string()
	.trim()
	.superRefine((value, ctx) => {
		const issue = usernameIssue(value);
		if (issue) ctx.addIssue({ code: 'custom', message: USERNAME_MESSAGES[issue] });
	});

const pinSchema = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

/** Used by the register and login mutations. The first issue's message is safe to show. */
export const credentialsSchema = z.object({ username: usernameSchema, pin: pinSchema });
