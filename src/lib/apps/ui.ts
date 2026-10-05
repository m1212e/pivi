// Tier 2: an app describes a full custom screen as data instead of
// markup. The shell renders every node with its own components and owns
// focus/nav behavior, the same way it already does for Tier 1 cards — a
// app only ever supplies structure here, never a DOM or webview. This is
// the tier that covers things like a settings screen or a browse-with-
// filters UI that a fixed card schema can't express.
//
// Every node kind here is meant to eventually cover whatever the shell's own
// dashboard (src/lib/components) can already do -- a card grid, a horizontal
// shelf, an image badge -- so an app is never stuck re-inventing a cruder
// version of a look the host already has. Adding a new one touches four
// places, in order:
//   1. the `UiNode` union below (the real, hand-written type)
//   2. the matching branch in `uiNodeSchema` (the runtime/RPC-boundary check)
//   3. a render snippet + dispatch branch in UiNodeRenderer.svelte
//   4. `bun run apps:protocol`, to regenerate docs/app-protocol.schema.json
// Step 4 isn't optional busywork: protocolSchema.spec.ts fails the build if
// that file ever drifts from what `uiNodeSchema` actually accepts, so an app
// author reading the committed doc can trust it's exactly what the host
// will take -- never a kind added here and forgotten there, or vice versa.
import { z } from 'zod';
import { appThemeSchema } from './theme';
import { appActionSchema, type AppAction } from './dashboard';

// The type has to be declared by hand alongside the schema — zod can't
// infer a recursive type from a lazily-defined schema on its own, since the
// schema references itself before it exists.
export type UiNode =
	| {
			type: 'container';
			direction: 'row' | 'column';
			children: UiNode[];
			// Lets a row wrap onto multiple lines instead of overflowing --
			// paired with a fixed `width` on each child, this is how a screen
			// expresses a card grid (e.g. YouTube's browse feed) without the
			// schema needing its own dedicated grid node.
			wrap?: boolean;
			// The opposite of `wrap`: a non-wrapping row that scrolls
			// horizontally instead of overflowing -- the same shelf the host's
			// own dashboard (ContentRow) builds its continue-watching/apps
			// rows out of, including its edge-fade and hidden scrollbar.
			scroll?: boolean;
			// A heading shown above the container, styled (and wired into
			// RemoteBridge's spatial nav) exactly like ContentRow's own row
			// title -- most useful paired with `scroll`, to label a shelf.
			title?: string;
			// A CSS length (e.g. '16rem'). Without it a container sizes to its
			// content, which is fine for a plain row/column of controls but
			// breaks down for a card: an unconstrained column stretches to fit
			// its widest *unwrapped* line of text, instead of wrapping within
			// the thumbnail's own width above it.
			width?: string;
			// Same idea as a button's `action` (see below) -- makes the whole
			// container (e.g. a video card: thumbnail + title + channel) a
			// single navigable target instead of needing a separate, visually
			// redundant "Play" button inside it.
			action?: AppAction;
	  }
	| {
			type: 'text';
			value: string;
			variant?: 'title' | 'subtitle' | 'body';
			// Clamps to this many lines (ellipsis beyond it) -- titles in a
			// card grid need to wrap without pushing neighboring cards around.
			lines?: number;
	  }
	| {
			type: 'image';
			src: string;
			aspect?: 'video' | 'poster' | 'square';
			width?: string;
			// A short label pinned to the image's bottom-right corner (a video's
			// duration, say) -- the one thing a bare `img` can't do on its own.
			badge?: string;
	  }
	// `onSelect` is an event id, not a callback — the app process has no
	// direct handle on the shell's DOM, so the event crosses back over the
	// RPC channel as a UiEvent instead. `action`, when present, takes over
	// instead: the button becomes a real navigable link (via the same
	// appActionHref every dashboard card already resolves through) rather
	// than firing a UI event — this is how a screen's own "Play" button
	// reaches the shared player route without a bespoke navigation path.
	| { type: 'button'; label: string; onSelect?: string; action?: AppAction }
	| { type: 'toggle'; label: string; value: boolean; onChange: string }
	| { type: 'textInput'; label: string; placeholder?: string; secret?: boolean; onSubmit: string }
	| { type: 'list'; items: UiNode[] };

const uiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
	z.discriminatedUnion('type', [
		z.object({
			type: z.literal('container'),
			direction: z.enum(['row', 'column']),
			children: z.array(uiNodeSchema),
			wrap: z.boolean().optional(),
			scroll: z.boolean().optional(),
			title: z.string().optional(),
			width: z.string().optional(),
			action: appActionSchema.optional()
		}),
		z.object({
			type: z.literal('text'),
			value: z.string(),
			variant: z.enum(['title', 'subtitle', 'body']).optional(),
			lines: z.number().optional()
		}),
		z.object({
			type: z.literal('image'),
			src: z.string(),
			aspect: z.enum(['video', 'poster', 'square']).optional(),
			width: z.string().optional(),
			badge: z.string().optional()
		}),
		z.object({
			type: z.literal('button'),
			label: z.string(),
			onSelect: z.string().optional(),
			action: appActionSchema.optional()
		}),
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

// No app id: the host knows which app it's talking to, and an app
// naming one itself would only be a way to claim to be another.
export const appScreenSchema = z.object({
	screenId: z.string(),
	theme: appThemeSchema.optional(),
	root: uiNodeSchema
});

export type AppScreen = z.infer<typeof appScreenSchema>;

// Fired by the shell back to the app process when the user interacts
// with a node carrying an event id.
export const uiEventSchema = z.object({
	screenId: z.string(),
	eventId: z.string(),
	value: z.union([z.string(), z.boolean()]).optional()
});

export type UiEvent = z.infer<typeof uiEventSchema>;
