// The EurKEY layout (US QWERTY plus an AltGr layer for European letters), as
// shipped in xkeyboard-config's `eu` symbols file. One layout covers most
// Western European languages, which is why the on-screen keyboard has no
// per-language layouts.

export type DeadKind =
	'grave' | 'acute' | 'circumflex' | 'tilde' | 'macron' | 'ring' | 'caron' | 'diaeresis';

export type Cell = string | { dead: DeadKind };

// base, shift, AltGr, shift+AltGr
export type KeyLayers = [Cell, Cell, Cell, Cell];

const COMBINING: Record<DeadKind, string> = {
	grave: '̀',
	acute: '́',
	circumflex: '̂',
	tilde: '̃',
	macron: '̄',
	ring: '̊',
	caron: '̌',
	diaeresis: '̈'
};

// What a dead key prints on its own, when nothing composes with it.
export const DEAD_SPACING: Record<DeadKind, string> = {
	grave: '`',
	acute: '´',
	circumflex: '^',
	tilde: '~',
	macron: '¯',
	ring: '˚',
	caron: 'ˇ',
	diaeresis: '¨'
};

const d = (dead: DeadKind): Cell => ({ dead });

export const EURKEY_ROWS: KeyLayers[][] = [
	[
		['`', '~', d('grave'), d('tilde')],
		['1', '!', '¡', '¹'],
		['2', '@', 'ª', '²'],
		['3', '#', 'º', '³'],
		['4', '$', '£', '¥'],
		['5', '%', '€', '¢'],
		['6', '^', d('circumflex'), d('caron')],
		['7', '&', d('ring'), d('macron')],
		['8', '*', '„', '‚'],
		['9', '(', '“', '‘'],
		['0', ')', '”', '’'],
		['-', '_', '–', '—'],
		['=', '+', '×', '÷']
	],
	[
		['q', 'Q', 'æ', 'Æ'],
		['w', 'W', 'å', 'Å'],
		['e', 'E', 'ë', 'Ë'],
		['r', 'R', 'ý', 'Ý'],
		['t', 'T', 'þ', 'Þ'],
		['y', 'Y', 'ÿ', 'Ÿ'],
		['u', 'U', 'ü', 'Ü'],
		['i', 'I', 'ï', 'Ï'],
		['o', 'O', 'ö', 'Ö'],
		['p', 'P', 'œ', 'Œ'],
		['[', '{', '«', '‹'],
		[']', '}', '»', '›'],
		['\\', '|', '¬', '¦']
	],
	[
		['a', 'A', 'ä', 'Ä'],
		['s', 'S', 'ß', '§'],
		['d', 'D', 'ð', 'Ð'],
		['f', 'F', 'è', 'È'],
		['g', 'G', 'é', 'É'],
		['h', 'H', 'ù', 'Ù'],
		['j', 'J', 'ú', 'Ú'],
		['k', 'K', 'ĳ', 'Ĳ'],
		['l', 'L', 'ø', 'Ø'],
		[';', ':', '°', '·'],
		["'", '"', d('acute'), d('diaeresis')]
	],
	[
		['z', 'Z', 'à', 'À'],
		['x', 'X', 'á', 'Á'],
		['c', 'C', 'ç', 'Ç'],
		['v', 'V', 'ì', 'Ì'],
		['b', 'B', 'í', 'Í'],
		['n', 'N', 'ñ', 'Ñ'],
		['m', 'M', 'µ', 'µ'],
		[',', '<', 'ò', 'Ò'],
		['.', '>', 'ó', 'Ó'],
		['/', '?', '¿', '…']
	]
];

export function layerIndex(shift: boolean, altGr: boolean): 0 | 1 | 2 | 3 {
	return ((altGr ? 2 : 0) + (shift ? 1 : 0)) as 0 | 1 | 2 | 3;
}

/**
 * What a dead key followed by `next` types. A letter that has a precomposed
 * form with the accent comes out as that one character, anything else
 * (including space) prints the bare accent first, like a real dead key.
 */
export function composeDead(dead: DeadKind, next: string): string {
	if (next === ' ') return DEAD_SPACING[dead];
	const composed = (next + COMBINING[dead]).normalize('NFC');
	return composed.length === 1 ? composed : DEAD_SPACING[dead] + next;
}
