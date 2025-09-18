import { PluginLoader } from './plugin/pluginLoader';
import { QwenImageGenerator, ImageGenerationResult } from './spectacle-image-client';
import axios from 'axios';
import { parse } from 'best-effort-json-parser';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import readline from 'readline';
import path from 'path';
import * as fs from 'fs/promises';

dotenv.config();

let plugins: any = undefined;

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
const functionCallSystemMessage1 = 'You are a helpful assistant with access to real-time data from the web using '
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

// Get bot's name from the Signal profile
function getBotName(): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`${signalCliPath} --output=json -u ${botPhoneNumber} listContacts -a ${botPhoneNumber}`, (error, stdout, stderr) => {
            if (error) {
                return reject(stderr);
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

// Send a message via signal-cli
function sendMessage(recipient: string, message: string): void {
    let recipientCli: string = recipient;
    if (recipient.endsWith('=')) {
        recipientCli = `-g ${recipientCli}`;
    }
    // If the message is a file path / filename then send that file.
    let messageIsFile = message.startsWith('/');
    let body = `-m '${message}'`;
    let attachment = '';
    if (messageIsFile) {
        body = ``;
	attachment = ` --attachment ${message}`;
    }
    const command = `${signalCliPath} -u ${botPhoneNumber} send ${body} ${recipientCli}${attachment}`;
    console.log(command);
    exec(command);
}

// Handle incoming messages
async function handleMessage(botName: string, envelope: any): Promise<void> {
    //if (envelope == null) return;
    const sender = envelope.source;
    const senderUuid = envelope.sourceUuid
    const dataMessage = envelope.dataMessage || '';
    const groupInfo = dataMessage.groupInfo || '';
    const groupId = dataMessage.groupInfo?.groupId || '';
    const content = dataMessage.message || '';
    const timestamp = dataMessage.timestamp || '0';

    console.log('handleMessage');
    console.log(`sender: ${sender}`);
    console.log(`groupInfo: ${groupInfo}`);
    console.log(`groupId: ${groupId}`);
    //console.log(`content: ${content}`);

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
        if (dataMessage.mentions) {
            const mention = dataMessage.mentions.find((mention: any) =>
                mention.number === botPhoneNumber ||
                mention.uuid === botPhoneNumber);
            if (mention) {
                // Handle any slash commands.
                const handled = await handleSlashCommands(content, groupId, timestamp);
                if (handled) return;

                console.log(`Saying this to LLM: ` + content);
                const response = await queryLLM('user', content, groupId, false);
                console.log(`Response from LLM : ` + response);
                sendMessage(groupId, response);
            }
        }

        // FIXME: should say else right here.

        // Check to see if the bot's name is on the front of the message,
        // or @BotName (a plain text mention) is in the message somewhere.
        if (content.toLowerCase().startsWith(botName.toLowerCase()) ||
            content.toLowerCase().includes('@' + botName.toLowerCase())) {
            // Handle any slash commands.
            const handled = await handleSlashCommands(content, groupId, timestamp);
            if (handled) return;

            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM('user', content, groupId, false);
            console.log(`Response from LLM : ` + response);
            sendMessage(groupId, response);
        }
    } else {
        // NOT a group message.
        if (!ignoredUsers.has(sender) && !ignoredUsers.has(senderUuid)) {
            // Handle any slash commands.
            const handled = await handleSlashCommands(content, senderUuid, timestamp);
            if (handled) return;

            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM('user', content, senderUuid, false);
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
    let msg = message;
    if (msg.startsWith(botName)) msg = msg.substring(botName.length);
    if (msg.startsWith('@' + botName)) msg = msg.substring(botName.length + 1);
    msg = msg.trim();
    if (msg.startsWith('/clear')) {
        await sendMessage(conversationId, '✨ My conversation context is now cleared.');
        startNewConversationContext(conversationId);
        return true;
    } else if (msg.startsWith('/help')) {
        await sendMessage(conversationId, 'Commands:\n'
            + '✨ /clear : Clears my conversation memory\n'
            + '🤷‍♂️ /help  : Show the list of commands\n'
            + '🌇 /image : Generate an image from a prompt');
        return true;
    } else if (msg.startsWith('/image')) {
        imageCommand(conversationId, timestamp, msg.substring(7));
	await sendMessage(conversationId, '🛠️  Ok, generating your image now. It may take up to 22 minutes..');
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
    const senderUuid = conversationId.replace(/-/g, 'x').replace(/\\/g, 'y').replace(/=/g, 'z');
    const messageId = timestamp;
    const width = 1024;
    const height = 1024;

    console.log(`Generating image for prompt: "${prompt}"`);

    const result: ImageGenerationResult = await new QwenImageGenerator().generateImageFromPrompt(
        senderUuid,
        messageId,
        prompt,
        width,
        height
    );

    if (result.status === 'success') {
        const imagePath = result.imagePath;
        console.log(`Image generated successfully: ${imagePath}`);
        await sendMessage(conversationId, path.join("/home/jasonb/git/image-server", imagePath));
	await new Promise((r) => setTimeout(r, 7000));
        try {
            await fs.unlink(imagePath);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.error(`File ${imagePath} does not exist.`);
            } else {
                console.error(`Error deleting file ${imagePath}:`, error.message);
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

// Query the local LLM runtime
async function queryLLM(actor: string, message: string, conversationId: string, recurse: boolean): Promise<string> {
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
        if (!recurse && shouldWebScrape(message, conversationContext, conversationId)) {
            webScrape = true;
            console.log('WebScrape mode engaged.');
            const toolsApi = JSON.stringify(plugins.tools);
            const useWebSystemMessage = `${functionCallSystemMessage1}${toolsApi}${functionCallSystemMessage2}`;
            conversationContext.chatMessages.push({ role: 'system', content: useWebSystemMessage, images: [] });
        }

        // Add the user's message to the conversation context
        conversationContext.chatMessages.push({ role: actor, content: message, images: [] });
        conversationContext.chatMessages = pruneChatMessages(conversationContext.chatMessages);
        console.log('Context now has (after prune) ' + conversationContext.chatMessages.length + ' messsages.');
        
        // Send a POST request to the LLM, sending the message context
        // In case LLM responds with empty string (sometimes), we loop, retrying a little.
        let response = null;
        let stringResponse = '';
        for (let retryCount = 0; !stringResponse && retryCount < 4; retryCount++) {
            response = await axios.post(llmApiUrl, {
                model: model,
                messages: conversationContext.chatMessages,
                num_ctx: llmModelContextSize,
                stream: false,
                keep_alive: "15m"
            });
            stringResponse = response.data.message.content;
        }
        console.log(`LLM response: ${stringResponse}`);

        // Clip off any leading <think>cot</think> content (Deepseek R1)
        const lines = stringResponse.split(/\r?\n/);
        let found = false;
        let result = [];
        for (let line of lines) {
            if (!found && line.includes('</think>')) {
                found = true;
                continue;
            }
            if (found) result.push(line);
        }
        if (found) stringResponse = result.join('\n').trim();

        // In the case of a recurse, it's a function call cycle, so return here early.
        if (recurse) return stringResponse;

        let isFunctionCall = true;
        let functionCallCounter = 0;
        while (isFunctionCall && functionCallCounter++ <= 4) {
            if (functionCallCounter > 1) console.log(`Function call ${functionCallCounter}`);
            try {
                stringResponse = stringResponse.replace(/\\\\+/g, '');
                stringResponse = stringResponse.replace(/\\\\+/g, '');
                let matches: RegExpMatchArray | null;
                // Check to see if it contained JSON text.
                if (matches = stringResponse.match(/^[\s]*{[\s\n\r]*[\\]*["][\s]*action[\s]*[\\]*["][\s]*:.*/gm)) {
                    console.log("JSON content detected.");

                    // Clip out from the first '{' to the last '}'.
                    stringResponse = stringResponse.substring(stringResponse.indexOf('{'),stringResponse.lastIndexOf('}') + 1);
                    // best-effort-json-parser to repair anything that is wrong with the LLM's JSON.
                    stringResponse = JSON.stringify(parse(stringResponse));
                    console.log('sanitized JSON: ' + stringResponse);
                } else {
                    // It didn't contain JSON.. maybe contains markup tool tags or python?

                    // See if it's a <｜tool▁calls▁begin｜> block
                    // For model: deepseek-coder-v2
                    if (/<｜tool▁calls▁begin｜>/gmi.test(stringResponse)) {
                        // This block may contain N number of <｜tool▁call▁begin｜>
                        // tags, each one being a tool call.  For now, do the 1st one!
                        stringResponse = stringResponse.toLowerCase();
                        // FIXME: Don't hard code function names or params.
                        if (/<｜tool▁call▁begin｜>function<｜tool▁sep｜>(webSearch|web_search|searchWeb|search_web)$/gmi.test(stringResponse)) {
                            let searchQuery: string | string[] = Array.from(stringResponse.matchAll(/{\s*?(["']+)(searchQuery|search_query)\1[:]+[\s\r\n]*\1(.+)\1/gmi), m => m[3]);
                            console.log('It was a tool call tag block for webSearch with this searchQuery: ' + searchQuery);
                            stringResponse = `{ "action": "function-call", "name": "webSearch", "arguments": { "searchQuery": "${searchQuery}"}}`;
                        } else if (/<｜tool▁call▁begin｜>function<｜tool▁sep｜>(httpGet|http_get|getHttp|get_http)$/gmi.test(stringResponse)) {
                            let url: string | string[] = Array.from(stringResponse.matchAll(/{\s*?(["']+)url\1[:]+[\s\r\n]*\1(.+)\1/gmi), m => m[2]);
                            if (Array.isArray(url)) url = url[0];
                            console.log('It was a tool call tag block for httpGet with this url: ' + url);
                            stringResponse = `{ "action": "function-call", "name": "httpGet", "arguments": { "url": "${url}"}}`;
                        }
                    } else 
                    // Check it to see if it's python code implementing function calls (sigh!)
                    // For model: dolphin-2.9.2-qwen2-7b (mainly)
                    // Check for a httpGet python implementation.
                    if (/python/gmi.test(stringResponse)
                     && (/http.*?[\r\n\s]*?.*get[\s]*\(/gmi.test(stringResponse)
                      || /get[\s]*?\(.*?[\r\n\s]*?.*http/gmi.test(stringResponse))) {
                        stringResponse = stringResponse.toLocaleLowerCase();
                        let index = stringResponse.indexOf('http://');
                        if (index == -1) index = stringResponse.indexOf('https://');
                        stringResponse = stringResponse.substring(index);
                        index = stringResponse.indexOf('\'');
                        if (index == -1) index = stringResponse.indexOf('\"');
                        let url = stringResponse.substring(0, index);
                        console.log('It was a python impl for httpGet with this url: ' + url);
                        stringResponse = `{ "action": "function-call", "name": "httpGet", "arguments": { "url": "${url}"}}`;
                    } else
                    // Check it to see if it's python code implementing function calls (sigh!)
                    // For model: dolphin-2.9.2-qwen2-7b
                    // Check for a webSearch python implementation.
                    if (/python/gmi.test(stringResponse)
                        && (/search[\s]*\(/gmi.test(stringResponse)
                        || /google.*?[\r\n\s]*?.*search[\s]*\(/gmi.test(stringResponse)
                        || /search.*?[\r\n\s]*?.*web[\s]*\(/gmi.test(stringResponse))) {
                        stringResponse = stringResponse.toLocaleLowerCase();
                        let index = stringResponse.indexOf('\"');
                        if (index == -1) index = stringResponse.indexOf('\'');
                        stringResponse = stringResponse.substring(index);
                        index = stringResponse.indexOf('\"');
                        if (index == -1) index = stringResponse.indexOf('\'');
                        let searchQuery = stringResponse.substring(0, index);
                        if (searchQuery.indexOf('\"')) {
                            searchQuery = searchQuery.substring(searchQuery.indexOf('\"'));
                        }
                        console.log('It was a python impl for webSearch with this searchQuery: ' + searchQuery);
                        stringResponse = `{ "action": "function-call", "name": "webSearch", "arguments": { "searchQuery": "${searchQuery}"}}`;
                    } else {
                        console.log("Don't know what content type is in the message.");
                    }
                }
                let objectMessage = JSON.parse(stringResponse);
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
                    
                    // Wrap the result in a function-response JSON messsage to send back to the LLM.
                    let functionResultJson = JSON.stringify(functionResult);
                    // Peel off single quotes that JSON.stringify() added.
                    if (functionResultJson.length > 2) {
                        functionResultJson = functionResultJson.substring(1, functionResultJson.length - 1);
                    }
                    let functionResponseJson: string = `{"role":"user","content":"{\\"from\\": \\"function-response\\", `
                        + `\\"value\\": \\"{\\"status\\": \\"OK\\", \\"message\\": \\"${functionResultJson}\\"}\\"}"}`;

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
        while (messages[messages.length - 1].content.startsWith('{')) {
            messages.splice(messages.length - 1, 1);
        }
        if (webScrape) {
            // Remove the function call system message also.
            messages.splice(messages.length - 2, 1);
            webScrape = false;
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

            stringResponse = stringResponse.replace(/([\\])/g,'\\$1');
            // BASH-escape single quote correctly.
            stringResponse = stringResponse.replace(/(['])/g,'\'\\\'\'');
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
    + 'If the user asks what today\'s date or time is, just tell them from memory. Greet the user warmly.';

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
    if (/(read|get)+[ ]+th(e|is)[ ]+(web)*[ ]*(site|page)/g.test(m) ||
        (/leia|lee/g.test(m) && /p[áa]gina/g.test(m) && /web/g.test(m)) ||
        (/list|numbers/g.test(m) && /crypto|nft|token|stock|supply/g.test(m)) ||
        (/indíque|liste/g.test(m) && /cripto|nft|token|acciones|ações|suministro|suprimento/g.test(m))) {
        return true;
    }
    return false;
}

async function invokeLlmFunction(objectMessage: any, conversationId: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        try {
            // Determine if the function the LLM wants to call is an exposed LLM function.
            const functionName = objectMessage.name;
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
                const funcArgs: any[] = [];
                const oArguments: object = objectMessage.arguments;
                let linkUrl = '';
                for (let argName of Object.getOwnPropertyNames(oArguments)) {
                    const argumentName = argName.toString();
                    console.log(`Invoker argumentName: ${argumentName}`);
                    const argumentValue = (oArguments as any)[argumentName];
                    console.log(`Invoker arg type: ` + typeof argumentValue);
                    // TODO: support non-string argument values!
                    const argumentStringValue: string = argumentValue.toString();
                    console.log(`Invoker added arg: ${argumentStringValue}`);
                    // Array of string arguments are supported.
                    if (Array.isArray(argumentValue) ||
                        argumentStringValue.startsWith('[') &&
                        argumentStringValue.endsWith(']')) {
                        const stringArray: string[] = [];
                        for (const stringValue of argumentValue) {
                            // FIXME: For now all the values of a string array go into the
                            // function arguments as separate args (ultimately wrong).
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

async function processQueuedMessages(botName: string, receivedArray: Array<any>) {
    // Process queued messages while the receive command isn't running.
    while (receivedArray.length > 0) {
        await handleMessage(botName, receivedArray.shift() /*envelope*/);
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
    let receivedArray: Array<any> = [];

    // This is the server's forever loop, to stay running.
    while (true) {
        let signalMessage: any;
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
            try {
                const signalMessage = JSON.parse(line);
                const envelope = signalMessage.envelope;
                // TODO: support more message types such as images.
                if (envelope && signalMessage.envelope.dataMessage) {
                    // Enqueue the message.
                    receivedArray.push(envelope);
                    console.log(`Enqueued.`);
                }
            } catch (parseError) {
                console.log(parseError);
            }

        });

        // Sleep for a short time before receiving again.
        await new Promise((r) => setTimeout(r, 3000));

        childProcess.kill();

        //console.log(`Main loop.`);
    }
}

startBot().catch(console.error);
