// A minimal, reproducible tar writer (ustar) for the app layer: fixed owner,
// mode and mtime, entries in the given order, so the same bundle always gives
// the same layer digest.
import { gzipSync } from 'node:zlib';

export type TarEntry = { path: string; content?: Buffer; mode?: number };

const BLOCK = 512;

function header(path: string, size: number, mode: number, type: '0' | '5'): Buffer {
	if (Buffer.byteLength(path) > 100) throw new Error(`tar path too long: ${path}`);
	const block = Buffer.alloc(BLOCK);
	const field = (offset: number, length: number, value: string) =>
		block.write(value, offset, length, 'utf8');
	const octal = (value: number, length: number) =>
		value.toString(8).padStart(length - 1, '0') + '\0';
	field(0, 100, path);
	field(100, 8, octal(mode, 8));
	field(108, 8, octal(0, 8)); // uid
	field(116, 8, octal(0, 8)); // gid
	field(124, 12, octal(size, 12));
	field(136, 12, octal(0, 12)); // mtime
	block.fill(' ', 148, 156); // checksum, spaces while computing it
	field(156, 1, type);
	field(257, 6, 'ustar\0');
	field(263, 2, '00');
	field(265, 32, 'root');
	field(297, 32, 'root');
	let sum = 0;
	for (const byte of block) sum += byte;
	field(148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
	return block;
}

/** The uncompressed tar, for the layer's diff_id. Directories end in `/`. */
export function tar(entries: TarEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const isDir = entry.path.endsWith('/');
		const content = entry.content ?? Buffer.alloc(0);
		parts.push(
			header(
				entry.path,
				isDir ? 0 : content.length,
				entry.mode ?? (isDir ? 0o755 : 0o644),
				isDir ? '5' : '0'
			)
		);
		if (!isDir) {
			parts.push(content);
			const padding = (BLOCK - (content.length % BLOCK)) % BLOCK;
			if (padding) parts.push(Buffer.alloc(padding));
		}
	}
	parts.push(Buffer.alloc(BLOCK * 2));
	return Buffer.concat(parts);
}

/** gzip with a fixed header (no file name, mtime 0), so it is as reproducible as the tar. */
export const gzip = (data: Buffer) => gzipSync(data, { level: 9 });
