// The TV plays separate video and audio tracks through Shaka, which needs to
// know where each file's segment index is. YouTube's adaptive CDN files already
// carry one from the encoder (an mp4 `sidx` box or a webm `Cues` element), so
// this only locates its byte range for `<SegmentBase indexRange>` instead of
// building an index from the media itself (see #lib/mse/dualTrackPlayer).
import { error } from '@sveltejs/kit';

/** Inclusive, as DASH `indexRange` and HTTP Range headers expect. */
export type ByteRange = [start: number, end: number];
/** What the stream-track index route returns, mirrored on the client by dualTrackPlayer.ts. */
export type SegmentBaseIndex = { initRange: ByteRange; indexRange: ByteRange };

// Comfortably covers ftyp+moov+sidx (a few hundred bytes to low KB even for
// long videos, since these are single-track files) or EBML header+Segment
// header+SeekHead+Info+Tracks+Cues, without pulling in a meaningful
// fraction of the actual media data.
const SCAN_WINDOW_BYTES = 2 * 1024 * 1024;

type RangeResult = { data: Uint8Array } | { status: number };

// Never throws, so fetchRange can decide whether another attempt is worth it.
async function tryFetchRange(url: string, start: number, end: number): Promise<RangeResult> {
	try {
		const res = await fetch(url, { headers: { range: `bytes=${start}-${end}` } });
		if (res.ok || res.status === 206) return { data: new Uint8Array(await res.arrayBuffer()) };
		return { status: res.status };
	} catch (err) {
		console.warn('[containerIndex] range fetch threw', err);
		return { status: 0 };
	}
}

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
	// The CDN occasionally drops or rejects a request, so retries avoid
	// failing the whole playback start on a transient blip.
	let lastStatus = 0;
	for (let attempt = 0; attempt < 3; attempt++) {
		const result = await tryFetchRange(url, start, end);
		if ('data' in result) return result.data;
		lastStatus = result.status;
	}
	error(502, `Upstream range request failed: ${lastStatus || 'network error'}`);
}

function readU32(data: Uint8Array, offset: number): number {
	return (
		(data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
	);
}

function readU64(data: Uint8Array, offset: number): number {
	const high = BigInt(readU32(data, offset) >>> 0);
	const low = BigInt(readU32(data, offset + 4) >>> 0);
	return Number((high << 32n) | low);
}

// One top-level box header: 32-bit size + fourcc, or 64-bit largesize when the
// 32-bit field is exactly 1.
function readMp4BoxHeader(data: Uint8Array, pos: number): { type: string; size: number } {
	const size32 = readU32(data, pos);
	const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
	const isLargeSize = size32 === 1;
	const headerSize = isLargeSize ? 16 : 8;
	const size = isLargeSize ? readU64(data, pos + 8) : size32;
	if (size < headerSize) error(502, `Malformed mp4 box "${type}" at offset ${pos}`);
	return { type, size };
}

// Where the media data starts. Reaching either without having seen a sidx means
// this file isn't laid out as a DASH-ready adaptive one.
function isMediaDataBox(type: string): boolean {
	return type === 'moof' || type === 'mdat';
}

// The init segment is everything before the sidx, the index is the box itself.
function sidxRanges(data: Uint8Array, pos: number, size: number): SegmentBaseIndex {
	const indexEnd = pos + size - 1;
	if (indexEnd >= data.length) error(502, 'sidx box extends past the scanned window');
	return { initRange: [0, pos - 1], indexRange: [pos, indexEnd] };
}

// Walks top-level boxes looking for `sidx`. Bails out once it hits `moof`/`mdat`
// with no sidx seen, since a file laid out that way isn't one of these
// DASH-ready adaptive files and there's nothing for MSE to index.
function findMp4SegmentIndex(data: Uint8Array): SegmentBaseIndex {
	let pos = 0;
	while (pos + 8 <= data.length) {
		const box = readMp4BoxHeader(data, pos);
		if (box.type === 'sidx') return sidxRanges(data, pos, box.size);
		if (isMediaDataBox(box.type)) break;
		pos += box.size;
	}
	error(404, 'No sidx box found -- not a DASH-ready mp4, MSE indexing unsupported for this stream');
}

// EBML variable-length integer. IDs keep their leading marker bit (it's
// part of the ID's identity), sizes have it stripped (it only encodes the
// integer's byte length).
function readVint(
	data: Uint8Array,
	pos: number,
	keepMarker: boolean
): { value: number; length: number } {
	const first = data[pos];
	if (first === 0) error(502, `Invalid EBML vint at offset ${pos}`);

	const { length, mask } = vintWidth(first);
	let value = keepMarker ? first : first & (mask - 1);
	for (let i = 1; i < length; i++) value = value * 256 + data[pos + i];
	return { value, length };
}

// The leading zero bits of the first byte encode how many bytes the integer
// occupies, and the marker bit that terminates them doubles as the mask separating
// the length prefix from the value.
function vintWidth(first: number): { length: number; mask: number } {
	let length = 1;
	let mask = 0x80;
	while (!(first & mask)) {
		length++;
		mask >>= 1;
	}
	return { length, mask };
}

// Offsets are absolute, so callers can turn them straight into byte ranges.
type EbmlElement = { id: number; start: number; bodyStart: number; size: number };

// Lazy so callers can stop at the first Cluster without walking media data.
function* ebmlChildren(data: Uint8Array, start: number, end: number): Generator<EbmlElement> {
	let pos = start;
	while (pos < end - 1 && pos < data.length) {
		const elementStart = pos;
		const idResult = readVint(data, pos, true);
		const sizePos = pos + idResult.length;
		const sizeResult = readVint(data, sizePos, false);
		const bodyStart = sizePos + sizeResult.length;
		yield { id: idResult.value, start: elementStart, bodyStart, size: sizeResult.value };
		pos = bodyStart + sizeResult.value;
	}
}

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const CUES_ID = 0x1c53bb6b;
const CLUSTER_ID = 0x1f43b675;

// The first child element at `start`, which must be the id the caller expects.
// Both of webm's outer levels (EBML header, then Segment) are a single known
// element rather than something to search for.
function expectFirstElement(
	data: Uint8Array,
	start: number,
	id: number,
	message: string
): EbmlElement {
	const element = [...ebmlChildren(data, start, data.length)][0];
	if (!element || element.id !== id) error(502, message);
	return element;
}

// Cues can appear before or after the first Cluster, and the scan stops at the
// Cluster either way, since everything before it is the init segment.
function findCuesAndFirstCluster(
	data: Uint8Array,
	start: number
): { cues?: EbmlElement; firstCluster?: EbmlElement } {
	let cues: EbmlElement | undefined;
	for (const child of ebmlChildren(data, start, data.length)) {
		if (child.id === CUES_ID) cues = child;
		if (child.id === CLUSTER_ID) return { cues, firstCluster: child };
	}
	return { cues, firstCluster: undefined };
}

// Matroska/webm Clusters are independently parseable, so unlike mp4 there's
// no separate fragmentation step. The encoder-provided Cues element (time ->
// Cluster byte offset) is already exactly the DASH SegmentBase index webm
// needs. The init segment is everything before the first Cluster. Shaka's
// WebM index parser reads the init segment's Info element for the timecode
// scale, so this range has to be genuinely parseable, not a placeholder.
function findWebmSegmentIndex(data: Uint8Array): SegmentBaseIndex {
	const header = expectFirstElement(data, 0, EBML_ID, 'Not an EBML file');
	const segment = expectFirstElement(
		data,
		header.bodyStart + header.size,
		SEGMENT_ID,
		'No Segment element found'
	);

	const { cues, firstCluster } = findCuesAndFirstCluster(data, segment.bodyStart);
	if (!cues) error(404, 'No Cues element found -- MSE indexing unsupported for this stream');
	if (!firstCluster) error(502, 'No Cluster found after Cues');

	return {
		// Shaka parses whatever's at `indexRange` as one whole top-level EBML
		// element (id+size header included) and checks that the id is Cues,
		// so this has to span the element's own header too, not just its
		// body, the same as the mp4 sidx box's indexRange above.
		initRange: [0, firstCluster.start - 1],
		indexRange: [cues.start, cues.bodyStart + cues.size - 1]
	};
}

/**
 * Reached through containerIndexCache.ts, not called directly. Throws a
 * SvelteKit error if the file has no usable index (404) or is malformed or
 * unreachable (502).
 */
export async function buildSegmentBaseIndex(
	url: string,
	container: 'mp4' | 'webm'
): Promise<SegmentBaseIndex> {
	const data = await fetchRange(url, 0, SCAN_WINDOW_BYTES - 1);
	return container === 'mp4' ? findMp4SegmentIndex(data) : findWebmSegmentIndex(data);
}
