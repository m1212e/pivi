import { describe, expect, it } from 'vitest';
import { chunkBytes, encodeMessage, LineSplitter } from './ndjson';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('encodeMessage', () => {
	it('is one JSON document per line', () => {
		const encoded = new TextDecoder().decode(encodeMessage({ a: 1, text: 'line\nbreak' }));
		expect(encoded.endsWith('\n')).toBe(true);
		expect(encoded.slice(0, -1)).not.toContain('\n');
		expect(JSON.parse(encoded)).toEqual({ a: 1, text: 'line\nbreak' });
	});
});

describe('LineSplitter', () => {
	it('splits complete lines and holds a partial one until its newline', () => {
		const splitter = new LineSplitter();
		expect(splitter.push(bytes('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
		expect(splitter.push(bytes(':2}\n'))).toEqual(['{"b":2}']);
	});

	it('handles several lines in one chunk, blank lines and CRLF', () => {
		const splitter = new LineSplitter();
		expect(splitter.push(bytes('one\r\n\ntwo\nthree'))).toEqual(['one', 'two']);
		expect(splitter.push(bytes('\n'))).toEqual(['three']);
	});

	it('decodes a multi-byte character split across chunks', () => {
		const splitter = new LineSplitter();
		const encoded = bytes('{"t":"€"}\n');
		const cut = encoded.indexOf(0xe2) + 1; // inside the euro sign's three bytes
		expect(splitter.push(encoded.slice(0, cut))).toEqual([]);
		expect(splitter.push(encoded.slice(cut))).toEqual(['{"t":"€"}']);
	});

	it('rejects a message that outgrows the limit without a newline', () => {
		const splitter = new LineSplitter(16);
		expect(() => splitter.push(bytes('x'.repeat(32)))).toThrow(/exceeds/);
	});
});

describe('chunkBytes', () => {
	it('splits without losing or reordering anything', () => {
		const data = bytes('abcdefghij');
		const chunks = [...chunkBytes(data, 4)];
		expect(chunks.map((c) => c.length)).toEqual([4, 4, 2]);
		expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe('abcdefghij');
	});

	it('yields nothing for empty input', () => {
		expect([...chunkBytes(new Uint8Array(0))]).toEqual([]);
	});
});
