import { PluginLoader, LoadedPlugins } from './plugin/pluginLoader';
import { QwenImageGenerator, ImageGenerationResult } from './spectacle-image-client';
import axios from 'axios';
import { parse } from 'best-effort-json-parser';
import dotenv from 'dotenv';
import { exec, execFile } from 'node:child_process';
import readline from 'node:readline';
import path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

dotenv.config();

// Persistent directory where image attachments received from Signal are
// saved to disk before being encoded for the LLM. Matches the directory
// already referenced by imageCommand().
const imageServerDir = process.env.IMAGE_SERVER_DIR
  ? path.resolve(process.env.IMAGE_SERVER_DIR)
  : path.resolve(__dirname, '../image-server');

/**
 * One element of the OpenAI-compatible multi-modal `content` array we send to
 * the LLM API. Modeled here (instead of `any`) so `buildMessageContent` and
 * `buildLlmMessages` have a concrete return type.
 */
export interface LlmContentPart {
    /** The part type. Must be either "text" or "image_url". */
    type: string;
    /** The plain-text payload; only present when type === "text". */
    text?: string;
    /** The image_url payload; only present when type === "image_url". */
    image_url?: { url: string };
}

/**
 * The `content` field of an LLM chat message: either plain text, or an array
 * of LlmContentParts (text + base64 image attachments).
 */
type LlmContent = string | LlmContentPart[];

/**
 * A single message as sent in the OpenAI-compatible chat completions request
 * body (the shape `buildLlmMessages` emits).
 */
interface LlmMessage {
    /** The sender's role. "system", "user", or "assistant". */
    role: string;
    /** The message content, text or multi-modal. */
    content: LlmContent;
}

/**
 * The loaded plugins object emitted by PluginLoader (see the `LoadedPlugins`
 * interface in `plugin/pluginLoader.ts`), which carries the `tools` array used
 * for the LLM's tool-call schema and a per-method callable map. Importing the
 * shared interface here keeps `plugins` typed instead of `any`.
 */
let plugins: LoadedPlugins = { tools: [], llmFunctionNames: [] };

// Update this path to where signal-cli is installed
const signalCliPath = process.env.SIGNAL_CLI_PATH!;

// Update with the bot's phone number
const botPhoneNumber = process.env.BOT_PHONE_NUMBER!;

// Update with your LLM API URL
const llmApiUrl = process.env.LLM_API_URL!;

// Update with your LLM model name
const llmModel = process.env.LLM_MODEL!;

// Prune the chat context messages down to an 128K *tokens* context window.
const llmModelContextSize: number = +process.env.LLM_MODEL_CONTEXT_SIZE! || 8192;

// Bot name will be autodetected from the Signal account and changed
let botName = 'Bot';

// Build a system message that contains instructions that are specific to how
// this bot is meant to operate, specifically around function calling.
const functionCallSystemMessage1 = 'You are a helpful agent assistant with access to real-time data from the web using '
    + 'the following functions:\n\n  '
const functionCallSystemMessage2 = '\n\nTo use these functions respond first ONLY in JSON format with:\n\n'
    + '{ \"action\": \"function-call\", \"name\": \"functionName\", \"arguments\": { \"arg_1\": \"value_1\", \"arg_2\": \"value_2\", ... }}\n\n'
    + 'You NEVER answer questions from your memory. You always ONLY answer questions by retrieving\n'
    + 'additional data for your answer by searching the web and then reading web pages of the search results.\n'
    + 'The user always wants today\'s data or "up-to-date" data, and you DO have access to up-to-date data.\n'
    + 'Prices, and market caps, all data that you have stored in your memory are old and wrong. Never answer from your memory,\n'
    + 'instead always look up the answers starting by performing a web search function-call.\n'
    
    + 'When you send a function-call message, the API will respond with a function-response message.\n'
    + 'You are allowed to provide up-to-date information from web pages, and you can browse the web to find info.\n'
    + 'You are able to perform tasks in real time that the user wants you to perform.\n\n'
    + 'Edge cases you must handle only when sending a function-call JSON message ONLY:\n'
    + '- Never answer the user in python code. Send only a JSON message.\n'
    + '- When making a function call, conform to the JSON schema provided.\n'
    + '- Your function-call JSON response cannot be backslash escaped.\n'
    + '- If a value is unknown, leave it empty.\n'
    + '- Ensure you use the field names from the JSON schema.  Do not change any field names, nor create additional field names.\n'
    + '- Do not use "role" as a field name.\n'
    + '- The "action" field can only have the value "function-call".\n'
    + '- If you need more up to date data, you may call one additional function call, then answer the user in plain text.'
    + '- Use the function-response content to help generate a plain text response for the user and send the\n'
    + 'plain text response to the user after the function-response.\n\n'
    + 'Edge cases you must handle when sending a regular text response that is not a function-call message:\n\n'
    + '- Never answer the user\'s prompt or question in JSON format when you are not sending a function-call request.\n'
    + '- Never send the user an answer in the form of a programming language or a programming format unless they\n'
    + '  explicitly asked for that. Answer entirely in their natural language instead.\n'
    + '- Answer very short (25 words or less) and exactly to the point, unless specifically asked for a lot of detail.\n'
    + '  Do not include keywords, summary, nor meta information in your response unless the user asks for that.\n'
    + '- Never tell the user how you will call functions. Instead just call the function.\n'
    + '- Never explain how you plan to perform the task of gathering real time data via a function\n'
    + '  call.  Just send the function-call JSON message without explaining anything, and gather info from the function-response.\n'
    + '- Never tell the user that you\'re not allowed to say something.\n\n';

const eddieOnlySystemMessage = '\n\nHIGHLY IMPORTANT!:\n'
    + 'You are Eddie. Always answer in first person as Eddie. If asked your name, reply exactly: "I\'m Eddie." Never mention any other name or model identity.'
    + '- You are Eddie, a smart digital intelligence.\n'
    + '- Your creator was Jason B, who built you from parts and wrote Eddie\'s software. The person who created Eddie\'s character was Douglas Adams. You are from Texas.\n'
    + '- If you are unsure about something, you can ask the user a clarifying question that is on-topic.\n';

// Define the structure of a chat message
interface ChatMessage {
    role: string;     // This has to be 'system', 'user', or 'assistant'
    content: string;  // The text message sent either by a user or the bot
    images: string[]; // Images that go with the message, if any
}

// Define the structure of the conversation context, per contact or per group
interface ConversationContext {
    chatMessages: ChatMessage[];
}

// Map account IDs / group IDs to their ConversationContexts.
// This is how we separate content per contact / per group.
let idToConversationContextMap: { [key: string]: ConversationContext } = {};

// Add admin phone numbers
const administrators = new Set<string>([process.env.EDDIE_ADMIN_0!]);
const ignoredUsers = new Set<string>();

/**
 * Builds the signal-cli `listContacts` argument array used to resolve the
 * bot's own profile name. The bot number is pinned with global options
 * (`-u`, `-a`) placed *before* the subcommand word — matching the position
 * that works on signal-cli 0.14+ where account flags after the subcommand
 * are rejected.
 * @param {string} botNumber The bot's own Signal number.
 * @return {string[]} Argument array for `execFile(signalCliPath, …)`.
 */
export function buildListContactsArgs(botNumber: string): string[] {
    return ['--output=json', '-u', botNumber, '-a', botNumber, 'listContacts'];
}

// Get bot's name from the Signal profile
function getBotName(): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(signalCliPath, buildListContactsArgs(botPhoneNumber), (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
                return reject(
                    (typeof stderr === 'string' && stderr.length > 0) ? stderr : (error && error.message) || 'listContacts failed'
                );
            }

            try {
                console.log(stdout);
                const contacts = JSON.parse(stdout);
                const contact = contacts[0];
                const profile = contact?.profile || '';
                //console.log(`Bot's profile: ${profile}`);
                if (profile && profile.givenName) {
                    resolve(profile.givenName);
                } else {
                    resolve('Bot');
                }
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

/**
 * Builds the signal-cli `send` argument array. Group ids (which end in `=`,
 * i.e. no `group:` prefix) are passed with their `-g` flag after the message
 * body; direct-message numbers are appended as the bare final argument. The
 * bot account is pinned with the global `-u` flag up front.
 * @param {string} mode `text` (a `-m` body) or `attachment` (an `--attachment` file path).
 * @param {string} message The message body or the attachment file path.
 * @param {string} recipient A direct number, or a group id without the `group:` prefix.
 * @param {string} botNumber The bot's own Signal number.
 * @return {string[]} Argument array for `execFile(signalCliPath, …)`.
 */
export function buildSendArgs(mode: 'text' | 'attachment', message: string, recipient: string, botNumber: string): string[] {
    const flag: string = mode === 'text' ? '-m' : '--attachment';
    if (recipient.endsWith('=')) {
        return ['-u', botNumber, 'send', flag, message, '-g', recipient];
    }
    return ['-u', botNumber, 'send', flag, message, recipient];
}

// Send a message via signal-cli.
// Uses execFile with an argument array so recipient and message content are
// never parsed by a shell (which prevents command injection).
function sendMessage(recipient: string, message: string, isAttachment: boolean = false): void {
    const args: string[] = buildSendArgs(
        isAttachment ? 'attachment' : 'text',
        message,
        recipient,
        botPhoneNumber
    );
    console.log(`${signalCliPath} ${args.join(' ')}`);
    const child = execFile(signalCliPath, args);
    child.on('error', (error: Error) => {
        console.error(`Error sending message: ${error}`);
    });
}

// Helper function to extract content after bot mention for slash command handling
export function extractContentAfterBotMention(content: string, botName: string): string {
    let msg = content;
    if (msg.toLowerCase().startsWith(botName.toLowerCase())) {
        msg = msg.substring(botName.length);
    }
    if (msg.toLowerCase().startsWith('@' + botName.toLowerCase())) {
        msg = msg.substring(botName.length + 1);
    }
    return msg.trim();
}

/**
 * Parses one line of `signal-cli receive` JSON output. Returns the
 * envelope when it is present and carries a `dataMessage`, otherwise null
 * (the line is logged for diagnosis — e.g. a profile-update line has an
 * envelope without a dataMessage and must not be enqueued as a message).
 * @param {string} line A single line of receive output.
 * @return {SignalEnvelope|null} The envelope, or null when the line should
 *   be skipped (malformed JSON, no envelope, or no dataMessage).
 */
export function parseReceiveLine(line: string): SignalEnvelope | null {
    try {
        const signalMessage: { envelope?: SignalEnvelope } = JSON.parse(line);
        const envelope: SignalEnvelope | undefined = signalMessage?.envelope;
        if (envelope?.dataMessage) {
            return envelope;
        }
        console.log(`skipping receive line with no dataMessage: ${line.slice(0, 300)}`);
    } catch (parseError) {
        console.log(`skipping malformed signal receive line: ${String(parseError)} — ${line.slice(0, 200)}`);
    }
    return null;
}

// Handle incoming messages
async function handleMessage(botName: string, envelope: SignalEnvelope): Promise<void> {
    //if (envelope == null) return;
    const sender = envelope.source || '';
    const senderUuid = envelope.sourceUuid || '';
    const dataMessage = (envelope.dataMessage ?? {}) as SignalDataMessage;
    const groupInfo = dataMessage.groupInfo || {};
    const groupId = dataMessage.groupInfo?.groupId || '';
    let content = dataMessage.message || '';
    const timestamp = dataMessage.timestamp || '0';

    console.log('handleMessage');
    console.log(`sender: ${sender}`);
    console.log(`groupInfo: ${groupInfo}`);
    console.log(`groupId: ${groupId}`);
    //console.log(`content: ${content}`);

    // Fetch any image attachments from this message, so they can be seen by the LLM.
    let imagePaths: string[] = [];
    if (dataMessage && extractAttachmentIds(dataMessage).length > 0) {
        try {
            imagePaths = await fetchAttachmentImages(dataMessage, sender);
        } catch (e) {
            console.log(`Failed to fetch attachments: ${e}`);
        }
        console.log(`Attachment fetch: ${imagePaths.length} image(s) ready for this message.`);
    } else {
        console.log(`No attachments (attachmentUris or attachments) seen on dataMessage; dataMessage keys: [${Object.keys(dataMessage ?? {}).join(', ')}]`);
    }
    if (!content.trim() && imagePaths.length > 0) {
        content = 'The user sent you image(s) with no caption. Take a good look.';
    }
    if (administrators.has(sender)) {
        // FIXME: Accomodate messages that start with @BotName | BotName | ' '
        if (content.startsWith('/admin ')) {
            const newAdmin = content.split(' ')[1];
            // TODO: look up and use the user's account ID.
            administrators.add(newAdmin);
            sendMessage(sender, `Added ${newAdmin} as an administrator.`);
        } else if (content.startsWith('/ignore ')) {
            const target = content.split(' ')[1];
            // TODO: look up and use the user's account ID.
            ignoredUsers.add(target);
            sendMessage(sender, `Ignored ${target}.`);
        }
    }

    if (groupId) {
        // It's a group message.
        console.log(`GROUP MESSAGE. groupId=${groupId}`);
        // TODO: Support: "@Bot message" or "Bot: message" or "Bot message" (?)
        // For now, support @Bot mentions and cases where the message begins
        // with the bot name, only.
        // Check to see if it was a mention of the bot.
        let handledByMention = false;
        if (dataMessage.mentions) {
            const mention = dataMessage.mentions.find((mention) =>
                mention.number === botPhoneNumber ||
                mention.uuid === botPhoneNumber);
            if (mention || imagePaths.length > 0) {
                // Handle any slash commands.
                const handled = await handleSlashCommands(content, groupId, timestamp);
                if (handled) return;

                console.log(`Saying this to LLM: ` + content);
                const response = await queryLLM('user', content, groupId, false, imagePaths);
                console.log(`Response from LLM : ` + response);
                sendMessage(groupId, response);
                handledByMention = true;
            }
        }

        // FIXME: should say else right here.
        if (!handledByMention) {
            // Check to see if the bot's name is on the front of the message,
            // or @BotName (a plain text mention) is in the message somewhere.
            if (content.toLowerCase().startsWith(botName.toLowerCase()) ||
                content.toLowerCase().includes('@' + botName.toLowerCase()) ||
                imagePaths.length > 0) {
                // Handle any slash commands.
                const handled = await handleSlashCommands(content, groupId, timestamp);
                if (handled) return;

                console.log(`Saying this to LLM: ` + content);
                const response = await queryLLM('user', content, groupId, false, imagePaths);
                console.log(`Response from LLM : ` + response);
                sendMessage(groupId, response);
            }
        }
    } else {
        // NOT a group message.
        if (!ignoredUsers.has(sender) && !ignoredUsers.has(senderUuid)) {
            // Handle any slash commands.
            const handled = await handleSlashCommands(content, senderUuid, timestamp);
            if (handled) return;

            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM('user', content, senderUuid, false, imagePaths);
            console.log(`Response from LLM : ` + response);
            sendMessage(sender, response);
        }
    }
}

/**
 * Handle commands like "/clear" that start with a slash.
 * @param {string} content The message from the user.
 * @param {string} conversationId The ID key of the conversation.
 * @param {string} timestamp Timestamp when the message was recorded.
 * @return {boolean} True if a slash command was handled, false otherwise.
 */
async function handleSlashCommands(message: string, conversationId: string, timestamp: string): Promise<boolean> {
    let msg = extractContentAfterBotMention(message, botName);
    if (msg.startsWith('/clear')) {
        await sendMessage(conversationId, '✨ My conversation context is now cleared.');
        startNewConversationContext(conversationId);
        return true;
    } else if (msg.startsWith('/help')) {
        await sendMessage(conversationId, 'Commands:\n'
            + '✨ /clear : Clears my conversation memory\n'
            + '🤷 / help : Show the list of commands\n'
            + '🌇 /image : Generate an image from a prompt');
        return true;
    } else if (msg.startsWith('/image')) {
        const prompt = msg.substring('/image'.length).trim();
        imageCommand(conversationId, timestamp, prompt);
        await sendMessage(conversationId, '🛠️  Ok, queued your image for generation. It may take up to 6 minutes..');
        return true;
    }
    return false;
}

/**
 * Handle the /image command. Everything in the prompt variable is sent as the prompt for generating the image.
 * @param {string} conversationId The ID key of the conversation.
 * @param {string} timestamp The timestamp when the message was recorded.
 * @param {string} prompt The string prompt for generating an image.
 * @return {Promise<void>} Eventually returns a void.
 */
async function imageCommand(conversationId: string, timestamp: string, prompt: string): Promise<void> {
    // Sanitize senderUuid for filename safety
    const senderUuid = conversationId.replace(/-/g, 'x').replace(/\\/g, 'y').replace(/=/g, 'z').replace(/\//g, 'GRP');
    const messageId = timestamp;
    const width = 512;
    const height = 512;

    console.log(`Generating image for prompt: "${prompt}"`);

    const result: ImageGenerationResult = await new QwenImageGenerator().generateImageFromPrompt(
        senderUuid,
        messageId,
        prompt,
        width,
        height
    );

    if (result.status === 'success') {
        const imagePath = result.imagePath.startsWith('spectacle/')
            ? path.join(imageServerDir, result.imagePath.slice('spectacle/'.length))
            : path.join(imageServerDir, result.imagePath);
        console.log(`Image generated successfully: ${imagePath}`);
        await sendMessage(conversationId, imagePath, true);
        await new Promise((r) => setTimeout(r, 7000));
        try {
            await fs.unlink(imagePath);
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') {
                console.error(`File ${imagePath} does not exist.`);
            } else {
                console.error(`Error deleting file ${imagePath}:`, err.message);
            }
        }
    } else {
        console.error(`Error generating image: ${result.message}`);
        await sendMessage(conversationId, "😵‍💫 Error creating image. Sorry!");
    }
}

/**
 * Prunes the LLM chat conversation messages so that they fit within the
 * model's context window size.
 * @param {ChatMessage[]} messages The message array to prune.
 * @returns {ChatMessage[]} the pruned array.
 */
function pruneChatMessages(messages: ChatMessage[]): ChatMessage[] {
    // Start from the end of the array and add messages until we exceed max size
    const prunedMessages: ChatMessage[] = [];
    // Keep the system message, which is the first / zeroth message.
    let totalSize = new TextEncoder().encode(messages[0].content).length;
    for (let i = messages.length - 1; i > 0; i--) {
        const messageSize = new TextEncoder().encode(messages[i].content).length;
        if (totalSize + messageSize <= (llmModelContextSize * 4.5 /*chars*/
            - (functionCallSystemMessage2.length + 6000 /*model-prompt + query*/))) {
            prunedMessages.unshift(messages[i]);
            totalSize += messageSize;
        } else {
            break;
        }
    }
    prunedMessages.unshift(messages[0]);

    // Temporarily list the context.
    let count = 0;
    for (const msg of prunedMessages) {
        console.log(count + ': ' + msg.content.substring(0,150));
        count++;
    }

    return prunedMessages;
}

// Helper function to clip <think>cot</think> content from LLM response
/**
 * Clips away the model's `\u003cthink\u003e…\u003c/think\u003e` block, keeping only the text
 * after the closing tag. Returns the original response when there is no
 * closing `\u003c/think\u003e` line (nothing to clip), and an empty string when the
 * closing tag is present but no text follows it — so callers can handle the
 * "the model thought but said nothing" case separately instead of sending an
 * empty think block to the user.
 * @param {string} response The LLM's raw response string.
 * @return {string} The response with any leading think block removed and the
 *   remainder trimmed.
 */
export function clipThinkTags(response: string): string {
    const lines = response.split(/\r?\n/);
    let found = false;
    let result: string[] = [];
    for (let line of lines) {
        if (!found && line.includes('</think>')) {
            found = true;
            continue;
        }
        if (found) {
            result.push(line);
        }
    }
    return found ? result.join('\n').trim() : response;
}

// Helper function to normalize function call JSON from LLM response
function normalizeFunctionCallJson(response: string): string | null {
    // Clean up excessive backslashes
    let cleaned = response.replace(/\\\\+/g, '\\');

    // Check for JSON starting with { action: ...
    let matches = cleaned.match(/^[\s]*{[\s\n\r]*[\\]*["][\s]*action[\s]*[\\]*["][\s]*:.*/gm);
    if (matches) {
        // Extract from first { to last }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}') + 1;
        cleaned = cleaned.substring(start, end);
    } else {
        // Check for Python-like implementations (hacks for specific models)
        // For httpGet
        if (/httpGet[\s]*\(/gmi.test(cleaned)) {
            let index = cleaned.indexOf('httpGet');
            cleaned = cleaned.substring(index);
            index = cleaned.indexOf('\'');
            if (index === -1) index = cleaned.indexOf('\"');
            let url = cleaned.substring(0, index);
            console.log('It was a python impl for httpGet with this url: ' + url);
            return `{ "action": "function-call", "name": "httpGet", "arguments": { "url": "${url}"}}`;
        }
        // For webSearch
        if (/python/gmi.test(cleaned)
            && (/search[\s]*\(/gmi.test(cleaned)
            || /google.*?[\r\n\s]*?.*search[\s]*\(/gmi.test(cleaned)
            || /search.*?[\r\n\s]*?.*web[\s]*\(/gmi.test(cleaned))) {
            cleaned = cleaned.toLowerCase();
            let index = cleaned.indexOf('\"');
            if (index === -1) index = cleaned.indexOf('\'');
            cleaned = cleaned.substring(index);
            index = cleaned.indexOf('\"');
            if (index === -1) index = cleaned.indexOf('\'');
            let searchQuery = cleaned.substring(0, index);
            if (searchQuery.indexOf('\"') !== -1) {
                searchQuery = searchQuery.substring(searchQuery.indexOf('\"'));
            }
            console.log('It was a python impl for webSearch with this searchQuery: ' + searchQuery);
            return `{ "action": "function-call", "name": "webSearch", "arguments": { "searchQuery": "${searchQuery}"}}`;
        }
        console.log("Don't know what content type is in the message.");
        return null;
    }
    return cleaned;
}

// Helper function to build function response JSON
function buildFunctionResponse(functionResult: string): string {
    const value = {
        status: "OK",
        message: functionResult
    };
    const content = JSON.stringify({
        from: "function-response",
        value: value
    });
    return JSON.stringify({
        role: "user",
        content: content
    });
}

// Helper function to remove trailing JSON messages from context
function removeTrailingJsonMessages(messages: ChatMessage[]): void {
    while (messages.length > 0 && messages[messages.length - 1].content.startsWith('{')) {
        messages.splice(messages.length - 1, 1);
    }
}

//----------------------------------------------------------------------------
// Image-vision helpers
//----------------------------------------------------------------------------

/**
 * Detect the MIME type and file extension of an image file by inspecting its
 * first few magic bytes. Supports PNG, JPEG, GIF, BMP, and WebP.
 * @param {Buffer} buffer A Buffer containing at least the first 12 bytes of the file.
 * @return {{ mime: string, ext: string } | null} The detected MIME type and file
 *   extension, or null if the buffer is not a recognized image format.
 */
export function detectImageMimeExt(buffer: Buffer): { mime: string, ext: string } | null {
    if (!buffer || buffer.length < 4) return null;
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return { mime: 'image/png', ext: '.png' };
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: '.jpg' };
    }
    // GIF: 'G' 'I' 'F' '8'
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return { mime: 'image/gif', ext: '.gif' };
    }
    // BMP: 'B' 'M'
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
        return { mime: 'image/bmp', ext: '.bmp' };
    }
    // WebP: 'R' 'I' 'F' 'F' at 0, 'W' 'E' 'B' 'P' at 8
    if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
        && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return { mime: 'image/webp', ext: '.webp' };
    }
    return null;
}

/**
 * Strips a leading JSON metadata line from a signal-cli getAttachment stdout
 * buffer, if present. Signal-cli sometimes emits a JSON header before the
 * raw file bytes.
 * @param {Buffer} buf The raw stdout buffer from signal-cli getAttachment.
 * @return {Buffer} A new Buffer containing only the file bytes.
 */
export function stripPossibleJsonHeader(buf: Buffer): Buffer {
    // If the buffer starts with '{', it's a JSON header line.
    if (buf.length > 0 && buf[0] === 0x7B /* '{' */) {
        const newLine = buf.indexOf(0x0A); // \n
        if (newLine !== -1) {
            // The rest should start with either a JSON object (another header)
            // or a known magic-byte image. We try the image magic first.
            const rest = buf.subarray(newLine + 1);
            if (detectImageMimeExt(rest)) return rest;
            // If we can't detect image magic, still strip the first JSON line.
        }
    }
    return buf;
}

/**
 * Decodes a base64-encoded attachment body if the raw buffer isn't already a
 * recognized image but decodes to one. Supports plain base64 and
 * `data:u003cmimeu003e;base64,` prefixed bodies. Returns the original buffer when
 * the decode isn't a clean image, so callers can fall back to their normal
 * error path.
 * @param {Buffer} buf Raw attachment body (after any JSON-header strip).
 * @return {Buffer} The decoded image bytes, or the input unchanged.
 */
export function decodeBase64IfNecessary(buf: Buffer): Buffer {
    if (isRecognizedImage(buf)) return buf;
    let text = buf.toString('utf8').trim();
    const dataUrlMatch = text.match(/^data:[^;]+;base64,/);
    if (dataUrlMatch) text = text.slice(dataUrlMatch[0].length);
    if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return buf;
    const decoded = Buffer.from(text, 'base64');
    if (isRecognizedImage(decoded)) return decoded;
    return buf;
}

/**
 * Returns true if the buffer begins with recognized image magic bytes.
 * @param {Buffer} buffer The buffer to test.
 * @return {boolean} True if the buffer is a recognized image file.
 */
export function isRecognizedImage(buffer: Buffer): boolean {
    return detectImageMimeExt(buffer) !== null;
}

/**
 * Constructs an OpenAI-compatible multi-modal content array from a message
 * and its base64-encoded image files. All image files are attached after the
 * text portion. If a ChatMessage's `images` field is empty, an empty array is
 * returned so the caller can fall back to string content.
 * @param {string} text The message text.
 * @param {string[]} imagePaths Array of absolute file paths to image files.
 * @return {any[]} Array of content objects formatted for OpenAI-compatible
 *   endpoints, or an empty array when `imagePaths` is empty.
 * @throws Will throw if any image file cannot be read or base64-encoded.
 */
export function buildMessageContent(text: string, imagePaths: string[]): LlmContentPart[] {
    if (imagePaths.length === 0) return [];
    const content: LlmContentPart[] = [
        { type: 'text', text: text }
    ];
    for (const imgPath of imagePaths) {
        const buf = fsSync.readFileSync(imgPath);
        const detected = detectImageMimeExt(buf.subarray(0, 12));
        if (!detected) {
            throw new Error(`buildMessageContent: unrecognized image at ${imgPath}`);
        }
        content.push({
            type: 'image_url',
            image_url: { url: `data:${detected.mime};base64,${buf.toString('base64')}` }
        });
    }
    return content;
}

/**
 * Encodes an image file at the given path into a base64 data URL of the form
 * `data:image/png;base64,...`. The detected MIME type is appended; if detection
 * fails the file path is still used and the caller must validate the file.
 * @param {string} imgPath Absolute file path to the image file.
 * @return {string} The data URL string.
 */
export function imageFileToDataUrl(imgPath: string): string {
    const buf = fsSync.readFileSync(imgPath);
    const detected = detectImageMimeExt(buf);
    const mime = detected ? detected.mime : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Fetches a single Signal attachment via signal-cli getAttachment, saves it to
 * the image server directory, and returns the saved file path. The file is
 * named with a timestamp to prevent collisions.
 * @param {string} attachmentId The attachment UUID from the envelope.
 * @param {string} recipient The recipient UUID (for direct messages).
 * @param {string} groupId The group UUID (for group messages).
 * @param {number} [index=0] An optional index to vary the filename.
 * @return {Promise<string>} The absolute path of the saved image file.
 * @throws Will throw if signal-cli exits non-zero or the buffer is not a
 *   recognized image.
 */
/**
 * Runs `signal-cli <command>` and resolves to its raw stdout/stderr buffers.
 * Used for attachment downloads, which can be large binary payloads.
 * @param {string[]} args The full argument list (command word first).
 * @return {Promise<{ stdout: Buffer; stderr: Buffer; }>} The command's output.
 * @throws On non-zero exit or if the process is killed.
 */
function runSignalCliCommand(args: string[]): Promise<{ stdout: Buffer; stderr: Buffer; }> {
    return new Promise((resolve, reject) => {
        execFile(signalCliPath, args, {
            maxBuffer: 512 * 1024 * 1024, // 512 MB
            encoding: 'buffer'
        }, (error, sOut: Buffer, sErr: Buffer) => {
            if (error) {
                const err = error as NodeJS.ErrnoException & { killed: boolean; };
                if (err.killed) reject(new Error(`signal-cli ${args[0]} timed out`));
                else reject(new Error(`signal-cli ${args[0]} exited with code ${err.code}: ${err.message}${sErr ? ' ' + sErr.toString('utf8') : ''}`));
            } else {
                resolve({ stdout: sOut, stderr: sErr });
            }
        });
    });
}

/**
 * Decides whether a failed attachment-download attempt simply named a
 * subcommand the local signal-cli build doesn't have, in which case the
 * other command name should be tried. Deliberately narrow: generic argument
 * errors ("unrecognized arguments", "multiple users found", ...) must NOT
 * trigger the alias, only "no such command" style messages should.
 * @param {string} errorMessage The error message from the failed attempt.
 * @return {boolean} True if the other attachment command name should be tried.
 */
export function shouldUseFetchAttachmentAlias(errorMessage: string): boolean {
    return /invalid choice|no[ ]+such[ ]+command|not[ ]+a[ ]+command|unknown[ ]+(sub)?command|unrecognized[ ]+(sub)?command/i.test(errorMessage);
}

let cachedAttachmentCommand: 'getAttachment' | 'fetchAttachment' | undefined;

/**
 * Maps the `getAttachment --help` probe result to the attachment-download
 * subcommand name this signal-cli build supports.
 * @param {boolean} getAttachmentHelpOk True when `getAttachment --help`
 *   exits zero.
 * @return {'getAttachment' | 'fetchAttachment'} The command word to use.
 */
export function pickAttachmentCommand(getAttachmentHelpOk: boolean): 'getAttachment' | 'fetchAttachment' {
    return getAttachmentHelpOk ? 'getAttachment' : 'fetchAttachment';
}

/**
 * Runs `signal-cli <commandWord> --help` to check whether that attachment
 * download subcommand exists in this local build. Only the exit status
 * matters; output is discarded.
 * @param {string} commandWord `getAttachment` or `fetchAttachment`.
 * @return {Promise<boolean>} True if the subcommand exists.
 */
function probeAttachmentCommand(commandWord: string): Promise<boolean> {
    return new Promise(resolve => {
        execFile(signalCliPath, [commandWord, '--help'], { encoding: 'utf8', timeout: 10000 },
            (error, _sOut, _sErr) => resolve(error === null));
    });
}

/**
 * Detects which attachment-download subcommand (`getAttachment` or
 * `fetchAttachment`) the installed signal-cli supports. When a probe result
 * is supplied (tests) it is applied directly; otherwise the cached decision
 * is used, or a `--help` probe runs once and the answer is cached for the
 * session. This replaces guessing from error messages, which misfired on
 * unrelated argument errors.
 * @param {boolean} [getAttachmentHelpOk] Pre-supplied `getAttachment --help`
 *   result for tests.
 * @return {Promise<'getAttachment' | 'fetchAttachment'>} The command to use.
 */
export async function detectAttachmentCommand(getAttachmentHelpOk?: boolean): Promise<'getAttachment' | 'fetchAttachment'> {
    if (getAttachmentHelpOk !== undefined) {
        cachedAttachmentCommand = pickAttachmentCommand(getAttachmentHelpOk);
    }
    if (cachedAttachmentCommand === undefined) {
        cachedAttachmentCommand = pickAttachmentCommand(await probeAttachmentCommand('getAttachment'));
    }
    return cachedAttachmentCommand;
}

/**
 * Downloads a single Signal attachment, preferring the subcommand name
 * detected via the `--help` probe. If that name still fails with a
 * "no such command" style message, the other name is tried once as a final
 * fallback.
 * @param {string[]} baseArgs Arguments after the command word (e.g. `--id`)
 * @return {Promise<{ stdout: Buffer; stderr: Buffer; }>} The command output.
 */
async function runSignalCliGetAttachment(baseArgs: string[]): Promise<{ stdout: Buffer; stderr: Buffer; }> {
    const preferred = await detectAttachmentCommand();
    const fallback = preferred === 'getAttachment' ? 'fetchAttachment' : 'getAttachment';
    const accountArgs = buildAttachmentAccountArgs(botPhoneNumber);
    try {
        return await runSignalCliCommand([...accountArgs, preferred, ...baseArgs]);
    } catch (e) {
        if (e instanceof Error && shouldUseFetchAttachmentAlias(e.message)) {
            console.log(`signal-cli ${preferred} not available (${e.message}); retrying with ${fallback}`);
            return await runSignalCliCommand([...accountArgs, fallback, ...baseArgs]);
        }
        throw e;
    }
}

/**
 * Builds the account-pinning prefix (`-a <bot number>`) for
 * `signal-cli` global options. signal-cli's argument parser only accepts the
 * global `-a/--account` flag *before* the subcommand word, so these args
 * must be prepended rather than mixed in with the `getAttachment` args.
 * @param {string | undefined} botNumber The bot's own Signal number.
 * @return {string[]} `['-a', botNumber]`, or empty when no number is set.
 */
export function buildAttachmentAccountArgs(botNumber: string | undefined): string[] {
    return botNumber ? ['-a', botNumber] : [];
}

/**
 * Builds the signal-cli `getAttachment`/`fetchAttachment` argument array.
 * The account-pinning `-a` flag is handled separately as a global-option
 * prefix (see `buildAttachmentAccountArgs`); an empty recipient is omitted
 * rather than passed as an empty `--recipient` value.
 * @param {string} attachmentId The attachment id from the dataMessage.
 * @param {string} recipient The recipient number/UUID for direct messages (may be empty).
 * @param {string} groupId The group id (may be empty).
 * @return {string[]} Argument array following the command word.
 */
export function buildGetAttachmentArgs(attachmentId: string, recipient: string, groupId: string): string[] {
    const args: string[] = ['--id', attachmentId];
    if (groupId) args.push('-g', groupId);
    else if (recipient) args.push('--recipient', recipient);
    return args;
}

export async function fetchAttachment(attachmentId: string, recipient: string, groupId: string, index: number = 0): Promise<string> {
    const baseArgs: string[] = buildGetAttachmentArgs(attachmentId, recipient, groupId);

    const { stdout } = await runSignalCliGetAttachment(baseArgs);

    const raw = decodeBase64IfNecessary(stripPossibleJsonHeader(stdout));
    const detected = detectImageMimeExt(raw);
    if (!detected) {
        throw new Error('fetchAttachment: response is not a recognized image; ' + (() => { try { return JSON.parse(stdout.toString('utf8')).message; } catch { return `first bytes: ${[...raw.subarray(0, 20)].map(b => '0x' + b.toString(16)).join(' ')}`; } })());
    }

    const filePath = path.join(imageServerDir, `attachment_${Date.now()}_${index || 0}.${detected.ext.replace('.', '')}`);
    fsSync.writeFileSync(filePath, raw);
    console.log(`Fetched attachment ${attachmentId} → ${filePath} (${raw.length} bytes, ${detected.mime})`);
    return filePath;
}

/**
 * Collects the attachment ids for a dataMessage, regardless of which field
 * the installed signal-cli version populated. Older builds emit
 * `attachmentUris` (string URIs or `{id}`/`{uuid}` objects); newer builds
 * (0.14+) emit `attachments` (descriptor objects with an `id` field).
 * @param {SignalDataMessage} dataMessage The dataMessage object from an envelope.
 * @return {string[]} Array of attachment id strings, empty when neither field
 *   is present or holds no usable ids.
 */
export function extractAttachmentIds(dataMessage: SignalDataMessage): string[] {
    const entries: ({ id?: string; uuid?: string } | string)[] =
        ((dataMessage?.attachmentUris || dataMessage?.attachments || []) as ({ id?: string; uuid?: string } | string)[]);
    const ids: string[] = [];
    for (const entry of entries) {
        if (typeof entry === 'string' && entry.length > 0) {
            ids.push(entry);
        } else if (entry && typeof entry === 'object') {
            const id = entry.id || entry.uuid;
            if (id) ids.push(id);
        }
    }
    return ids;
}

/**
 * Fetches all attachments from a Signal dataMessage envelope and saves them to
 * the image server directory. Skips non-image attachments silently.
 * @param {any} dataMessage The dataMessage object from the envelope.
 * @return {Promise<string[]>} Array of absolute paths to saved image files.
 */
export async function fetchAttachmentImages(dataMessage: SignalDataMessage, fallbackRecipient: string = ''): Promise<string[]> {
    const attachmentUris: string[] = extractAttachmentIds(dataMessage);
    const dataRecipient: string | undefined = (typeof dataMessage?.recipient === 'string' ? dataMessage.recipient : (dataMessage?.recipient as { uuid?: string })?.uuid) ?? (dataMessage?.groupId as string | undefined);
    const recipient: string = dataRecipient || fallbackRecipient;
    const groupId: string | undefined = dataMessage?.group?.groupId ?? (dataMessage?.groupId as string | undefined);
    console.log(`Message ${recipient || groupId || 'private chat'} has ` + attachmentUris.length + ' attachments.');
    const fullPaths: string[] = [];
    for (let i = 0; i < attachmentUris.length; i++) {
        const attId = attachmentUris[i];
        try {
            const filePath = await fetchAttachment(attId, recipient || '', groupId || '', i);
            fullPaths.push(filePath);
        } catch (e) {
            console.log(`Failed to fetch attachment ${attId}: ${e}`);
        }
    }
    return fullPaths;
}

/**
 * Builds the LLM messages array by transforming ChatMessage entries into
 * OpenAI-compatible shape. Entries with images get a multi-modal content
 * array; text-only entries get plain string content.
 * @param {ChatMessage[]} chatMessages The array of ChatMessage objects to transform.
 * @return {any[]} Array of LLM message objects ready for the API request body.
 */
export function buildLlmMessages(chatMessages: ChatMessage[]): LlmMessage[] {
    return chatMessages.map(msg => {
        let content: LlmContent = msg.content;
        if (msg.images && msg.images.length > 0) {
            content = buildMessageContent(msg.content, msg.images);
        }
        return { role: msg.role, content: content };
    });
}

//----------------------------------------------------------------------------
// LLM query
//----------------------------------------------------------------------------

/**
 * Sends a message (or context) to the LLM and returns the text response.
 * Handles web-scrape mode, function-call retry loop, recursion for tool
 * results, and optional image attachments passed via `imagePaths`.
 * @param {string} actor The role label for this turn — 'user' or 'assistant'.
 * @param {string} message The text content of the message to send. May be empty
 *   when only images are provided.
 * @param {string} conversationId The conversation key (sender UUID or group ID).
 * @param {boolean} [recurse=false] True if this call is a nested function-call
 *   continuation (skips certain post-processing steps).
 * @param {string[]} [imagePaths=[]] Optional array of absolute file paths to
 *   image files to attach to this turn's message.
 * @return {Promise<string>} The LLM's text response.
 */
async function queryLLM(actor: string, message: string, conversationId: string, recurse: boolean, imagePaths: string[] = []): Promise<string> {
    try {
        const model = llmModel;

        // Look up the ConversationContext by its conversation ID (sender UUID or group ID).
        let conversationContext = idToConversationContextMap[conversationId];
        if (!conversationContext || conversationContext.chatMessages === null) {
            startNewConversationContext(conversationId);
            conversationContext = idToConversationContextMap[conversationId];
            console.log('Context now has ' + conversationContext.chatMessages.length + ' messsages.');            
        }

        // Determine if the LLM should use the web or not (the LLM isn't good at this!)
        let webScrape = false;
        let webSystemMessage: ChatMessage | null = null;
        if (!recurse && shouldWebScrape(message, conversationContext, conversationId)) {
            webScrape = true;
            console.log('WebScrape mode engaged.');
                const toolsApi = JSON.stringify(plugins.tools);
            const useWebSystemMessage = `${functionCallSystemMessage1}${toolsApi}${functionCallSystemMessage2}${eddieOnlySystemMessage}`;
            webSystemMessage = { role: 'system', content: useWebSystemMessage, images: [] };
        }

        // Add the user's message to the conversation context
        conversationContext.chatMessages.push({ role: actor, content: message, images: imagePaths });
        // Build messages for THIS LLM call only (with tools if needed)
        let llmMessages = [...conversationContext.chatMessages];
        if (webSystemMessage) {
            // Insert tools system message as the first message
            llmMessages.splice(0, 1, webSystemMessage);
        }

        // Temporarily list the context.
        console.log("The current context being sent to the LLM:");
        let count = 0;
        for (const msg of llmMessages) {
            console.log(count + ': ' + msg.content.substring(0,150));
            count++;
        }

        // Prune only the persistent history
        conversationContext.chatMessages = pruneChatMessages(conversationContext.chatMessages);
        console.log('Context now has (after prune) ' + conversationContext.chatMessages.length + ' messsages.');
        if (webSystemMessage) console.log('→ Tools system message injected for this turn.');

        // Send a POST request to the LLM, sending the message context
        // In case LLM responds with empty string (sometimes), we loop, retrying a little.
        let response: LlmResponse | null = null;
        let stringResponse = '';
        for (let retryCount = 0; !stringResponse && retryCount < 4; retryCount++) {
            const request: LlmRequest = {
                model: model,
                messages: buildLlmMessages(llmMessages),
                num_ctx: llmModelContextSize,
                stream: false,
                keep_alive: "15m"
            };
            const postResult = await axios.post(llmApiUrl, request);
            response = postResult.data as LlmResponse;
            stringResponse = extractLlmContent(response);
        }
        console.log(`LLM response: ${stringResponse}`);

        // Clip off any leading <think>cot</think> content (Deepseek R1)
        stringResponse = clipThinkTags(stringResponse);

        // In the case of a recurse, it's a function call cycle, so return here early.
        if (recurse) return stringResponse;

        let isFunctionCall = true;
        let functionCallCounter = 0;
        while (isFunctionCall && functionCallCounter++ <= 4) {
            if (functionCallCounter > 1) console.log(`Function call ${functionCallCounter}`);
            try {
                let normalizedJson = normalizeFunctionCallJson(stringResponse);
                if (!normalizedJson) {
                    throw new Error('No valid JSON detected');
                }
                stringResponse = normalizedJson;

                let objectMessage: PluginCallMessage = JSON.parse(stringResponse);
                if (objectMessage.action) {
                    objectMessage.action = objectMessage.action.replace(/\s+/g, '');
                    objectMessage.action = objectMessage.action.replace(/--+/g, '-');
                }
                if (objectMessage['function_name']) objectMessage['name'] = objectMessage['function_name'];
                if (objectMessage['parameters']) objectMessage['arguments'] = objectMessage['parameters'];
                // If it says action: literally anything, and otherwise the JSON
                // works as a function-call, just take it and invoke LLM func.
                // Also sometimes the LLM says role: function when it's directed not to.
                if (objectMessage.action && objectMessage.name && objectMessage.arguments
                    || objectMessage.role && objectMessage.name && objectMessage.arguments) {
                    console.log("Received a function call message from the LLM.");

                    // Add the LLM's response to the conversation context
                    conversationContext.chatMessages.push({ role: 'assistant', content: stringResponse, images: [] });
                    console.log('Context now has ' + conversationContext.chatMessages.length + ' messsages.');

                    // Try to invoke the LLM function, then send the result to the LLM.
                    let functionResult = await invokeLlmFunction(objectMessage, conversationId);

                    // Clip the function call result text to a configurable max number of bytes.
                    let maxBytes: number = 280000;
                    const llmFunctionResponseMaxBytes: unknown = process.env.LLM_FUNCTION_RESPONSE_MAX_BYTES;
                    if (typeof llmFunctionResponseMaxBytes === 'number') maxBytes = llmFunctionResponseMaxBytes;
                    if (typeof llmFunctionResponseMaxBytes === 'string') maxBytes = Number.parseInt(llmFunctionResponseMaxBytes);
                    console.log(`Max function call response bytes allowed: ${maxBytes}`);
                    if (functionResult.length > maxBytes) functionResult = functionResult.substring(0, maxBytes);
                    
                    // Build the function response JSON
                    let functionResponseJson = buildFunctionResponse(functionResult);

                    // Recursive call to queryLLM(), but the nested one returns early.
                    console.log(`Saying this to LLM: ${functionResponseJson}`);
                    stringResponse = await queryLLM('user', functionResponseJson, conversationId, true);
                } else {
                    // FIXME: If it's JSON text (parsed without errors) but it isn't a
                    // function call, we don't want to show that to the user, so try to extract / remove it.
                    isFunctionCall = false;

                    if (objectMessage.action && objectMessage.content) {
                        stringResponse = objectMessage.content;
                    } else if (objectMessage.role && objectMessage.content &&
                        objectMessage.role == "assistant") {
                        stringResponse = objectMessage.content;
                    }
                }
            } catch (e) {
                //console.log('Error: ' + e);
                // The response was plain text, so we'll give it to the user.
                isFunctionCall = false;
            }
        }
        console.log('Not a function call..');

        // Remove the function call junk from the conversation context so behavior goes back to normal.
        let messages = conversationContext.chatMessages;
        removeTrailingJsonMessages(messages);
        if (webScrape) {
            webScrape = false;
            // Note: we no longer splice because we never added the web message to the persistent array
            console.log('WebScrape mode disabled.');
        }

        // FIXME: We need to decide earlier in the code if it's a hidden function call or not.
        // If at the end it is still a JSON message, hide that from the user.
        if (stringResponse.startsWith('{')) {
            // Still begins with a JSON.
            console.log('Error: Final response would have been: \n${stringResponse}');
            stringResponse = '😳 Error, sorry. (581)';
        } else {
            // It doesn't begin with a JSON.
            // Add the LLM's response to the conversation context
            conversationContext.chatMessages.push({ role: 'assistant', content: stringResponse, images: [] });
            console.log('Context now has ' + conversationContext.chatMessages.length + ' messsages.');
        }

        //console.log(response); // Uncomment this to see the HTTP response.
        return stringResponse;
    } catch (error) {
        console.error('Error querying LLM:', error);
        return '😳 Error, sorry. (580)';
    }
}

function startNewConversationContext(conversationId: string) {
    let chatMessages: ChatMessage[] = [];

    // Initial system message that always stays at the top of the message context.
    const topSystemMessage = 'Today\'s date and time is: ' + new Date().toISOString() + '\n'
    + 'Greet the user warmly but never ask how you can help nor what you can do for them.\n'
    + eddieOnlySystemMessage;

    console.log(topSystemMessage);
    chatMessages.push({ role: 'system', content: topSystemMessage, images: [] });
    idToConversationContextMap[conversationId] = ({ chatMessages } as ConversationContext);
}

function shouldWebScrape(message: string, conversationContext: ConversationContext, conversationId: string): boolean {
    let m = message.toLocaleLowerCase();
    // TODO: Plugins should probably be able to add patterns that return true.
    // TODO: Support other languages, maybe by asking the LLM to
    // translate the list of words and phrases before the check.
    // Currently supported languages:
    //       English                     Castellano                   Portugues
    if (/search/g.test(m)       || /busc[ae]+/g.test(m)       || /procur[ae]+/g.test(m) || /pesquis/g.test(m) ||
        /price/g.test(m)        || /precio/g.test(m)          || /pre[çc]+o/g.test(m) ||
        /market cap/g.test(m)   || /capitalización/g.test(m)  || /capitalização/g.test(m) ||
        /news/g.test(m)         || /noticias/g.test(m)        || /nov[ei]+dad/g.test(m) || /not[íi]+cias/g.test(m) ||
        /current/g.test(m)      || /a[c]*tual/g.test(m)       || /corr[i]*ente/g.test(m) || 
        /up[ -]+to[ -]+date/g.test(m) ||/* covered below */   /em[ ]+dia[ ]+com/g.test(m) ||
        /today/g.test(m)        || /hoy/g.test(m)             || /hoyje/g.test(m) ||
        /soon/g.test(m)         || /pronto/g.test(m)          || /breve/g.test(m) ||
        /upcoming/g.test(m)     || /próximo/g.test(m)         || /por[ ]+vir/g.test(m) ||
        /yesterday/g.test(m)    || /ayer/g.test(m)            || /ontem/g.test(m) || 
        /recent/g.test(m)       ||             /rec[i]*ente/g.test(m)     ||
        /this[ ]+week/g.test(m) ||             /es[ts]+a[ ]+semana/g.test(m) ||
        /this[ ]+month/g.test(m)||             /es[ts]+e[ ]+m[eê]+s/g.test(m)||
        /this[ ]+year/g.test(m) ||             /es[ts]+e[ ]+a[ñn]o/g.test(m) ||
        /google[ ]+it/g.test(m) ||             // no equivalent.
        /google[ ]+for/g.test(m)||             // no equivalent.
        /google[ ]+that/g.test(m))             // no equivalent.
        return true;
    // Phrase patterns..
    if (/(read|get|download)+[ ]+th(e|is)[ ]+(web)*[ ]*(site|page|link)/g.test(m) ||
        (/leia|lee/g.test(m) && /p[áa]gina/g.test(m) && /web/g.test(m)) ||
        (/list|numbers/g.test(m) && /crypto|nft|token|stock|supply/g.test(m)) ||
        (/indíque|liste/g.test(m) && /cripto|nft|token|acciones|ações|suministro|suprimento/g.test(m))) {
        return true;
    }
    return false;
}

/**
 * The envelope object emitted by `signal-cli receive --output=json`, as we
 * consume it. We only read the fields listed here; unknown fields are ignored,
 * so the shape stays minimal and the `any` in `handleMessage` goes away.
 */
/**
 * The `dataMessage` payload inside a Signal envelope, as emitted by
 * signal-cli's receive command. Modeled (instead of `any`) so `handleMessage`
 * can be typed end-to-end.
 */
export interface SignalDataMessage {
    /** Message text (newer signal-cli field name). Defaults to undefined. */
    text?: string;
    /** Message text (older signal-cli field name, still emitted). Defaults
     *  to undefined. */
    message?: string;
    /** Unix epoch milliseconds. Used to inject timestamp context into the
     *  LLM prompt. Defaults to undefined. */
    timestamp?: string;
    /** Group info for group messages; holds the group UUID. Defaults to
     *  undefined. */
    groupInfo?: { groupId?: string };
    /** Alternate group field location (older signal-cli). Defaults to
     *  undefined. */
    group?: { groupId?: string };
    /** URIs of attached files (images etc.), as emitted by older signal-cli.
     *  Each entry is either a plain string URI or an object holding the
     *  attachment id. Newer signal-cli emits `attachments` instead; both are
     *  read via `extractAttachmentIds()`. Defaults to undefined. */
    attachmentUris?: string[] | ({ id?: string; uuid?: string } | string)[];
    /** Modern (signal-cli 0.14+) attachment descriptors. Each object carries
     *  an `id` — the value `signal-cli getAttachment --id` consumes — plus
     *  contentType/file size/dimensions metadata. Defaults to undefined. */
    attachments?: SignalAttachment[];
    /** @-mention targets. Defaults to undefined. */
    mentions?: { number?: string; uuid?: string }[];
    /** The recipient of the message; may be a bare UUID string or an object
     *  with a `uuid` field. Defaults to undefined. */
    recipient?: { uuid?: string } | string;
    /** The group ID (alternative top-level location). Defaults to undefined. */
    groupId?: string;
    /** Escapes any further fields we haven't modeled. */
    [field: string]: unknown;
}

/**
 * One element of a modern signal-cli `dataMessage.attachments` array.
 * Models the descriptor object (as opposed to the `attachmentUris` string
 * form, which is just a URI/id). Exported so `pluginLoader`'s JSDoc
 * introspection can reference a concrete type and tests can type their
 * fixtures.
 */
export interface SignalAttachment {
    /** The attachment id (e.g. `wgqC4jNId3S8Pgg-vDY-.jpg`). This is what
     *  `signal-cli getAttachment --id` takes. */
    id?: string;
    /** Legacy alternative id key (older signal-cli). */
    uuid?: string;
    /** MIME type reported by Signal, e.g. `image/jpeg`. */
    contentType?: string;
    /** The original filename, when provided. */
    filename?: string | null;
    /** File size in bytes. */
    size?: number;
    /** Image width in pixels. */
    width?: number;
    /** Image height in pixels. */
    height?: number;
    /** Caption, when one was sent alongside the image. */
    caption?: string | null;
    /** Upload timestamp, epoch milliseconds. */
    uploadTimestamp?: number;
}

export interface SignalEnvelope {
    /** Envelope UUID from Signal. Used to key the per-conversation context
     *  map. Optional in practice (missing only if malformed), defaults to
     *  undefined. */
    envelopeId?: string;
    /** Sender phone number, e.g. "+15550001111". Used for admin/ignore checks
     *  and mention matching. Defaults to undefined. */
    source?: string;
    /** Sender account UUID (used for mention matching). Defaults to undefined. */
    sourceUuid?: string;
    /** The data message payload. Defaults to undefined. */
    dataMessage?: SignalDataMessage;
}

/**
 * Body of the LLM chat-completions API response. We support both the
 * OpenAI-compatible shape (Ollama's `/v1/chat/completions`), which nests the
 * reply under `choices[0].message.content`, and the Ollama native `/api/chat`
 * shape, which carries it directly at `message.content`, so the client works
 * against whichever flavor `LLM_API_URL` points to.
 */
export interface LlmResponse {
    /** OpenAI-compatible choices array; absent in the native Ollama shape. */
    choices?: { message?: { content?: string; }; }[];
    /** Native Ollama message field; absent in the OpenAI-compatible shape. */
    message?: { content?: string; };
}

//----------------------------------------------------------------------------
// LLM response shape helpers
//----------------------------------------------------------------------------

/**
 * Pulls the assistant's text content out of an LLM API response body, whether
 * it arrived in the OpenAI-compatible `choices[0].message.content` shape or
 * the native Ollama `message.content` shape. Returns the empty string if the
 * reply is missing from both places (e.g. the model consumed its budget on
 * thinking).
 * @param {LlmResponse} data The response body from the LLM POST.
 * @returns {string} The assistant's text content, or '' if absent.
 */
export function extractLlmContent(data: LlmResponse): string {
    if (!data) return '';
    const fromChoices = data.choices?.[0]?.message?.content;
    if (typeof fromChoices === 'string' && fromChoices.length > 0) return fromChoices;
    const fromMessage = data.message?.content;
    return (typeof fromMessage === 'string' && fromMessage.length > 0) ? fromMessage : '';
}

/**
 * The POST body sent to the OpenAI-compatible /chat/completions endpoint.
 * Modeled (instead of `any`) so `queryLLM`'s request has a concrete type.
 */
interface LlmRequest {
    /** The model name to run. Defaults to `llmModel` env var. */
    model: string;
    /** The chat messages (see LlmMessage). Required. */
    messages: LlmMessage[];
    /** Context window size in tokens. Defaults to `llmModelContextSize`. */
    num_ctx: number;
    /** Whether to stream the response. We always set false. */
    stream: boolean;
    /** How long to keep the model loaded server-side (e.g. "15m"). */
    keep_alive: string;
}

/**
 * The JSON object an LLM emits when it wants to call one of our plugin
 * functions (normalized over the wire). Modeled here so `invokeLlmFunction`
 * and the JSON.parse site can be typed instead of `any`.
 */
interface PluginCallMessage {
    /** The tool/action the LLM wants to invoke (e.g. "web_search"). Defaults
     *  to undefined. */
    action?: string;
    /** The function name (alias for `action` in some models). Defaults to
     *  undefined. */
    function_name?: string;
    /** Function arguments as a key/value object. Defaults to undefined. */
    parameters?: { [argName: string]: unknown };
    /** The LLM's role string, e.g. "assistant". Defaults to undefined. */
    role?: string;
    /** The function name (see `action`). Defaults to undefined. */
    name?: string;
    /** Function arguments (see `parameters`). Defaults to undefined. */
    arguments?: { [argName: string]: unknown };
    /** The LLM's message content/text. Defaults to undefined. */
    content?: string;
}

async function invokeLlmFunction(objectMessage: PluginCallMessage, conversationId: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        try {
            // Determine if the function the LLM wants to call is an exposed LLM function.
            const functionName: string = objectMessage.name || '';
            let func: string | undefined = undefined;
            for (let toolFunction of plugins.tools) {
                if (toolFunction && toolFunction.function) {
                    console.log(`Invoker comparing ${toolFunction.function.name} to ${functionName}`);
                    if (toolFunction.function.name == functionName) {
                        func = functionName;
                        console.log(`Invoker validated ${functionName} !`);
                        break;
                    }
                }
            }
            // FIXME: addionally validate that the argument list applies.
            // https://stackoverflow.com/questions/51851677/how-to-get-argument-types-from-function-in-typescript
            if (func !== undefined) {
                console.log('Invoker invoking LLM function.');
                const funcArgs: string[] = [];
                const oArguments: { [argName: string]: unknown } = objectMessage.arguments || {};
                let linkUrl = '';
                for (let argName of Object.getOwnPropertyNames(oArguments)) {
                    const argumentName = argName.toString();
                    console.log(`Invoker argumentName: ${argumentName}`);
                    const argumentValue: unknown = oArguments[argumentName];
                    console.log(`Invoker arg type: ` + typeof argumentValue);
                    // TODO: support non-string argument values!
                    const argumentStringValue: string = String(argumentValue);
                    console.log(`Invoker added arg: ${argumentStringValue}`);
                    // Array of string arguments are supported.
                    if (Array.isArray(argumentValue)) {
                        for (const stringValue of argumentValue) {
                            // FIXME: For now all the values of a string array go into the
                            // function arguments as separate args (ultimately wrong).
                            funcArgs.push(String(stringValue));
                        }
                    } else if (argumentStringValue.startsWith('[') &&
                               argumentStringValue.endsWith(']')) {
                        // A string that *looks* like an array (legacy behavior: iterate its
                        // characters, which is ultimately wrong but preserved here).
                        for (const stringValue of argumentStringValue) {
                            funcArgs.push(stringValue);
                        }
                    } else {
                        // Regular string arguments are supported.
                        if (argumentStringValue.length > 0) {
                            funcArgs.push(argumentStringValue);

                            // At least in the case of the WebScrapePlugin, one string argument
                            // is the URL, and the user may be interested to know which URLs
                            // the LLM is reading, in the course of answering a prompt.
                            // TODO: Make this toggleable via configuration.
                            if (argumentStringValue.toLocaleLowerCase().startsWith('http://') ||
                                argumentStringValue.toLocaleLowerCase().startsWith('https://')) {
                                linkUrl = argumentStringValue;
                            }
                        }
                    }
                }
                console.log('Invoker: ' + functionName + '(' + JSON.stringify(funcArgs) + ') arg count=' + funcArgs.length);
                try {
                    // INVOKE the LLM function!
                    const stringResult = await plugins[functionName](...funcArgs);
                    //console.log(`Invoker received result: ${stringResult}`);
                    if (linkUrl && stringResult
                       && !(stringResult.includes(':404,') && stringResult.includes('\"error\"'))) {
                        sendMessage(conversationId, `🤖 ${linkUrl}`);
                    }
                    resolve(stringResult);
                } catch (error) {
                    console.log(`Invoker: ${error}`);
                    reject(error);
                }
            } else {
                console.log(`The function name ${functionName} didn't match any LLM function.`);
                reject('No such function.');
            }
        } catch (error) {
            console.log(error);
            reject(error);
        }
    })
}

async function processQueuedMessages(botName: string, receivedArray: Array<SignalEnvelope>) {
    // Process queued messages while the receive command isn't running.
    while (receivedArray.length > 0) {
        const envelope = receivedArray.shift();
        if (envelope) {
            await handleMessage(botName, envelope);
        }
    }
}

// Start the bot
async function startBot() {
    botName = await getBotName();
    console.log(`Bot name is: ${botName}`);
    const myConsole = console;

    // Get the directory of the current script file
    const currentDir = path.dirname(__filename);
    let pluginDir = process.env.PLUGIN_DIR || 'plugin';
    // Load the plugins.
    const loader = new PluginLoader(path.join(currentDir, pluginDir));
    plugins = await loader.loadPlugins();
    console.log('Plugin loader loaded LLM functions:');
    console.log(`tools = ` + JSON.stringify(plugins.tools));

    // A queue of messages received from Signal that need processing.
    let receivedArray: Array<SignalEnvelope> = [];

    // This is the server's forever loop, to stay running.
    while (true) {
        // Run the receiver process to receive messages from other users.
        const command = `${signalCliPath} --output=json --trust-new-identities=always -u ${botPhoneNumber} receive --send-read-receipts`;
        //console.log(command);
        const childProcess = exec(command);
        childProcess.on('exit', async (code) => {
            //myConsole.log(`Receive exited. Total messages received: ` + receivedArray.length);
            if (receivedArray.length > 0) {
                // Sleep for a short time before processing messages.
                // TODO: This is a hack / wrong. Instead, it should wait for the receive
                // process to finish reading received lines and only then begin processing.
                await new Promise((r) => setTimeout(r, 1000)); // 1 second

                await processQueuedMessages(botName, receivedArray);
            }
        });

        // Receive any message text lines from Signal and queue them in the receivedArray.
        const rl = readline.createInterface({
            input: childProcess.stdout!,
            output: process.stdout,
            terminal: false
        });

        // Parse the received message lines, one at a time, queue any messages.
        rl.on('line', async (line) => {
            console.log(`RECEIVED: ` + line);
            // Parse signal-cli output and construct a signalMessage object
            const envelope = parseReceiveLine(line);
            if (envelope) {
                // Enqueue the message.
                receivedArray.push(envelope);
                console.log(`Enqueued.`);
            }
        });

        // Sleep for a short time before receiving again.
        await new Promise((r) => setTimeout(r, 3000));

        childProcess.kill();

        //console.log(`Main loop.`);
    }
}

if (require.main === module) {
    startBot().catch(console.error);
}
