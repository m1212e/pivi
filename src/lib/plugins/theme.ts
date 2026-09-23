// Tier 1/2 rendering is always done by the shell's own components — a
// plugin never supplies markup or a stylesheet (see SKETCH.md's "Plugin
// theming" decision). This is the entire surface it gets for visual
// identity: a fixed token set applied as CSS custom properties inside that
// plugin's own Shadow DOM boundary, so nothing here can escape into the
// shell chrome or another plugin's subtree.
import { z } from 'zod';

export const pluginThemeSchema = z.object({
	accentColor: z.string().optional(), // any valid CSS color
	logoUrl: z.string().optional(),
	cornerRadius: z.enum(['none', 'sm', 'md', 'lg']).optional()
});
