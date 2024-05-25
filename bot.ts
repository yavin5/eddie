import { exec } from 'child_process';
import readline from 'readline';
import axios from 'axios';

// Update this path to where signal-cli is installed
const signalCliPath = '/home/jasonb/signal-cli';

// Update with the bot's phone number
const botPhoneNumber = '+13138806347';

// Update with your LLM API URL
const llmApiUrl = 'http://localhost:11434/api/chat';

// Update with your LLM model name
const llmModel = `dolphin-llama3-eddie-4:8b`;

// Add admin phone numbers
const administrators = new Set<string>(['+353830679079']);
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

// Trust all the user's keys, in case anything changed.
function trustAllKeys(recipient: string) {
    const command = `${signalCliPath} -a ${botPhoneNumber} trust -a ${recipient}`;
    console.log(command);
    exec(command);
}

// Send a message via signal-cli
function sendMessage(recipient: string, message: string): void {
    // Trust all of the user's keys before each send, otherwise the user may not see the message.
    trustAllKeys(recipient);

    const command = `${signalCliPath} -u ${botPhoneNumber} send -m "${message}" ${recipient}`;
    console.log(command);
    exec(command);
}

// Handle incoming messages
async function handleMessage(botName: string, message: any): Promise<void> {
    const envelope = message.envelope;
    //if (envelope == null) return;
    const sender = envelope.source;
    const groupId = envelope.sourceGroupId;
    const content = envelope.dataMessage?.message || '';

    if (administrators.has(sender)) {
        if (content.startsWith('/admin ')) {
            const newAdmin = content.split(' ')[1];
            administrators.add(newAdmin);
            sendMessage(sender, `Added ${newAdmin} as an administrator.`);
        } else if (content.startsWith('/ignore ')) {
            const target = content.split(' ')[1];
            ignoredUsers.add(target);
            sendMessage(sender, `Ignored ${target}.`);
        }
    }

    if (groupId) {
        // TODO: Support: "@Bot message" or "Bot: message" or "Bot message" (?)
        if (content.startsWith(botName)) {
            const response = await queryLLM(content);
            sendMessage(groupId, response);
        }
    } else {
        if (!ignoredUsers.has(sender)) {
            if (!activeChats.has(sender)) {
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
        await handleMessage(botName, receivedArray.shift());
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
        let envelope: any = { dataMessage: {} };
	// Run the receiver process to receive messages from other users.
	const command = `${signalCliPath} --trust-new-identities=always -u ${botPhoneNumber} receive --send-read-receipts -t 2`;
	//console.log(command);
	const childProcess = exec(command);
	childProcess.on('exit', async (code) => {
	    myConsole.log(`Receive exited. Total messages received: ` + receivedArray.length);
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
            console.log(`LINE: ` + line);
            // Parse signal-cli output and construct a message envelope
            if (line.startsWith('Envelope from:')) {
                const [_, source] = line.split('” ');
	        const [number, junk] = source.split(' ');
                envelope.source = number.trim();
            } else if (line.startsWith('Source group:')) {
                const [_, sourceGroupId] = line.split('Source group: ');
                envelope.sourceGroupId = sourceGroupId.trim();
            } else if (line.startsWith('Timestamp:')) {
                const [_, timestamp] = line.split('Timestamp: ');
                envelope.timestamp = parseInt(timestamp.trim(), 10);
            } else if (line.startsWith('Body:')) {
                const [_, message] = line.split('Body: ');
                envelope.dataMessage.message = message.trim();
		console.log(`Received: ` + message.trim());

                // Enqueue the text message.
		receivedArray.push({ envelope });
		console.log(`Enqueued.`);
	        envelope = { dataMessage: {} };
            }
        });

        // Sleep for a short time before receiving again.
	await new Promise((r) => setTimeout(r, 3000));

        childProcess.kill();

	console.log(`Main loop.`);
    }
}

startBot().catch(console.error);
