/**
 * Remove EXIF and XMP from a JPEG before it leaves the phone.
 *
 * ⚠️ A PHONE PHOTOGRAPH CARRIES WHERE IT WAS TAKEN, TO A FEW METRES, AND OFTEN
 * WHICH PHONE TOOK IT. Someone sharing a picture of a hut is offering the
 * picture, not their movements — and a hut photo's GPS tag is frequently a
 * person's overnight position on a specific date. The safest position is not to
 * receive it: data never collected cannot leak, cannot be subpoenaed, and does
 * not have to be disclosed or deleted on request.
 *
 * ⚠️ DONE HERE RATHER THAN ON THE SERVER, DELIBERATELY. Stripping after upload
 * still means the coordinates arrived, were written to disk, and existed in a
 * backup. "We delete it on receipt" is a promise; not sending it is a fact.
 *
 * ⚠️ AND WITHOUT A NATIVE LIBRARY. expo-image-manipulator would re-encode the
 * image and drop metadata as a side effect, but it is a native module — a new
 * dependency and a rebuild for something that is thirty lines of byte walking.
 * Re-encoding would also throw away quality for no gain.
 *
 * All APP1 segments go: EXIF lives there, and so does XMP, which carries its own
 * copy of the location in many camera apps. APP0 (JFIF) stays — it holds the
 * density the decoder needs and nothing personal.
 */

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const APP1 = 0xe1;

/** Segments with no length field, which must be skipped two bytes at a time. */
function isStandalone(marker: number): boolean {
  return marker === SOI || marker === EOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

export interface Stripped {
  bytes: Uint8Array;
  /** How many metadata segments were removed. 0 means there was nothing to remove. */
  removed: number;
  /** False when the file was not a JPEG and has been passed through untouched. */
  handled: boolean;
}

export function stripExif(input: Uint8Array): Stripped {
  // Not a JPEG: hand it back unchanged and say so, rather than pretending.
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) {
    return { bytes: input, removed: 0, handled: false };
  }

  const keep: [number, number][] = [[0, 2]]; // the SOI marker itself
  let i = 2;
  let removed = 0;

  while (i < input.length - 1) {
    if (input[i] !== 0xff) { i++; continue; }          // resync on padding
    const marker = input[i + 1];
    if (marker === 0xff) { i++; continue; }            // fill byte

    if (isStandalone(marker)) {
      keep.push([i, i + 2]);
      i += 2;
      continue;
    }

    const length = (input[i + 2] << 8) | input[i + 3];
    // A length below 2 is malformed; stop rather than loop or read wildly.
    if (length < 2 || i + 2 + length > input.length) break;

    if (marker === APP1) {
      removed++;
    } else {
      keep.push([i, i + 2 + length]);
    }
    i += 2 + length;

    // ⚠️ Everything after SOS is compressed image data with no segment
    // structure — walking into it would misread pixels as markers. Copy the
    // remainder verbatim and stop.
    if (marker === SOS) {
      keep.push([i, input.length]);
      i = input.length;
      break;
    }
  }

  if (!removed) return { bytes: input, removed: 0, handled: true };

  const size = keep.reduce((n, [a, b]) => n + (b - a), 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const [a, b] of keep) {
    out.set(input.subarray(a, b), at);
    at += b - a;
  }
  return { bytes: out, removed, handled: true };
}
