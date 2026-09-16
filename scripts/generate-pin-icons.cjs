/**
 * One-time asset generator: rasterizes the 5 hut-pin badges (rounded-square
 * colour badge + pointed tail + white Ionicons glyph) to static PNGs at 1x/2x/3x,
 * for use as `Marker image={...}` sources instead of a live custom View — native
 * image markers skip react-native-maps' per-pin view-snapshot machinery
 * entirely, which is what was making hundreds of pins slow to render.
 *
 * Extracts the exact glyph outline from the same Ionicons.ttf the app already
 * uses (via opentype.js) rather than reproducing the icon by hand, so the pin
 * looks pixel-identical to the previous <Ionicons/> rendering. Run with
 * `node scripts/generate-pin-icons.cjs` whenever a pin's color/icon/size
 * changes; not part of the app's runtime bundle (dev-only tool — output PNGs
 * under assets/pins/ are the only thing committed).
 *
 * Logs the exact anchor fraction to use in <Marker anchor={...}> at the end —
 * it's NOT {x:0.5,y:1} because of the shadow padding added around the badge
 * (see PAD below); copy that value into hutPinAnchor() in hutMeta.ts if it
 * ever changes (badge size, shadow padding, etc.).
 */
const opentype = require('opentype.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const FONT_PATH = path.join(
  __dirname,
  '../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf',
);
const OUT_DIR = path.join(__dirname, '../assets/pins');

// Must mirror hutPinColor()/hutPinIcon() in src/utils/hutMeta.ts exactly.
const PINS = [
  { type: 'alpine_hut', icon: 'home', color: '#2f6f4f' },
  { type: 'wilderness_hut', icon: 'home-outline', color: '#8a6d3b' },
  { type: 'shelter', icon: 'triangle', color: '#4a72b0' },
  { type: 'guesthouse', icon: 'bed', color: '#8e44ad' },
  { type: 'village', icon: 'location', color: '#555555' },
];

// Mirrors the OLD hutPinBadge/hutPinTail/hutPinWrap View styles exactly, so the
// rasterized badge is pixel-equivalent to what they used to render.
const BADGE = 25; // hutPinBadge width/height
const BADGE_RADIUS = 8;
const BORDER = 2; // hutPinBadge borderWidth (white)
const TAIL_HALF_W = 5; // hutPinTail borderLeftWidth/borderRightWidth
const TAIL_H = 6; // hutPinTail borderTopWidth
const TAIL_OVERLAP = 1; // hutPinTail marginTop: -1
const ICON_SIZE = 13; // the <Ionicons size={13}/> this replaces
// Extra transparent margin so the drop shadow isn't clipped at the image edge.
const PAD = 3;

const BADGE_W = BADGE;
const BADGE_H = BADGE - TAIL_OVERLAP + TAIL_H; // badge + tail, minus the overlap
const IMG_W = BADGE_W + PAD * 2;
const IMG_H = BADGE_H + PAD * 2;

// Where the tail's tip (the actual map coordinate) sits as a fraction of the
// FULL padded image — this is what <Marker anchor={...}> must use, since the
// padding shifts it away from a plain {x:0.5, y:1}.
const ANCHOR_X = 0.5;
const ANCHOR_Y = (BADGE_H + PAD) / IMG_H;

function loadFont() {
  const buf = fs.readFileSync(FONT_PATH);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return opentype.parse(arrayBuffer);
}

const GLYPHMAP = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      '../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
    ),
    'utf8',
  ),
);

function iconPathCenteredAt(font, iconName, cx, cy) {
  const codepoint = GLYPHMAP[iconName];
  if (codepoint == null) throw new Error(`Unknown Ionicons glyph: ${iconName}`);
  const char = String.fromCodePoint(codepoint);
  const glyph = font.charToGlyph(char);

  // First pass at the origin, purely to measure the glyph's own ink bbox at
  // the real render size (13, matching <Ionicons size={13}/> exactly).
  const measure = glyph.getPath(0, 0, ICON_SIZE).getBoundingBox();
  const bboxCx = (measure.x1 + measure.x2) / 2;
  const bboxCy = (measure.y1 + measure.y2) / 2;

  // Re-emit the path translated so the ink-bbox centre lands on (cx, cy).
  const dx = cx - bboxCx;
  const dy = cy - bboxCy;
  return glyph.getPath(dx, dy, ICON_SIZE).toPathData(2);
}

function buildSvg(font, { icon, color }) {
  // All positions below are in "badge space" (0,0 = badge top-left); the SVG's
  // viewBox is offset by -PAD so badge space (0..BADGE_W, 0..BADGE_H) sits
  // centred inside the padded image.
  const iconD = iconPathCenteredAt(font, icon, BADGE / 2, BADGE / 2);
  const tailTop = BADGE - TAIL_OVERLAP;
  const tailTip = tailTop + TAIL_H;
  const tailLeft = BADGE / 2 - TAIL_HALF_W;
  const tailRight = BADGE / 2 + TAIL_HALF_W;
  const inset = BORDER / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IMG_W}" height="${IMG_H}" viewBox="${-PAD} ${-PAD} ${IMG_W} ${IMG_H}">
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0.5" stdDeviation="0.8" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <polygon points="${tailLeft},${tailTop} ${tailRight},${tailTop} ${BADGE / 2},${tailTip}" fill="${color}"/>
    <rect x="${inset}" y="${inset}" width="${BADGE - BORDER}" height="${BADGE - BORDER}" rx="${BADGE_RADIUS - inset}" ry="${BADGE_RADIUS - inset}" fill="${color}" stroke="white" stroke-width="${BORDER}"/>
  </g>
  <path d="${iconD}" fill="white"/>
</svg>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const font = loadFont();

  for (const pin of PINS) {
    const svg = buildSvg(font, pin);
    for (const scale of [1, 2, 3]) {
      const suffix = scale === 1 ? '' : `@${scale}x`;
      const outPath = path.join(OUT_DIR, `pin-${pin.type}${suffix}.png`);
      await sharp(Buffer.from(svg))
        .resize(Math.round(IMG_W * scale), Math.round(IMG_H * scale))
        .png()
        .toFile(outPath);
    }
    console.log(`generated pin-${pin.type} (1x/2x/3x)`);
  }

  console.log(`\nanchor: {x: ${ANCHOR_X}, y: ${ANCHOR_Y.toFixed(4)}}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
