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

// Add admin phone numbers
const administrators = new Set<string>([process.env.EDDIE_ADMIN_0!]);
const activeChats = new Set<string>();
const ignoredUsers = new Set<string>();

// Get bot's name from the Signal profile
// This is currently broken because the bot account doesn't have itself in its contact list.
function getBotName(): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`${signalCliPath} --output=json -u ${botPhoneNumber} listContacts`, (error, stdout, stderr) => {
            if (error) {
                return reject(stderr);
            }

            try {
	        console.log(stdout);
                const contacts = JSON.parse(stdout);
		const botProfile = contacts.find((contact: any) => contact.number === botPhoneNumber);
	    	console.log("Bot's profile: ${botProfile}");
                if (botProfile && botProfile.name) {
                    resolve(botProfile.profileName);
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
	      	console.log(`Saying this to LLM: ` + content);
	        const response = await queryLLM(content);
                console.log(`Response from LLM : ` + response);
                sendMessage(groupId, response);
	    }
	}

	// Check to see if the bot's name is on the front of the message.
        if (content.toLowerCase().startsWith(botName.toLowerCase())) {
            console.log(`Saying this to LLM: ` + content);
            const response = await queryLLM(content);
            console.log(`Response from LLM : ` + response);
            sendMessage(groupId, response);
        }
    } else {
        // NOT a group message.
        if (!ignoredUsers.has(sender) && !ignoredUsers.has(senderUuid))  {
            if (!activeChats.has(sender) && !activeChats.has(senderUuid)) {
                sendMessage(sender, `Hello! I'm ${botName}. How can I assist you today?`);
                activeChats.add(sender);
            } else {
	      	console.log(`Saying this to LLM: ` + content);
                const response = await queryLLM(content);
                console.log(`Response from LLM : ` + response);
                sendMessage(sender, response);
            }
        }
    }
}

// Query the local LLM runtime
async function queryLLM(message: string): Promise<string> {
    try {
        const model = llmModel;
        const response = await axios.post(llmApiUrl, { model: model, messages: [ { "role": "user", "content": message } ], stream: false });
	//console.log(response); // Uncomment this to see the HTTP response.
	console.log(`response.data.message.content: '` + response.data.message.content + `'`);
        return response.data.message.content;
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
    //const botName = await getBotName();
    const botName = `Eddie`;
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
