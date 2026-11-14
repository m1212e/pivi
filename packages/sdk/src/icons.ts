// Icons an app can name instead of drawing its own: the host draws them from
// its own icon library (Lucide), in the same style as the shell's chrome.
// A fixed list rather than any Lucide name, so the host only bundles these
// and an app's icon names are checked at compile time. Adding one means
// adding it to the host's map as well (src/lib/apps/hostIcons.ts), which the
// type checker enforces.
import { z } from 'zod';
import { textSchema } from './limits';

const HOST_ICONS = [
	// Navigation
	'arrow-left',
	'arrow-right',
	'chevron-left',
	'chevron-right',
	'home',
	'search',
	'compass',
	'grid',
	'list',
	'folder',
	// Library and personal
	'library',
	'history',
	'clock',
	'bookmark',
	'heart',
	'star',
	'thumbs-up',
	'user',
	'users',
	'user-plus',
	'log-in',
	'log-out',
	'settings',
	'bell',
	'calendar',
	// Media
	'play',
	'pause',
	'radio',
	'tv',
	'film',
	'video',
	'playlist',
	'music',
	'gamepad',
	'trophy',
	'flame',
	'trending-up',
	'sparkles',
	'tag',
	'scissors',
	'message-square',
	// Actions and status
	'refresh',
	'plus',
	'check',
	'x',
	'download',
	'share',
	'eye',
	'globe',
	'smartphone',
	'info',
	'alert'
] as const;

export type HostIcon = (typeof HOST_ICONS)[number];

export function isHostIcon(value: string): value is HostIcon {
	return (HOST_ICONS as readonly string[]).includes(value);
}

/**
 * An icon: a name from HOST_ICONS, drawn by the host, or the `d` of a single
 * 24x24 SVG path the app draws itself, for anything the list doesn't have.
 * A path never looks like one of the names, so both fit one field.
 */
export type IconRef = HostIcon | (string & {});

// Any text at runtime: a string that isn't a known name is drawn as a path,
// and a bad path just draws nothing.
export const iconRefSchema: z.ZodType<IconRef> = textSchema;
