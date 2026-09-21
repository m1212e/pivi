import { z } from 'zod';

export const usernameSchema = z
	.string()
	.trim()
	.min(2, 'Username is too short')
	.max(20, 'Username is too long')
	.regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, - and _ are allowed');

export const pinSchema = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

export const credentialsSchema = z.object({ username: usernameSchema, pin: pinSchema });
