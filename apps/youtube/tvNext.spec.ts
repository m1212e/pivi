import { describe, expect, it } from 'vitest';
import { nextInPanel } from './tvNext';

const panel = (entries: [string, boolean?][]) => ({
	contents: {
		playlist: {
			playlist: {
				contents: entries.map(([videoId, selected]) => ({
					playlistPanelVideoRenderer: { videoId, selected }
				}))
			}
		}
	}
});

describe('nextInPanel', () => {
	it('returns the entry after the selected one', () => {
		expect(nextInPanel(panel([['a'], ['b', true], ['c']]), 'b')).toBe('c');
	});

	it('falls back to the current id when nothing is marked', () => {
		expect(nextInPanel(panel([['a'], ['b'], ['c']]), 'a')).toBe('b');
	});

	it('returns nothing at the end of the list', () => {
		expect(nextInPanel(panel([['a'], ['b', true]]), 'b')).toBeUndefined();
		expect(nextInPanel({}, 'b')).toBeUndefined();
	});
});
