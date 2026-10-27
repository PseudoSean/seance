// Does this image file animate?
//
// The "remove metadata" upload setting redraws an image through a canvas,
// which keeps exactly one frame: an animated WebP, APNG or AVIF sequence
// would reach the uploader as a still. GIF is exempted by MIME type; these
// three share their type with their still siblings, so the container has to
// be read. Each check looks at the header only (a few dozen bytes for WebP
// and AVIF; the chunk list ahead of the pixel data for PNG), never at the
// pixels, and is Vue- and DOM-free so mocha covers it
// (`test/helpers/animatedImage.ts`).

const HEADER_BYTES = 64 * 1024;

function fourcc(bytes: Uint8Array, at: number): string {
	if (at + 4 > bytes.length) {
		return "";
	}

	return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function readBE32(bytes: Uint8Array, at: number): number {
	return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/**
 * WebP: a `RIFF….WEBP` container. An animation is required to open with a
 * `VP8X` chunk whose flags byte has the Animation bit (0x02) set; a file
 * that opens with `VP8 ` (lossy) or `VP8L` (lossless) has a single frame.
 */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
	if (fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WEBP") {
		return false;
	}

	if (fourcc(bytes, 12) !== "VP8X" || bytes.length < 21) {
		return false;
	}

	// Chunk header is 8 bytes (fourcc + size); the flags byte comes first.
	return (bytes[20] & 0x02) !== 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG: an APNG carries an `acTL` (animation control) chunk before the first
 * `IDAT`. Walks the chunk list: `true` on `acTL`, `false` on `IDAT` or a
 * non-PNG, `undefined` when the bytes run out first (the caller can read
 * more of the file and try again).
 */
export function isAnimatedPng(bytes: Uint8Array): boolean | undefined {
	if (bytes.length < PNG_SIGNATURE.length) {
		return false;
	}

	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		if (bytes[i] !== PNG_SIGNATURE[i]) {
			return false;
		}
	}

	let at = PNG_SIGNATURE.length;

	// Each chunk: 4-byte length, 4-byte type, data, 4-byte CRC.
	while (at + 8 <= bytes.length) {
		const length = readBE32(bytes, at);
		const type = fourcc(bytes, at + 4);

		if (type === "acTL") {
			return true;
		}

		if (type === "IDAT" || type === "IEND") {
			return false;
		}

		at += 12 + length;
	}

	return undefined;
}

/**
 * AVIF: an ISOBMFF file opening with an `ftyp` box. An image sequence lists
 * `avis` among its brands (major or compatible); a still lists only `avif`.
 */
export function isAnimatedAvif(bytes: Uint8Array): boolean {
	if (bytes.length < 16 || fourcc(bytes, 4) !== "ftyp") {
		return false;
	}

	const size = readBE32(bytes, 0);
	const end = Math.min(size > 8 ? size : bytes.length, bytes.length);

	// Major brand at 8, minor version at 12, compatible brands from 16.
	if (fourcc(bytes, 8) === "avis") {
		return true;
	}

	for (let at = 16; at + 4 <= end; at += 4) {
		if (fourcc(bytes, at) === "avis") {
			return true;
		}
	}

	return false;
}

/**
 * Whether these header bytes describe an animated WebP, APNG or AVIF
 * sequence. `undefined` only for a PNG whose chunk list outran the bytes.
 */
function sniff(bytes: Uint8Array): boolean | undefined {
	if (fourcc(bytes, 0) === "RIFF") {
		return isAnimatedWebp(bytes);
	}

	if (bytes.length >= 4 && bytes[0] === 0x89 && fourcc(bytes, 1).startsWith("PNG")) {
		return isAnimatedPng(bytes);
	}

	if (fourcc(bytes, 4) === "ftyp") {
		return isAnimatedAvif(bytes);
	}

	return false;
}

/** `sniff` for callers that already hold the bytes; undecided counts as still. */
export function isAnimatedImageBytes(bytes: Uint8Array): boolean {
	return sniff(bytes) === true;
}

/**
 * Whether `file` is an animated image (WebP, APNG or AVIF sequence), judged
 * from its header. Reads the first 64 KiB; a PNG whose chunk list runs past
 * that (a large embedded colour profile) is read in full. Anything
 * unreadable or unrecognised is a still.
 */
export async function isAnimatedImage(file: Blob): Promise<boolean> {
	try {
		const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
		const verdict = sniff(head);

		if (verdict !== undefined || file.size <= head.length) {
			return verdict === true;
		}

		return sniff(new Uint8Array(await file.arrayBuffer())) === true;
	} catch (e) {
		return false;
	}
}

// ------------------------------------------------------------ one play

/** How long one play of an animation lasts, and how many frames it has. */
export interface AnimationInfo {
	frames: number;
	durationMs: number;
}

/**
 * A frame delay as browsers play it: GIF, WebP and APNG files made to "run
 * as fast as possible" (10 ms or less, 0 included) are shown at 100 ms a
 * frame by Chrome and Firefox alike, so a sum of the raw delays would end
 * the play early.
 */
function playedDelay(ms: number): number {
	return ms <= 10 ? 100 : ms;
}

function readLE16(bytes: Uint8Array, at: number): number {
	return bytes[at] | (bytes[at + 1] << 8);
}

function readLE24(bytes: Uint8Array, at: number): number {
	return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
}

function readLE32(bytes: Uint8Array, at: number): number {
	return (readLE24(bytes, at) | (bytes[at + 3] << 24)) >>> 0;
}

/** Skip a run of GIF data sub-blocks (length byte, data, …, 0); returns the offset after it. */
function skipSubBlocks(bytes: Uint8Array, at: number): number {
	while (at < bytes.length) {
		const size = bytes[at];
		at += 1;

		if (size === 0) {
			return at;
		}

		at += size;
	}

	return at;
}

/** GIF: a Graphic Control Extension (0x21 0xF9) ahead of each image carries its delay in 1/100 s. */
function gifInfo(bytes: Uint8Array): AnimationInfo | undefined {
	const signature = String.fromCharCode(...bytes.subarray(0, 6));

	if (signature !== "GIF87a" && signature !== "GIF89a") {
		return undefined;
	}

	let at = 13;
	const screenFlags = bytes[10];

	if (screenFlags & 0x80) {
		at += 3 * (1 << ((screenFlags & 0x07) + 1));
	}

	let frames = 0;
	let durationMs = 0;
	let delay = 0;

	while (at < bytes.length) {
		const block = bytes[at];

		if (block === 0x3b) {
			break; // trailer
		}

		if (block === 0x21) {
			if (bytes[at + 1] === 0xf9 && at + 6 < bytes.length) {
				delay = readLE16(bytes, at + 4) * 10;
			}

			at = skipSubBlocks(bytes, at + 2);
		} else if (block === 0x2c) {
			const flags = bytes[at + 9];
			at += 10;

			if (flags & 0x80) {
				at += 3 * (1 << ((flags & 0x07) + 1));
			}

			at = skipSubBlocks(bytes, at + 1); // LZW minimum code size, then the data
			frames++;
			durationMs += playedDelay(delay);
			delay = 0;
		} else {
			break; // not a block we know: stop at what we have
		}
	}

	return frames > 0 ? {frames, durationMs} : undefined;
}

/** WebP: each `ANMF` chunk is a frame; its duration is 24 bits at payload offset 12, in ms. */
function webpInfo(bytes: Uint8Array): AnimationInfo | undefined {
	if (!isAnimatedWebp(bytes)) {
		return undefined;
	}

	let frames = 0;
	let durationMs = 0;
	let at = 12;

	while (at + 8 <= bytes.length) {
		const type = fourcc(bytes, at);
		const size = readLE32(bytes, at + 4);

		if (type === "ANMF" && at + 8 + 15 <= bytes.length) {
			frames++;
			durationMs += playedDelay(readLE24(bytes, at + 8 + 12));
		}

		at += 8 + size + (size & 1);
	}

	return frames > 0 ? {frames, durationMs} : undefined;
}

/** APNG: each `fcTL` chunk is a frame; its delay is `delay_num / delay_den` seconds (den 0 = 100). */
function apngInfo(bytes: Uint8Array): AnimationInfo | undefined {
	if (isAnimatedPng(bytes) !== true) {
		return undefined;
	}

	let frames = 0;
	let durationMs = 0;
	let at = PNG_SIGNATURE.length;

	while (at + 8 <= bytes.length) {
		const length = readBE32(bytes, at);
		const type = fourcc(bytes, at + 4);

		if (type === "fcTL" && at + 8 + 24 <= bytes.length) {
			const num = (bytes[at + 8 + 20] << 8) | bytes[at + 8 + 21];
			const den = (bytes[at + 8 + 22] << 8) | bytes[at + 8 + 23] || 100;
			frames++;
			durationMs += playedDelay((num / den) * 1000);
		}

		if (type === "IEND") {
			break;
		}

		at += 12 + length;
	}

	return frames > 0 ? {frames, durationMs} : undefined;
}

/**
 * Frames and the length of one play of an animated GIF, WebP or APNG,
 * read from the whole file. `undefined` for anything else — a still, an
 * AVIF sequence (its timing lives deep in ISOBMFF boxes), bytes that are
 * not an image. A single-frame GIF is `{frames: 1}`: a still.
 */
export function animationInfo(bytes: Uint8Array): AnimationInfo | undefined {
	return gifInfo(bytes) ?? webpInfo(bytes) ?? apngInfo(bytes);
}
