// YouTube's adaptive (video-only/audio-only) CDN files aren't plain
// progressive downloads -- they're already DASH-ready containers with a
// real segment index baked in by the encoder: an ISOBMFF `sidx` box for
// mp4, a Matroska `Cues` element for webm. Confirmed by hand-parsing real
// resolved URLs (both had a compact index within the first couple KB,
// pointing at ~10s fragments). That means MSE playback doesn't need to
// invent segment boundaries or walk sample tables itself -- it just needs
// to locate that existing index's byte range and hand it to Shaka via
// `<SegmentBase indexRange="...">`, which already knows how to parse both
// sidx and Cues on its own (see #lib/mse/dualTrackPlayer's manifest).
import { error } from '@sveltejs/kit';

export type ByteRange = [start: number, end: number];
export type SegmentBaseIndex = { initRange: ByteRange; indexRange: ByteRange };

// Comfortably covers ftyp+moov+sidx (a few hundred bytes to low KB even for
// long videos, since these are single-track files) or EBML header+Segment
// header+SeekHead+Info+Tracks+Cues -- without pulling in a meaningful
// fraction of the actual media data.
const SCAN_WINDOW_BYTES = 2 * 1024 * 1024;

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
	const res = await fetch(url, { headers: { range: `bytes=${start}-${end}` } });
	if (!res.ok && res.status !== 206) error(502, `Upstream range request failed: ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
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

// Walks top-level ISOBMFF boxes (32-bit size + fourcc, or 64-bit largesize
// when size===1) looking for `sidx`. Bails out once it hits `moof`/`mdat`
// with no sidx seen -- a file laid out that way isn't one of these
// DASH-ready adaptive files, so there's nothing for MSE to index here.
function findMp4SegmentIndex(data: Uint8Array): SegmentBaseIndex {
	let pos = 0;
	while (pos + 8 <= data.length) {
		const size32 = readU32(data, pos);
		const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
		const headerSize = size32 === 1 ? 16 : 8;
		const size = size32 === 1 ? readU64(data, pos + 8) : size32;
		if (size < headerSize) error(502, `Malformed mp4 box "${type}" at offset ${pos}`);

		if (type === 'sidx') {
			const indexEnd = pos + size - 1;
			if (indexEnd >= data.length) error(502, 'sidx box extends past the scanned window');
			return { initRange: [0, pos - 1], indexRange: [pos, indexEnd] };
		}
		if (type === 'moof' || type === 'mdat') break;
		pos += size;
	}
	error(404, 'No sidx box found -- not a DASH-ready mp4, MSE indexing unsupported for this stream');
}

// EBML variable-length integer. IDs keep their leading marker bit (it's
// part of the ID's identity); sizes have it stripped (it only encodes the
// integer's byte length).
function readVint(
	data: Uint8Array,
	pos: number,
	keepMarker: boolean
): { value: number; length: number } {
	const first = data[pos];
	if (first === 0) error(502, `Invalid EBML vint at offset ${pos}`);
	let length = 1;
	let mask = 0x80;
	while (!(first & mask)) {
		length++;
		mask >>= 1;
	}
	let value = keepMarker ? first : first & (mask - 1);
	for (let i = 1; i < length; i++) value = value * 256 + data[pos + i];
	return { value, length };
}

type EbmlElement = { id: number; start: number; bodyStart: number; size: number };

function* ebmlChildren(data: Uint8Array, start: number, end: number): Generator<EbmlElement> {
	let pos = start;
	while (pos < end - 1) {
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

// Matroska/webm Clusters are independently parseable, so unlike mp4 there's
// no separate fragmentation step -- the encoder-provided Cues element
// (mapping time -> Cluster byte offset) is already exactly the DASH
// SegmentBase index webm needs. The init segment is everything before the
// first Cluster (EBML header + Segment header + SeekHead/Info/Tracks/Cues,
// whichever of those the encoder put up front) -- Shaka's WebM segment
// index parser reads the init segment's Info element for the timecode
// scale, so this range has to be genuinely fetchable/parseable, not just a
// placeholder.
function findWebmSegmentIndex(data: Uint8Array): SegmentBaseIndex {
	const header = [...ebmlChildren(data, 0, data.length)][0];
	if (!header || header.id !== EBML_ID) error(502, 'Not an EBML file');
	const segment = [...ebmlChildren(data, header.bodyStart + header.size, data.length)][0];
	if (!segment || segment.id !== SEGMENT_ID) error(502, 'No Segment element found');

	let cues: EbmlElement | undefined;
	let firstCluster: EbmlElement | undefined;
	for (const child of ebmlChildren(data, segment.bodyStart, data.length)) {
		if (child.id === CUES_ID) cues = child;
		if (child.id === CLUSTER_ID) {
			firstCluster = child;
			break;
		}
	}
	if (!cues) error(404, 'No Cues element found -- MSE indexing unsupported for this stream');
	if (!firstCluster) error(502, 'No Cluster found after Cues');

	return {
		// Shaka parses whatever's at `indexRange` as one whole top-level EBML
		// element (id+size header included) and checks that the id is Cues --
		// so this has to span the element's own header too, not just its
		// body, the same as the mp4 sidx box's indexRange below.
		initRange: [0, firstCluster.start - 1],
		indexRange: [cues.start, cues.bodyStart + cues.size - 1]
	};
}

export async function buildSegmentBaseIndex(
	url: string,
	container: 'mp4' | 'webm'
): Promise<SegmentBaseIndex> {
	const data = await fetchRange(url, 0, SCAN_WINDOW_BYTES - 1);
	return container === 'mp4' ? findMp4SegmentIndex(data) : findWebmSegmentIndex(data);
}
