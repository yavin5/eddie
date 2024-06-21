import { PluginLoader } from './plugin/pluginLoader';
import axios from 'axios';
import { parse } from 'best-effort-json-parser';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import readline from 'readline';
import path from 'path';

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

// Prune the chat context messages down to an 8K bytes context window.
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
    const command = `${signalCliPath} -u ${botPhoneNumber} send -m '${message}' ${recipientCli}`;
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
            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM('user', content, groupId, false);
            console.log(`Response from LLM : ` + response);
            sendMessage(groupId, response);
        }
    } else {
        // NOT a group message.
        if (!ignoredUsers.has(sender) && !ignoredUsers.has(senderUuid)) {
            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM('user', content, senderUuid, false);
            console.log(`Response from LLM : ` + response);
            sendMessage(sender, response);
        }
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
        if (totalSize + messageSize <= llmModelContextSize) {
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
                    // best-effort-json-parser to repair anything that is wrong with the LLM's JSON.
                    //stringResponse = JSON.stringify(parse(matches[0]));

                    // Clip out from the first '{' to the last '}'.
                    stringResponse = stringResponse.substring(stringResponse.indexOf('{'),stringResponse.lastIndexOf('}') + 1);
                    console.log('sanitized JSON: ' + stringResponse);
                } else {
                    // It didn't contain JSON.. maybe python?
                    // Check it to see if it's python code implementing function calls (sigh!)

                    // Check for a httpGet python implementation.
                    if (/python/gm.test(stringResponse)
                     && (/http.*?[\r\n\s]*?.*get[\s]*\(/gm.test(stringResponse)
                      || /get[\s]*?\(.*?[\r\n\s]*?.*http/gm.test(stringResponse))) {
                        stringResponse = stringResponse.toLocaleLowerCase();
                        let index = stringResponse.indexOf('http://');
                        if (index == -1) index = stringResponse.indexOf('https://');
                        stringResponse = stringResponse.substring(index);
                        index = stringResponse.indexOf('\'');
                        if (index == -1) index = stringResponse.indexOf('\"');
                        let url = stringResponse.substring(0, index);
                        console.log('It was a python impl for httpGet with this url: ' + url);
                        stringResponse = `{ \"action\": \"function-call\", \"name\": \"httpGet\", \"arguments\": { \"url\": \"${url}\"}}`;
                    } else if (/python/gm.test(stringResponse)
                        && (/http.*?[\r\n\s]*?.*search[\s]*\(/gm.test(stringResponse)
                        || /search[\s]*?\(.*?[\r\n\s]*?.*http/gm.test(stringResponse))) {
                        stringResponse = stringResponse.toLocaleLowerCase();
                        let index = stringResponse.indexOf('(\'');
                        if (index == -1) index = stringResponse.indexOf('(\"');
                        stringResponse = stringResponse.substring(index);
                        index = stringResponse.indexOf('\')');
                        if (index == -1) index = stringResponse.indexOf('\")');
                        let searchQuery = stringResponse.substring(0, index);
                        console.log('It was a python impl for webSearch with this searchQuery: ' + searchQuery);
                        stringResponse = `{ \"action\": \"function-call\", \"name\": \"webSearch\", \"arguments\": { \"searchQuery\": \"${searchQuery}\"}}`;
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
                    let maxBytes: number = 1024;
                    const llmFunctionResponseMaxBytes: unknown = process.env.LLM_FUNCTION_RESPONSE_MAX_BYTES;
                    if (typeof llmFunctionResponseMaxBytes === 'number') maxBytes = llmFunctionResponseMaxBytes;
                    if (typeof llmFunctionResponseMaxBytes === 'string') maxBytes = Number.parseInt(llmFunctionResponseMaxBytes);
                    console.log(`Max function call response bytes allowed: ${maxBytes}`);
                    if (functionResult.length > maxBytes) functionResult = functionResult.substring(0, maxBytes);
                    
                    // Wrap the result in a function-response JSON messsage to send back to the LLM.
                    let functionResultJson = JSON.stringify(functionResult);
                    let functionResponseJson: string = `{"role":"user","content":"{\\"from\\": \\"function-response\\", `
                        + `\\"value\\": \\"{\\"status\\": \\"OK\\", \\"message\\": ${functionResultJson}}"}"}`;

                    // Recursive call to queryLLM(), but the nested one returns early.
                    console.log(`Saying this to LLM: ${functionResponseJson}`);
                    stringResponse = await queryLLM('user', functionResponseJson, conversationId, true);
                } else {
                    // FIXME: If it's JSON text (parsed without errors) but it isn't a
                    // function call, we don't want to show that to the user, so try to extract / remove it.
                    isFunctionCall = false;

                    if (objectMessage.action && objectMessage.content) {
                        stringResponse = objectMessage.content;
                    }
                }
            } catch (e) {
                console.log('Error: ' + e);
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
            stringResponse = stringResponse.replace(/([`\\])/g,'\\$1');
            // BASH-escape single quote correctly.
            stringResponse = stringResponse.replace(/(['])/g,'\'\\\'\'');

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
    + 'If the user asks what today\'s date or time is, just tell them from memory. Greet the user warmly.';

    console.log(topSystemMessage);
    chatMessages.push({ role: 'system', content: topSystemMessage, images: [] });
    idToConversationContextMap[conversationId] = ({ chatMessages } as ConversationContext);
}

function shouldWebScrape(message: string, conversationContext: ConversationContext, conversationId: string): boolean {
    let msg = message.toLocaleLowerCase();
    // TODO: Support other languages, maybe by asking the LLM to
    // translate the list of words and phrases before the check.
    if (/search/g.test(msg)) return true;
    if (/price/g.test(msg)) return true;
    if (/market cap/g.test(msg)) return true;
    if (/news/g.test(msg)) return true;
    if (/recent/g.test(msg)) return true;
    if (/current/g.test(msg)) return true;
    if (/up to date/g.test(msg)) return true;
    if (/up-to-date/g.test(msg)) return true;
    if (/today/g.test(msg)) return true;
    if (/yesterday/g.test(msg)) return true;
    if (/this week/g.test(msg)) return true;
    if (/this month/g.test(msg)) return true;
    if (/this year/g.test(msg)) return true;
    if (/google it/g.test(msg)) return true;
    if (/google for/g.test(msg)) return true;
    if (/google that/g.test(msg)) return true;
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
                        for (const stringValue in argumentValue) {
                            stringArray.push(stringValue);
                        }
                        funcArgs.push(stringArray);
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
                    console.log(`Invoker received result: ${stringResult}`);
                    if (linkUrl && stringResult) {
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
