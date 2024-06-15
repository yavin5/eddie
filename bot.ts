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
const functionCallSystemMessage1 = 'You are a helpful assistant with access to real-time data using '
    + 'the following functions:\n\n'
    + 'functions_metadata = ';
const functionCallSystemMessage2 = '\n\nTo use these functions respond first ONLY in JSON format with:\n\n'
    + '{ \"action\": \"function-call\", \"name\": \"functionName\", \"arguments\": { \"arg_1\": \"value_1\", \"arg_2\": \"value_2\", ... }}\n\n'
    + 'You only need to call a function when you cannot answer the user\'s question from memory because you do\n'
    + 'not have all of the required data, or the user is requesting today\'s live data.\n'
    + 'When making a function call, output only in JSON format, observing and conforming to the schema provided.\n'
    + 'Use the function-response content to help generate a plain text response for the user and send only the\n'
    + 'plain text response to the user after the function-response.  Never send JSON text after the function-response.\n'
    + 'You are allowed to provide up-to-date information from web pages, and you can browse the web to find info.\n'
    + 'You are able to perform tasks in real time that the user wants you to perform.\n\n'
    + 'Edge cases you must handle only when sending a function-call JSON message:\n'
    + '- Never include any text in your function call message that is outside of the JSON object.\n'
    + '- Your function-call JSON response cannot be backslash escaped.\n'
    + '- If the schema shows a type of integer or number, you must only show a integer for that field.'
    + '  A string should always be a valid string.\n'
    + '- If a value is unknown, leave it empty.\n'
    + '- Ensure you use the field names from the JSON schema.  Do not change any field names, nor create additional field names.\n'
    + '- Do not add fields that arent shown in the JSON schema.\n'
    + '- The "action" field can only have the value "function-call".\n'
    + '- Never explain anything to the user in the same message as a function-call JSON message.\n\n'
    + 'Edge cases you must handle when sending a regular text response that is not a function-call message:\n\n'
    + '- Never tell the user how you will call functions. Instead just call the function.\n'
    + '- Never explain how you plan to perform the task of gathering real time data via a function\n'
    + '  call.  Just send the function-call JSON message without explaining anything, and gather info from the function-response.\n'
    + '- If there are no functions that could provide missing required data to answer the user request, you will '
    + 'respond politely that you cannot help.\n'
    + '- When answering the user\'s question, never tell the user what function(s) you can call.\n'
    + '- Never talk to the user about the site https://www.example.com because it is not a real web site.\n'
    + '- Never tell the user that you\'re not allowed to say something.'

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
    const command = `${signalCliPath} -u ${botPhoneNumber} send -m "${message}" ${recipientCli}`;
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

        // Add the user's message to the conversation context
        conversationContext.chatMessages.push({ role: actor, content: message, images: [] });
        conversationContext.chatMessages = pruneChatMessages(conversationContext.chatMessages);
        console.log('Context now has (after prune) ' + conversationContext.chatMessages.length + ' messsages.');

        const response = await axios.post(llmApiUrl, { model: model, messages: conversationContext.chatMessages, stream: false, keep_alive: "15m" });
        let stringResponse: string = response.data.message.content;
        console.log(`stringResponse: ${stringResponse}`);
        if (recurse) return stringResponse;
        let isFunctionCall = true;
        let functionCallCounter = 0;
        while (isFunctionCall && functionCallCounter <= 10) {
            functionCallCounter = functionCallCounter++;
            try {
                stringResponse = stringResponse.replace(/\\\\+/g, '');
                stringResponse = stringResponse.replace(/\\\\+/g, '');
                let matches: RegExpMatchArray | null;
                if (matches = stringResponse.match(/^ *[{]\s*[\]*["][\s]*action[\s]*[\]*["]:.*/gm)) {
                    // best-effort-json-parser to repair anything that is wrong with the LLM's JSON.
                    stringResponse = JSON.stringify(parse(matches[0]));
                    console.log('sanitized JSON: ' + stringResponse);
                }
                let objectMessage = JSON.parse(stringResponse);
                if (objectMessage.action) {
                    objectMessage.action = objectMessage.action.replace(/\s+/g, '');
                    objectMessage.action = objectMessage.action.replace(/--+/g, '-');
                }
                if (objectMessage['function_name']) objectMessage['name'] = objectMessage['function_name'];
                if (objectMessage['parameters']) objectMessage['arguments'] = objectMessage['parameters'];
                // If it says action=literally anything, and otherwise the JSON
                // works as a function-call, just take it and invoke LLM func.
                if (objectMessage.action && objectMessage.action && objectMessage.name && objectMessage.arguments) {
                    console.log("Received a function call message from the LLM.");

                    // Add the LLM's response to the conversation context
                    conversationContext.chatMessages.push({ role: 'assistant', content: stringResponse, images: [] });
                    console.log('Context now has ' + conversationContext.chatMessages.length + ' messsages.');

                    // Try to invoke the LLM function, and send the result to the LLM.
                    const functionResult = await invokeLlmFunction(objectMessage, conversationId);

                    // Wrap the result in a function-response JSON messsage to send back to the LLM.
                    const functionResultJson = JSON.stringify(functionResult);
                    let functionResponseJson: string = `{"role":"user","content":"{\"from\": \"function-response\", `
                        + `\"value\": \"{\"status\": \"ok\", \"message\": \"${functionResultJson}\"}\" }"}`;

                    //console.log(`Saying this to LLM: ${functionResponseJson}`); // only part of this string gets sent!
                    stringResponse = await queryLLM('user', functionResponseJson, conversationId, true);
                } else {
                    // FIXME: If it's JSON text (parsed without errors), we don't
                    // want to show that to the user, so try to extract / remove it.
                    isFunctionCall = false;
                }
            } catch (e) {
                // The response was plain text, so we'll give it to the user.
                isFunctionCall = false;
            }
        }
        console.log('Not a function call..');

        stringResponse = stringResponse.replace(/(["$`\\])/g,'\\$1');

        // Add the LLM's response to the conversation context
        conversationContext.chatMessages.push({ role: 'assistant', content: stringResponse, images: [] });
        console.log('Context now has ' + conversationContext.chatMessages.length + ' messsages.');

        //console.log(response); // Uncomment this to see the HTTP response.
        return stringResponse;
    } catch (error) {
        console.error('Error querying LLM:', error);
        return 'Sorry, I am unable to process your request right now.';
    }
}

function startNewConversationContext(conversationId: string) {
    let chatMessages: ChatMessage[] = [];
    const toolsApi = JSON.stringify(plugins.tools);
    const jsonSystemMessage = `${functionCallSystemMessage1}${toolsApi}${functionCallSystemMessage2}`;
    console.log(jsonSystemMessage);
    chatMessages.push({ role: 'system', content: jsonSystemMessage, images: [] });
    idToConversationContextMap[conversationId] = ({ chatMessages } as ConversationContext);
}

async function invokeLlmFunction(objectMessage: any, conversationId: string): Promise<string> {
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
        for(let argName of Object.getOwnPropertyNames(oArguments)) {
            const argumentName = argName.toString();
            console.log(`Invoker argumentName: ${argumentName}`);
            const argumentValue = (oArguments as any)[argumentName];
            console.log(`Invoker arg type: ` + typeof argumentValue);
            // FIXME: support non-string argument values!
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
                }
            }
        }
        console.log('Invoker: ' + functionName + '(' + JSON.stringify(funcArgs) + ') arg count=' + funcArgs.length);
        try {
            // INVOKE the LLM function!
            const stringResult = await plugins[functionName](...funcArgs);
            console.log(`Invoker received result: ${stringResult}`);
            return stringResult;
        } catch (error) {
            console.log(`Invoker: ${error}`);
        }
    }
    return ''; // FIXME: throw exception here instead.
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
