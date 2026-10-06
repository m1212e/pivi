// Tier 2: an app describes a full custom screen as data instead of
// markup. The shell renders every node with its own components and owns
// focus/nav behavior, the same way it already does for Tier 1 cards — a
// app only ever supplies structure here, never a DOM or webview. This is
// the tier that covers things like a settings screen or a browse-with-
// filters UI that a fixed card schema can't express.
//
// This is the plugin's way into the shell's one component library
// (src/lib/components): every node kind is either layout or renders a real
// shell component (Button, MediaCard, ContentRow, HeroBanner, LoadingSpinner,
// ...), never a look-alike, so a plugin's screen can't drift from the host's
// own. Adding a new one touches five places, in order:
//   1. the `UiNode` union below (the real, hand-written type)
//   2. the matching branch in `uiNodeSchema` (the runtime/RPC-boundary check)
//   3. `UI_NODE_TYPES` (checked for completeness at compile time)
//   4. a render snippet + dispatch branch in UiNodeRenderer.svelte
//   5. its entry in docs/app-ui-components.md (a test fails without it)
// The JSON Schema published with each release is generated from `uiNodeSchema`,
// so steps 1-3 are also what app authors outside TypeScript get to see.
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
			// A heading shown above the container, a plain one. A horizontally
			// scrolling shelf with the shell's row styling and focus behavior is
			// its own node, `shelf`.
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
			// Fills the space left over in a row (and may shrink below its
			// content), so a fixed-width sidebar can sit beside a main area.
			grow?: boolean;
			// Pins a row's children to the top instead of centering them
			// vertically, needed when one side is much taller than the other.
			alignStart?: boolean;
			// Spreads a row's children over its width: `between` pushes them to
			// the edges, `around` leaves equal space around each.
			justify?: 'between' | 'around';
			// Centers children horizontally and the whole block in the space
			// it's given, for single-purpose screens like a sign-in code.
			center?: boolean;
			// Draws the container as a rounded, translucent card with padding.
			panel?: boolean;
			// Like `action`, but fires a UI event back to the app instead of
			// navigating, for a card that changes the screen itself (opening a
			// playlist, say).
			onSelect?: string;
			// Stays in view while the rest of the screen scrolls past it, for a
			// sidebar. Needs a row parent with `alignStart`.
			sticky?: boolean;
			// Event id fired when the first `skeleton` child scrolls into view,
			// so the app can append more items (infinite scroll). Send skeletons
			// only while more items exist. A skeleton that stays in view re-sends
			// it every 3 seconds, so a failed load is retried.
			onReachEnd?: string;
	  }
	| {
			type: 'text';
			value: string;
			variant?: 'title' | 'subtitle' | 'body' | 'headline' | 'display';
			// Clamps to this many lines (ellipsis beyond it) -- titles in a
			// card grid need to wrap without pushing neighboring cards around.
			lines?: number;
	  }
	// A glyph in a round badge. `path` is the `d` of a single 24x24 SVG path,
	// same as a nav button's `icon`, so apps need no image assets.
	| { type: 'icon'; path: string; size?: 'normal' | 'large' }
	// The shell's loading animation, for a screen or section with nothing to
	// show yet.
	| { type: 'spinner'; label?: string }
	// A pulsing placeholder shaped like a media card (thumbnail, title and
	// subtitle bars), not focusable. Marks where more items will appear, e.g.
	// below a grid that loads more as the user scrolls.
	| { type: 'skeleton'; shape?: 'video' | 'poster' | 'avatar' }
	// The shell's own media card, the same one the home dashboard uses, so an
	// app's videos look and size exactly like the rest of pivi. Selecting it
	// follows `action`, or fires `onSelect` back to the app.
	| {
			type: 'mediaCard';
			title: string;
			meta: string;
			image: string;
			// `avatar` is a round picture with centered text, for a channel or a
			// person.
			shape?: 'video' | 'poster' | 'avatar';
			// Draws the thumbnail as a pile of cards, the way a playlist differs
			// from a single video.
			stacked?: boolean;
			badge?: string;
			// 0..1, drawn as a watch-progress bar on the thumbnail.
			progress?: number;
			action?: AppAction;
			onSelect?: string;
	  }
	// The shell's own horizontally scrolling shelf (title, edge fade, snap
	// scrolling and remote focus behavior), the row every dashboard section is
	// built from. Children are usually `mediaCard`s.
	| { type: 'shelf'; title: string; children: UiNode[] }
	// The shell's full-width featured banner, as at the top of the home screen.
	// Needs `action` to give its Play button somewhere to go.
	| {
			type: 'hero';
			title: string;
			description: string;
			image?: string;
			badge?: string;
			// What contributed it, shown as a small pill.
			source?: string;
			action: AppAction;
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
	// `nav` renders a sidebar entry (full width, optional icon, highlighted
	// when `selected`) instead of the default pill. `icon` is the `d` of a
	// single 24x24 SVG path, so apps don't need to ship image assets.
	| {
			type: 'button';
			label: string;
			onSelect?: string;
			action?: AppAction;
			// `solid` is the primary action, `soft` the quiet default, `nav` a
			// full-width sidebar entry.
			variant?: 'solid' | 'soft' | 'nav';
			selected?: boolean;
			icon?: string;
			// `lg` is sized to be read and hit from across a room.
			size?: 'sm' | 'md' | 'lg';
	  }
	| { type: 'toggle'; label: string; value: boolean; onChange: string }
	| {
			type: 'textInput';
			label: string;
			placeholder?: string;
			secret?: boolean;
			// A full-width search field with a magnifier, sent on Enter.
			search?: boolean;
			// Sent with the current text as the user types, so the app can answer
			// with `suggestions`, which the on-screen keyboard offers as shortcuts.
			onInput?: string;
			suggestions?: string[];
			onSubmit: string;
	  }
	| { type: 'list'; items: UiNode[] };

const uiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
	z.discriminatedUnion('type', [
		z.object({
			type: z.literal('container'),
			direction: z.enum(['row', 'column']),
			children: z.array(uiNodeSchema),
			wrap: z.boolean().optional(),
			title: z.string().optional(),
			width: z.string().optional(),
			action: appActionSchema.optional(),
			grow: z.boolean().optional(),
			alignStart: z.boolean().optional(),
			justify: z.enum(['between', 'around']).optional(),
			center: z.boolean().optional(),
			panel: z.boolean().optional(),
			onSelect: z.string().optional(),
			sticky: z.boolean().optional(),
			onReachEnd: z.string().optional()
		}),
		z.object({
			type: z.literal('text'),
			value: z.string(),
			variant: z.enum(['title', 'subtitle', 'body', 'headline', 'display']).optional(),
			lines: z.number().optional()
		}),
		z.object({
			type: z.literal('icon'),
			path: z.string(),
			size: z.enum(['normal', 'large']).optional()
		}),
		z.object({ type: z.literal('spinner'), label: z.string().optional() }),
		z.object({
			type: z.literal('skeleton'),
			shape: z.enum(['video', 'poster', 'avatar']).optional()
		}),
		z.object({
			type: z.literal('mediaCard'),
			title: z.string(),
			meta: z.string(),
			image: z.string(),
			shape: z.enum(['video', 'poster', 'avatar']).optional(),
			stacked: z.boolean().optional(),
			badge: z.string().optional(),
			progress: z.number().optional(),
			action: appActionSchema.optional(),
			onSelect: z.string().optional()
		}),
		z.object({
			type: z.literal('shelf'),
			title: z.string(),
			children: z.array(uiNodeSchema)
		}),
		z.object({
			type: z.literal('hero'),
			title: z.string(),
			description: z.string(),
			image: z.string().optional(),
			badge: z.string().optional(),
			source: z.string().optional(),
			action: appActionSchema
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
			action: appActionSchema.optional(),
			variant: z.enum(['solid', 'soft', 'nav']).optional(),
			selected: z.boolean().optional(),
			icon: z.string().optional(),
			size: z.enum(['sm', 'md', 'lg']).optional()
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
			search: z.boolean().optional(),
			onInput: z.string().optional(),
			suggestions: z.array(z.string()).optional(),
			onSubmit: z.string()
		}),
		z.object({ type: z.literal('list'), items: z.array(uiNodeSchema) })
	])
);

// Every node kind, in the order docs/app-ui-components.md lists them. The
// type below fails to compile when a kind is added to `UiNode` but not here,
// and the doc's spec then fails until it is described there too.
export const UI_NODE_TYPES = [
	'container',
	'text',
	'icon',
	'spinner',
	'skeleton',
	'mediaCard',
	'shelf',
	'hero',
	'image',
	'button',
	'toggle',
	'textInput',
	'list'
] as const satisfies readonly UiNode['type'][];

type MissingNodeTypes = Exclude<UiNode['type'], (typeof UI_NODE_TYPES)[number]>;
// Fails to compile when a node type is missing from UI_NODE_TYPES.
// fallow-ignore-next-line unused-export
export const allNodeTypesListed: [MissingNodeTypes] extends [never] ? true : never = true;

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
