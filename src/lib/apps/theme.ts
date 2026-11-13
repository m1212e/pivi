import { z } from 'zod';

/**
 * The only visual identity an app gets on its dashboard cards and screens,
 * since apps never send markup or CSS. Fixed tokens, applied inside the app's
 * own Shadow DOM, so a theme can't leak into the shell or another app.
 */
export const appThemeSchema = z.object({
	accentColor: z.string().optional(), // any valid CSS color
	logoUrl: z.string().optional(),
	cornerRadius: z.enum(['none', 'sm', 'md', 'lg']).optional()
});
