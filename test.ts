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
    decodeBase64IfNecessary,
    isRecognizedImage,
    buildMessageContent,
    imageFileToDataUrl,
    buildLlmMessages,
    extractLlmContent,
    LlmContentPart,
    LlmResponse,
    shouldUseFetchAttachmentAlias,
    extractAttachmentIds,
    pickAttachmentCommand,
    buildAttachmentAccountArgs,
    buildGetAttachmentArgs,
    buildSendArgs,
    buildListContactsArgs,
    parseReceiveLine,
    clipThinkTags,
    extractContentAfterBotMention,
    SignalDataMessage,
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
// decodeBase64IfNecessary
// signal-cli may return the attachment as base64 text (raw or data-URL)
// rather than raw file bytes; the pipeline must decode it back.
// ---------------------------------------------------------------------------
console.log('decodeBase64IfNecessary — decode base64 attachments to image bytes');
ok('decodes base64 body into a recognized image', () => {
    const r = decodeBase64IfNecessary(Buffer.from(TINY_PNG_B64));
    assert.equal(isRecognizedImage(r), true);
    assert.deepEqual(detectImageMimeExt(r), { mime: 'image/png', ext: '.png' });
});
ok('passes through an already-recognized image untouched', () => {
    assert.equal(Buffer.compare(decodeBase64IfNecessary(TINY_PNG), TINY_PNG), 0);
});
ok('decodes data-URL prefixed body', () => {
    const r = decodeBase64IfNecessary(Buffer.from(`data:image/png;base64,${TINY_PNG_B64}`));
    assert.equal(isRecognizedImage(r), true);
});
ok('returns original buffer when base64 doesn\'t decode to an image', () => {
    const notImage = Buffer.from(Buffer.from('hello world').toString('base64'));
    assert.equal(Buffer.compare(decodeBase64IfNecessary(notImage), notImage), 0);
});
ok('returns original buffer when text has non-base64 chars', () => {
    assert.equal(Buffer.compare(decodeBase64IfNecessary(PLAIN_BYTES), PLAIN_BYTES), 0);
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

// ---------------------------------------------------------------------------
// extractLlmContent
// The reply text must be extractable from both the OpenAI-compatible
// `choices[0].message.content` shape and the native Ollama `message.content`
// shape, returning '' when the reply is absent from both.
// ---------------------------------------------------------------------------
console.log('extractLlmContent — accept both API response shapes');
const REPLY = 'Hello hello';
ok('OpenAI-compatible choices shape', () => {
    const body: LlmResponse = {
        choices: [{ message: { content: REPLY } }],
    };
    assert.equal(extractLlmContent(body), REPLY);
});
ok('native Ollama message shape', () => {
    const body: LlmResponse = {
        message: { content: REPLY },
    };
    assert.equal(extractLlmContent(body), REPLY);
});
ok('choices shape wins when both present', () => {
    const body: LlmResponse = {
        choices: [{ message: { content: REPLY } }],
        message: { content: 'other' },
    };
    assert.equal(extractLlmContent(body), REPLY);
});
ok('empty when both shapes absent', () => {
    assert.equal(extractLlmContent({}), '');
});
ok('empty content fields treated as missing', () => {
    const body: LlmResponse = {
        choices: [{ message: { content: '' } }],
        message: { content: '' },
    };
    assert.equal(extractLlmContent(body), '');
});

ok('shouldUseFetchAttachmentAlias — rename vs generic error', () => {
    // signal-cli reports a missing subcommand specifically
    assert.equal(shouldUseFetchAttachmentAlias('Error: unknown command: getAttachment'), true);
    assert.equal(shouldUseFetchAttachmentAlias("signal-cli: Unrecognized command 'getAttachment'"), true);
    assert.equal(shouldUseFetchAttachmentAlias('not a command: getAttachment'), true);
    assert.equal(shouldUseFetchAttachmentAlias("invalid choice: 'fetchAttachment' (choose from getAttachment, send)"), true);
    // generic failures are not a rename — the original error should surface
    assert.equal(shouldUseFetchAttachmentAlias('Error: attachment not found'), false);
    assert.equal(shouldUseFetchAttachmentAlias('signal-cli exited with code 1: network error'), false);
    assert.equal(shouldUseFetchAttachmentAlias('ENOENT'), false);
    // the 0.14.5 misfire: an *argument* error (not a missing command) must
    // NOT switch the command name
    assert.equal(shouldUseFetchAttachmentAlias('error: unrecognized arguments: -a +12202835135'), false);
    assert.equal(shouldUseFetchAttachmentAlias('Multiple users found, you need to specify an account (phone number) with -a'), false);
});

// ---------------------------------------------------------------------------
// pickAttachmentCommand / detectAttachmentCommand
// Deterministic `--help` probe of the local signal-cli build replaces the
// error-text guessing that misfired on the 0.14.5 install ("invalid choice:
// 'fetchAttachment'" after a real argument error on the first attempt).
// ---------------------------------------------------------------------------
console.log('pickAttachmentCommand — probe result maps to the right command word');
ok('getAttachment --help exits zero → getAttachment', () => {
    assert.equal(pickAttachmentCommand(true), 'getAttachment');
});
ok('getAttachment --help fails → fetchAttachment', () => {
    assert.equal(pickAttachmentCommand(false), 'fetchAttachment');
});
console.log('buildAttachmentAccountArgs — global -a prefix is only present with a bot number');
ok('with a bot number → [\'-a\', number]; without → []', () => {
    assert.deepEqual(buildAttachmentAccountArgs('+12202835135'), ['-a', '+12202835135']);
    assert.deepEqual(buildAttachmentAccountArgs(undefined), []);
});

// ---------------------------------------------------------------------------
// extractAttachmentIds
// Pulls the attachment id(s) out of a dataMessage regardless of which field
// the installed signal-cli version filled: the legacy `attachmentUris`
// (string URI or {id}/{uuid} object) or the modern `attachments` array of
// descriptor objects. This is the bug the production log showed — the data
// message had `attachments`, but the code only read `attachmentUris`.
// ---------------------------------------------------------------------------
console.log('extractAttachmentIds — read both attachment field names');
ok('modern signal-cli `attachments` field with id descriptors', () => {
    const dm: SignalDataMessage = {
        timestamp: '1787624279461',
        message: "What's in this photo?",
        attachments: [
            { id: 'wgqC4jNId3S8Pgg-vDY-.jpg', contentType: 'image/jpeg', size: 871980, width: 1848, height: 4000 },
        ],
    };
    assert.deepEqual(extractAttachmentIds(dm), ['wgqC4jNId3S8Pgg-vDY-.jpg']);
});
ok('legacy `attachmentUris` as plain string URIs', () => {
    assert.deepEqual(extractAttachmentIds({ attachmentUris: ['abc.jpg', 'def.png'] }), ['abc.jpg', 'def.png']);
});
ok('legacy `attachmentUris` with {id} and {uuid} objects', () => {
    assert.deepEqual(extractAttachmentIds({ attachmentUris: [{ id: 'a.jpg' }, { uuid: 'b.jpg' }] }), ['a.jpg', 'b.jpg']);
});
ok('legacy string mix — skips empty entries', () => {
    assert.deepEqual(extractAttachmentIds({ attachmentUris: ['', 'only.jpg', '', {}] }), ['only.jpg']);
});
ok('both fields — attachmentUris (legacy) wins, no dupes of the modern side', () => {
    assert.deepEqual(extractAttachmentIds({
        attachmentUris: ['legacy.jpg'],
        attachments: [{ id: 'modern.jpg' }],
    }), ['legacy.jpg']);
});
ok('absent / empty fields → empty array', () => {
    assert.deepEqual(extractAttachmentIds({}), []);
    assert.deepEqual(extractAttachmentIds({ message: 'just text' }), []);
});

// ---------------------------------------------------------------------------
// buildGetAttachmentArgs
// Builds the signal-cli getAttachment/fetchAttachment argument array. The
// production bug: for 1:1 chats `dataMessage.recipient` is often absent, so an
// empty `--recipient ''` flag was pushed and signal-cli rejected it with
// "Multiple users found, need -a". The account is now pinned with the global
// `-a` prefix (buildAttachmentAccountArgs) and an empty recipient is omitted
// entirely.
// ---------------------------------------------------------------------------
console.log('buildGetAttachmentArgs — flags are well-formed for every recipient shape');
ok('direct message → --recipient <number>', () => {
    assert.deepEqual(
        buildGetAttachmentArgs('a1', '+15551234567', ''),
        ['--id', 'a1', '--recipient', '+15551234567']);
});
ok('group message → -g <groupId>, no --recipient flag at all', () => {
    assert.deepEqual(
        buildGetAttachmentArgs('a2', '', 'GRP=='),
        ['--id', 'a2', '-g', 'GRP==']);
});
ok('group message wins over a stray recipient value', () => {
    assert.deepEqual(
        buildGetAttachmentArgs('a4', '+15551234567', 'GRP=='),
        ['--id', 'a4', '-g', 'GRP==']);
});
ok('empty recipient is omitted — no dangling --recipient flag with no value', () => {
    assert.deepEqual(
        buildGetAttachmentArgs('a3', '', ''),
        ['--id', 'a3']);
});

// ---------------------------------------------------------------------------
// buildSendArgs
// Builds the signal-cli `send` argument array. Groups (trailing `=`, no
// `group:` prefix) get `-g` after the body; direct numbers are the bare
// final argument. `-u <bot>` is the global account pin up front.
// ---------------------------------------------------------------------------
console.log('buildSendArgs — well-formed send lines for every recipient shape');
ok('direct text message', () => {
    assert.deepEqual(
        buildSendArgs('text', 'hello', '+15551234567', '+12202835135'),
        ['-u', '+12202835135', 'send', '-m', 'hello', '+15551234567']);
});
ok('direct attachment', () => {
    assert.deepEqual(
        buildSendArgs('attachment', '/tmp/img.png', '+15551234567', '+12202835135'),
        ['-u', '+12202835135', 'send', '--attachment', '/tmp/img.png', '+15551234567']);
});
ok('group text message → -g after the body, no positional recipient', () => {
    assert.deepEqual(
        buildSendArgs('text', 'hello', 'GROUP1234567890==', '+12202835135'),
        ['-u', '+12202835135', 'send', '-m', 'hello', '-g', 'GROUP1234567890==']);
});
ok('group attachment → -g after the path', () => {
    assert.deepEqual(
        buildSendArgs('attachment', '/tmp/img.png', 'GROUP1234567890==', '+12202835135'),
        ['-u', '+12202835135', 'send', '--attachment', '/tmp/img.png', '-g', 'GROUP1234567890==']);
});

console.log('buildListContactsArgs — profile lookup command is built identically');
ok('output=json + -u and -a global options before the subcommand', () => {
    assert.deepEqual(
        buildListContactsArgs('+12202835135'),
        ['--output=json', '-u', '+12202835135', '-a', '+12202835135', 'listContacts']);
});
ok('different bot numbers produce correctly-shaped args', () => {
    assert.deepEqual(
        buildListContactsArgs('+79990001122'),
        ['--output=json', '-u', '+79990001122', '-a', '+79990001122', 'listContacts']);
});

// ---------------------------------------------------------------------------
// parseReceiveLine
// Parses one line of `signal-cli receive` output. Enqueues only envelopes that
// carry a dataMessage, and returns null (logging the reason) for everything
// else — malformed JSON, an envelope without a dataMessage, an object that
// has no envelope key at all.
// ---------------------------------------------------------------------------
console.log('parseReceiveLine — only real messages are enqueued');
{
    const validLine = JSON.stringify({
        envelope: {
            source: '+15551234567',
            timestamp: '1787624279461',
            dataMessage: { message: 'hi', timestamp: '1787624279461' }
        }
    });
    assert.ok(parseReceiveLine(validLine) !== null, 'valid line yields non-null');
    assert.deepEqual(
        parseReceiveLine(validLine)!.dataMessage?.message,
        'hi');
    assert.equal(parseReceiveLine('{ not json'), null, 'malformed JSON → null');
    assert.equal(parseReceiveLine(JSON.stringify({ envelope: { source: '+1' } })), null, 'envelope without dataMessage → null');
    assert.equal(parseReceiveLine(JSON.stringify({ foo: 'bar' })), null, 'no envelope key → null');
    assert.equal(parseReceiveLine('[]'), null, 'top-level array (not an object) → null');
    assert.equal(parseReceiveLine(''), null, 'empty line → null');
    const noSourceEnvelope = JSON.stringify({
        envelope: { timestamp: '1', dataMessage: { message: 'x' } }
    });
    assert.ok(parseReceiveLine(noSourceEnvelope) !== null, 'envelope with dataMessage but no explicit source — still enqueued (recipient may be absent)');
}

// ---- extractContentAfterBotMention: strip the leading bot name, case-insensitive ----
{
    assert.equal(extractContentAfterBotMention('eddie /version', 'eddie'), '/version', 'plain bot name prefix stripped');
    assert.equal(extractContentAfterBotMention('Eddie help me', 'eddie'), 'help me', 'match is case-insensitive (botName given lowercase)');
    assert.equal(extractContentAfterBotMention('@eddie web get http://x', 'eddie'), 'web get http://x', 'name-after-@ variant stripped');
    assert.equal(extractContentAfterBotMention('unrelated message', 'eddie'), 'unrelated message', 'no bot name → returned trimmed, unchanged');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
