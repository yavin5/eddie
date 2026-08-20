/**
 * Eddie bot unit tests.
 *
 * This suite exercises the image-vision helpers in bot.ts — the functions that
 * detect image types from magic bytes, strip signal-cli JSON headers, encode
 * local image files into base64 data URLs, and assemble OpenAI-compatible
 * multi-modal message arrays for the LLM API. It does not require signal-cli
 * or a running LLM; temp files are written under /tmp and cleaned up inline.
 *
 * Run with: npm test
 */
import * as path from 'path';
import * as fs from 'fs';
import { strict as assert } from 'assert';
import {
    detectImageMimeExt,
    stripPossibleJsonHeader,
    isRecognizedImage,
    buildMessageContent,
    imageFileToDataUrl,
    buildLlmMessages,
    LlmContentPart,
} from './bot';

let pass = 0;
let fail = 0;

/**
 * Runs a single test function, counting and printing pass/fail. A failing
 * test prints the first few lines of the error for quick diagnosis.
 * @param {string} name A short human-readable description of what the test checks.
 * @param {() => void} fn The test body; it should throw (via assert) on failure.
 */
function ok(name: string, fn: () => void) {
    try {
        fn();
        pass++;
        console.log(`  ok   ${name}`);
    } catch (err) {
        fail++;
        console.log(`  FAIL ${name}`);
        console.log(String(err).split('\n').slice(0, 4).join('\n       '));
    }
}

// ---------------------------------------------------------------------------
// Test fixture values — every literal used by the tests below lives here.
// ---------------------------------------------------------------------------

/** Base64 of a 1x1 transparent PNG — the smallest valid PNG, our canonical "real image" fixture. */
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_B64, 'base64');

/** JPEG magic prefix: FF D8 FF (plus an arbitrary 4th byte). */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
/** GIF8 magic prefix. */
const GIF_MAGIC = Buffer.from('GIF8');
/** BMP magic prefix: 'B' 'M'. */
const BMP_MAGIC = Buffer.from('BM');
/** WebP requires 'RIFF' at offset 0 and 'WEBP' at offset 8. */
const WEBP_RIFF_BYTES = Buffer.from('RIFFabcd');
/** A buffer of ordinary text bytes — should NOT be recognized as an image. */
const TEXT_BYTES = Buffer.from('hello world hello hello');
/** Another text buffer for the isRecognizedImage negative case. */
const OTHER_TEXT_BYTES = Buffer.from('just some text');

/** A plausible signal-cli JSON metadata header line, terminated by a newline. */
const JSON_HEADER_LINE = Buffer.from('{"json":"json"}\n');
/** A plain text buffer that must pass through stripPossibleJsonHeader unchanged. */
const PLAIN_BYTES = Buffer.from('hello world');
/** A JSON-looking buffer with no trailing newline — must pass through unchanged. */
const JSON_NO_NEWLINE = Buffer.from('{"json":"1"}');

/** Sample caption text sent alongside an image. */
const SAMPLE_TEXT = 'hi';
/** Empty caption — the image-only case. */
const EMPTY_TEXT = '';
/** A message that is definitely not an image file. */
const NON_IMAGE_TEXT = 'not an image at all here';
/** A plain chat message with no images. */
const PLAIN_MESSAGE = 'plain text only';
/** A sample prompt caption for the buildLlmMessages multi-modal test. */
const SAMPLE_PROMPT = 'what is this?';
/** Unknown bytes used to test the imageFileToDataUrl mime fallback. */
const UNKNOWN_BYTES = Buffer.from('???');

/** The data-URL prefix every PNG fixture should encode to. */
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** Temp file paths under /tmp for file-backed tests; each is removed after use. */
const TMP_PNG_FILE = path.join('/tmp', 'eddie-test-img.png');
const TMP_BAD_FILE = path.join('/tmp', 'eddie-test-bad.txt');
const TMP_PNG_FILE2 = path.join('/tmp', 'eddie-test-img2.png');
const TMP_UNKNOWN_FILE = path.join('/tmp', 'eddie-test-unknown.bin');
const TMP_PNG_FILE3 = path.join('/tmp', 'eddie-test-img3.png');

// ---------------------------------------------------------------------------
// detectImageMimeExt
// Verifies each supported image format is recognized from its magic bytes,
// and that non-image buffers return null.
// ---------------------------------------------------------------------------
console.log('detectImageMimeExt — recognize image formats by magic bytes');
ok('png magic', () => {
    assert.deepEqual(detectImageMimeExt(TINY_PNG), { mime: 'image/png', ext: '.png' });
});
ok('jpeg magic', () => {
    assert.deepEqual(detectImageMimeExt(Buffer.concat([JPEG_MAGIC, TINY_PNG])), { mime: 'image/jpeg', ext: '.jpg' });
});
ok('gif magic', () => {
    assert.deepEqual(detectImageMimeExt(Buffer.concat([GIF_MAGIC, TINY_PNG])), { mime: 'image/gif', ext: '.gif' });
});
ok('bmp magic', () => {
    assert.deepEqual(detectImageMimeExt(Buffer.concat([BMP_MAGIC, TINY_PNG])), { mime: 'image/bmp', ext: '.bmp' });
});
ok('webp magic', () => {
    assert.deepEqual(detectImageMimeExt(Buffer.concat([WEBP_RIFF_BYTES, Buffer.from('WEBP')])), { mime: 'image/webp', ext: '.webp' });
});
ok('non-image bytes', () => {
    assert.equal(detectImageMimeExt(TEXT_BYTES), null);
});
ok('empty buffer', () => {
    assert.equal(detectImageMimeExt(Buffer.alloc(0)), null);
});

// ---------------------------------------------------------------------------
// isRecognizedImage
// Same magic-byte logic exposed as a boolean convenience wrapper.
// ---------------------------------------------------------------------------
console.log('isRecognizedImage — boolean image check');
ok('true for png buffer', () => { assert.equal(isRecognizedImage(TINY_PNG), true); });
ok('false for text buffer', () => { assert.equal(isRecognizedImage(OTHER_TEXT_BYTES), false); });

// ---------------------------------------------------------------------------
// stripPossibleJsonHeader
// signal-cli sometimes prints a JSON metadata line before raw file bytes;
// this must strip exactly that line and leave everything else intact.
// ---------------------------------------------------------------------------
console.log('stripPossibleJsonHeader — remove signal-cli JSON header line');
ok('strips json line before image bytes', () => {
    const r = stripPossibleJsonHeader(Buffer.concat([JSON_HEADER_LINE, TINY_PNG]));
    assert.equal(Buffer.compare(r, TINY_PNG), 0);
});
ok('keeps plain buffer', () => {
    assert.equal(Buffer.compare(stripPossibleJsonHeader(PLAIN_BYTES), PLAIN_BYTES), 0);
});
ok('keeps buffer without newline', () => {
    assert.equal(Buffer.compare(stripPossibleJsonHeader(JSON_NO_NEWLINE), JSON_NO_NEWLINE), 0);
});

// ---------------------------------------------------------------------------
// buildMessageContent
// Assembles the OpenAI multi-modal content array: one text entry first, then
// one image_url entry per file, each a base64 data URL with the right mime.
// ---------------------------------------------------------------------------
console.log('buildMessageContent — assemble text + image_url content array');
ok('no images -> empty array', () => {
    assert.deepEqual(buildMessageContent(SAMPLE_TEXT, []), []);
});
fs.writeFileSync(TMP_PNG_FILE, TINY_PNG);
ok('text + image -> text then image_url entries', () => {
    const c = buildMessageContent(SAMPLE_TEXT, [TMP_PNG_FILE]);
    assert.equal(c.length, 2);
    assert.equal(c[0].type, 'text');
    assert.equal(c[0].text, SAMPLE_TEXT);
    assert.equal(c[1].type, 'image_url');
    assert.ok(c[1]!.image_url!.url.startsWith(PNG_DATA_URL_PREFIX));
});
ok('empty text + image', () => {
    const c = buildMessageContent(EMPTY_TEXT, [TMP_PNG_FILE]);
    assert.equal(c.length, 2);
    assert.equal(c[0].text, EMPTY_TEXT);
});
ok('throws on non-image file', () => {
    fs.writeFileSync(TMP_BAD_FILE, NON_IMAGE_TEXT);
    assert.throws(() => buildMessageContent(SAMPLE_TEXT, [TMP_BAD_FILE]), /unrecognized image/);
    fs.unlinkSync(TMP_BAD_FILE);
});
fs.unlinkSync(TMP_PNG_FILE);

// ---------------------------------------------------------------------------
// imageFileToDataUrl
// Reads a whole image file and returns a base64 data URL; falls back to a
// png mime type if magic-byte detection fails.
// ---------------------------------------------------------------------------
console.log('imageFileToDataUrl — file to base64 data URL');
ok('encodes real png file', () => {
    fs.writeFileSync(TMP_PNG_FILE2, TINY_PNG);
    const dataUrl = imageFileToDataUrl(TMP_PNG_FILE2);
    assert.ok(dataUrl.startsWith(PNG_DATA_URL_PREFIX));
    assert.equal(Buffer.from(dataUrl.split(',')[1], 'base64').length, TINY_PNG.length);
    fs.unlinkSync(TMP_PNG_FILE2);
});
ok('falls back to png mime for unknown bytes', () => {
    fs.writeFileSync(TMP_UNKNOWN_FILE, UNKNOWN_BYTES);
    const dataUrl = imageFileToDataUrl(TMP_UNKNOWN_FILE);
    assert.ok(dataUrl.startsWith(PNG_DATA_URL_PREFIX));
    fs.unlinkSync(TMP_UNKNOWN_FILE);
});

// ---------------------------------------------------------------------------
// buildLlmMessages
// Transforms ChatMessage entries into LLM-ready messages: text-only entries
// keep string content; entries with images get a multi-modal content array.
// ---------------------------------------------------------------------------
console.log('buildLlmMessages — ChatMessage to LLM message');
ok('text-only stays string content', () => {
    const ms = buildLlmMessages([{ role: 'user', content: PLAIN_MESSAGE, images: [] }]);
    assert.equal(ms[0].role, 'user');
    assert.equal(ms[0].content, PLAIN_MESSAGE);
});
ok('images -> multi-modal content array', () => {
    fs.writeFileSync(TMP_PNG_FILE3, TINY_PNG);
    const ms = buildLlmMessages([{ role: 'user', content: SAMPLE_PROMPT, images: [TMP_PNG_FILE3] }]);
    assert.equal(typeof ms[0].content, 'object');
    assert.equal((ms[0].content as LlmContentPart[])[0].type, 'text');
    assert.equal((ms[0].content as LlmContentPart[])[1].type, 'image_url');
    fs.unlinkSync(TMP_PNG_FILE3);
});
ok('empty messages -> empty array', () => {
    assert.deepEqual(buildLlmMessages([]), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
