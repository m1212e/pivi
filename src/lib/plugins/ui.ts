// Tier 2: a plugin describes a full custom screen as data instead of
// markup. The shell renders every node with its own components and owns
// focus/nav behavior, the same way it already does for Tier 1 cards — a
// plugin only ever supplies structure here, never a DOM or webview. This is
// the tier that covers things like a settings screen or a browse-with-
// filters UI that a fixed card schema can't express.
import { z } from 'zod';
import { pluginThemeSchema } from './theme';

// The type has to be declared by hand alongside the schema — zod can't
// infer a recursive type from a lazily-defined schema on its own, since the
// schema references itself before it exists.
export type UiNode =
	| { type: 'container'; direction: 'row' | 'column'; children: UiNode[] }
	| { type: 'text'; value: string; variant?: 'title' | 'subtitle' | 'body' }
	| { type: 'image'; src: string; aspect?: 'video' | 'poster' | 'square' }
	// `onSelect`/`onChange`/`onSubmit` are event ids, not callbacks — the
	// plugin process has no direct handle on the shell's DOM, so the event
	// crosses back over the RPC channel as a UiEvent instead.
	| { type: 'button'; label: string; onSelect: string }
	| { type: 'toggle'; label: string; value: boolean; onChange: string }
	| { type: 'textInput'; label: string; placeholder?: string; secret?: boolean; onSubmit: string }
	| { type: 'list'; items: UiNode[] };

export const uiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
	z.discriminatedUnion('type', [
		z.object({
			type: z.literal('container'),
			direction: z.enum(['row', 'column']),
			children: z.array(uiNodeSchema)
		}),
		z.object({
			type: z.literal('text'),
			value: z.string(),
			variant: z.enum(['title', 'subtitle', 'body']).optional()
		}),
		z.object({
			type: z.literal('image'),
			src: z.string(),
			aspect: z.enum(['video', 'poster', 'square']).optional()
		}),
		z.object({ type: z.literal('button'), label: z.string(), onSelect: z.string() }),
		z.object({
			type: z.literal('toggle'),
			label: z.string(),
			value: z.boolean(),
			onChange: z.string()
		}),
		z.object({
			type: z.literal('textInput'),
			label: z.string(),
			placeholder: z.string().optional(),
			secret: z.boolean().optional(),
			onSubmit: z.string()
		}),
		z.object({ type: z.literal('list'), items: z.array(uiNodeSchema) })
	])
);

export const pluginScreenSchema = z.object({
	pluginId: z.string(),
	screenId: z.string(),
	theme: pluginThemeSchema.optional(),
	root: uiNodeSchema
});

export type PluginScreen = z.infer<typeof pluginScreenSchema>;

// Fired by the shell back to the plugin process when the user interacts
// with a node carrying an event id.
export const uiEventSchema = z.object({
	screenId: z.string(),
	eventId: z.string(),
	value: z.union([z.string(), z.boolean()]).optional()
});

export type UiEvent = z.infer<typeof uiEventSchema>;
