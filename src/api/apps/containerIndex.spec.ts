import { describe, expect, it } from 'vitest';
import { buildSegmentBaseIndex } from './containerIndex';

const fetcherFor = (bytes: number[]) => () => Promise.resolve(new Response(new Uint8Array(bytes)));

describe('buildSegmentBaseIndex on malformed webm', () => {
	it('rejects a truncated EBML header instead of looping forever', async () => {
		// EBML ID, then a size byte that has no marker bit left in range.
		await expect(
			buildSegmentBaseIndex(fetcherFor([0x1a, 0x45, 0xdf, 0xa3, 0x00]), 'webm')
		).rejects.toBeDefined();
	});

	it('rejects a buffer that ends inside the size field', async () => {
		await expect(
			buildSegmentBaseIndex(fetcherFor([0x1a, 0x45, 0xdf, 0xa3]), 'webm')
		).rejects.toBeDefined();
	});
});
