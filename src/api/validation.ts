import { z } from 'zod';
import { usernameIssue } from '#lib/usernameRules';

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

export const credentialsSchema = z.object({ username: usernameSchema, pin: pinSchema });
