import { exec } from 'child_process';
import readline from 'readline';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

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

    if (administrators.has(sender)) {
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
                if (!idToConversationContextMap[groupId]) {
                    idToConversationContextMap[groupId] = { chatMessages: [] };
                }
                console.log(`Saying this to LLM: ` + content);
                const response = await queryLLM(content, groupId);
                console.log(`Response from LLM : ` + response);
                sendMessage(groupId, response);
            }
        }

        // Check to see if the bot's name is on the front of the message,
        // or @BotName (a plain text mention) is in the message somewhere.
        if (content.toLowerCase().startsWith(botName.toLowerCase()) ||
            content.toLowerCase().includes('@' + botName.toLowerCase())) {
            if (!idToConversationContextMap[groupId]) {
                idToConversationContextMap[groupId] = { chatMessages: [] };
            }
            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM(content, groupId);
            console.log(`Response from LLM : ` + response);
            sendMessage(groupId, response);
        }
    } else {
        // NOT a group message.
        if (!ignoredUsers.has(sender) && !ignoredUsers.has(senderUuid)) {
            if (!idToConversationContextMap[senderUuid]) {
                idToConversationContextMap[senderUuid] = { chatMessages: [] };
            }
            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM(content, senderUuid);
            console.log(`Response from LLM : ` + response);
            sendMessage(sender, response);
        }
    }
}

function pruneChatMessages(messages: ChatMessage[]): ChatMessage[] {
    // Function to calculate the total size in bytes of the content strings
    const calculateTotalSize = (msgs: ChatMessage[]): number => {
        return msgs.reduce((acc, msg) => acc + new TextEncoder().encode(msg.content).length, 0);
    };

    // Start from the end of the array and add messages until we exceed max size
    let totalSize = 0;
    const prunedMessages: ChatMessage[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const messageSize = new TextEncoder().encode(messages[i].content).length;
        if (totalSize + messageSize <= llmModelContextSize) {
            prunedMessages.unshift(messages[i]);
            totalSize += messageSize;
        } else {
            break;
        }
    }

    return prunedMessages;
}

// Query the local LLM runtime
async function queryLLM(message: string, conversationId: string): Promise<string> {
    try {
        const model = llmModel;

        // Look up the ConversationContext by its conversation ID (sender UUID or group ID).
        const conversationContext = idToConversationContextMap[conversationId];
        if (conversationContext.chatMessages === null) {
            conversationContext.chatMessages = [];
        }

        // Add the user's message to the conversation context
        conversationContext.chatMessages.push({ role: 'user', content: message, images: [] });
        conversationContext.chatMessages = pruneChatMessages(conversationContext.chatMessages);

        const response = await axios.post(llmApiUrl, { model: model, messages: conversationContext.chatMessages, stream: false });
        let stringResponse = response.data.message.content;
        stringResponse = stringResponse.replace(/(["$`\\])/g,'\\$1');

        // Add the LLM's response to the conversation context
        conversationContext.chatMessages.push({ role: 'assistant', content: stringResponse, images: [] });
        console.log('Context now has ' + conversationContext.chatMessages.length + ' messsages.');

        //console.log(response); // Uncomment this to see the HTTP response.
        console.log(`stringResponse: '` + stringResponse + `'`);
        return stringResponse;
    } catch (error) {
        console.error('Error querying LLM:', error);
        return 'Sorry, I am unable to process your request right now.';
    }
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

                processQueuedMessages(botName, receivedArray);
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
