## Eddie Bot

Eddie is an AI chatbot that talks over instant messaging, primarily Signal messenger.  Eddie relays messages to an AI model over an OpenAPI-compatible REST API, such as the local one provided by Ollama, and then relays the AI model's reply back to the user over instant messaging.

### Technology Stack

- Typescript
- Nodejs
- Java
- signal-cli
- axios
- ollama
- dolphin-llama3:8b AI base model
- Signal
- Fedora Linux

### Signal messenger

For now, Eddie only knows how to talk over Signal messenger.

##### Account Initialization

     ~/signal-cli -a +13130806347 register # Try first without a captcha code.
     # https://github.com/AsamK/signal-cli/wiki/Registration-with-captcha
     ~/signal-cli -a +13130806347 register --captcha signalcaptcha://signal-hcaptcha.5fad97ac-7d06-4e44-b18a-b950b20148ff.registration.P1_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.hadwYXNza2V5xQUVRQlnTalDBGZoFOKW08jXmQSPlqBXgSSR3tSEbrqSoIzTRYtKlzJkdbmLRyKP8e_sBhh1DeqZNK6vX75yfYyme_lKDZs_BYffdfZHWDemFFlDED83Aub_8KDOmy91HAvtbyG56XeayDNI0UWEevhez2Fn8j9p5XPtibY6ZU1HIUUoyks3RusLjhTGC-LpXuyJ2M92Mnetv5GFQTXNNTNTsQHzDjOM3ykxhoPdakmcPdY0NsXf9Hw01e5Ewv3YQItK6p412vJs-jcM5LMsfr59z8T6RMkT6vy-DZygbMy1u_U-19wjXepISMi6LfoMEoon9FyXeU0lKGIxaYg2kiPKmYNtfCJ9P5a_VaFqm1o9b1ALtUc02v-nb3J568ggn1tPBazwc45wY7bZbfF3S166pOOI_MdruHIKqfTczJjtEp-k8v-5AEurjrKoM78kYEOQnBfaTx3Prt2Ow-NfGyHRTgRIVqUu0KyJ3HlBOyyF43Hsa0LpfnjDTW86QjNgQ9G7h97axaBF0ItiAPtDkaCvdbzYti-w1rM9JLUJpbpOdPs4Qx0OAn6jtvVDkwm_VFCELzC06ul6UaA0cHrYIlFDXO2TKDYrwk1pXpjW9OKZlCahqNr8ZE-MGB5Kjpbp_rbiyeU6TR0ahhLA7Jm9CZCvXzJIe1yNyUAbPVx9fzh1KEe4eBJMaQ6OMB6u9eOLZRutaRKZL6pT7aYThq80SKrSaydupxX7g6UT8JT67jTT3xhfcf0gn_cVUCp5Fev-qMovMPV-PLWNTCHMbRWo4UK73PwUjpTeE1p2vIsH4uFg_F6QbmcVkeuYMH2ebsuEigbW8n4kg2lJYBbcD9zvCfLw-5ttWqGevP5VbgncuufW9-vpPtEePfHJLIiv11oJIav_8lmW3mDpVoUtKRRlm8Ela8vcejYjnhXYFmXfJaXnNbGxGGdp5smVk4FJmpZAX-_yU3pvYw4N7WpCBTucqv5HnIkKoZahlB4797kOzpfafkFvVtaJZPHfE9FRMbgQgkLAwln9HLHDG7KdAWwK3PVZlQuFoNyJsgn280aXMjV4Kaug2XyCXHTDEdWSlEwV1Rfp6KDiBtgoFaIGiqSIA0qOrziEGBBgBcW_wHHcmwuPCupgSmj3rMTN08y7fY7LeoOZ0W-m6V1tyvle0nI3sLi_IwJ_bWWgBlq7LndLQb8R2Q6xlwYI-5ubvzWF7oWby_fPxnhkah13VssxUAspf3hrJUn0QBCgBXBJzqoCaNj3XNv2fjKhKPSFtUsqjgVPf7RUlRM42V2eMDz2k7ZxjG01UgYc4UVxK6BLfe1SSE2Inp9BIDGPWe2YdT2fpYHH8Kbxnysg6QGb_aso55ZYKiQnR5X_OjvVAqjc6W6ExeSL3zPUHvOZV0Ng8jsjJI97dnv3qcLj8hXJDPjRgWleylXcXHmEMAAjK5Dc4DNDZYx2LKPiVvxMaS55iC0Ors70JcRCq8MJYEB-9Tr3e4wUHKEcdxGlQJsLthM7v0dTABScir8UbrZJp2au9bbRs2tgQXowloVq86sj-53r8BGVM4u-W6u6JemUC6LsKlzhm7pVhpf9q8soZmGeLHgnvtpAA-H7hcWqehonqS2IDcX3OTSxAmILIJLnUoufIQCMqzrOrZV-TnBr1OgZodgHIlPnjmeVwaHvOuU54wtBF1fr9LOdQxxu2jwltEgvo7ajCA8JiUpb4rFVzidOzhTOGWlnEzdl2hJ-_gOjZXhwzmZPvYOoc2hhcmRfaWTOBEclkaJrcqdmY2M2MTVlonBkAA.qhNaD3i_tlfRwrJzOXE9AEkHhJn2qH0prXpEzFLW1tU
     ~/signal-cli -a +13130806347 verify 546869 # Code received over SMS
     ~/signal-cli -a +13130806347 setPin 1234
     ~/signal-cli -a +13130806347 updateAccount --username Eddie.4242
     ~/signal-cli -a +13130806347 updateAccount --unrestricted-unidentified-sender true
     ~/signal-cli -a +13130806347 updateAccount --discoverable-by-number true
     ~/signal-cli -a +13130806347 updateAccount --number-sharing false
     ~/signal-cli -a +13130806347 updateProfile --given-name Eddie
     ~/signal-cli -a +13130806347 updateProfile --about 'A private Alternate Intelligence (AI), shipboard computer of the Heart of Gold.'
     ~/signal-cli -a +13130806347 updateProfile --avatar ./dont-panic-1.jpeg 

##### Talking with Users

     ~/signal-cli -a +13130806347 receive --send-read-receipts
     ~/signal-cli -a +13130806347 trust -a +353800679079
     ~/signal-cli -a +13130806347 send -m 'Dont Panic!' --u yavin.05

Individual user message:

{"envelope":{"source":"+353800679079","sourceNumber":"+353800679079","sourceUuid":"c5217511-a792-476b-93c2-0e51b75e272d","sourceName":".","sourceDevice":2,"timestamp":1716657246853,"typingMessage":{"action":"STARTED","timestamp":1716657246853}},"account":"+13130806347"}

.. and then:

{"envelope":{"source":"+353800679079","sourceNumber":"+353800679079","sourceUuid":"c5217511-a792-476b-93c2-0e51b75e272d","sourceName":".","sourceDevice":2,"timestamp":1716657247436,"dataMessage":{"timestamp":1716657247436,"message":"Hi Eddie.. what's going on?","expiresInSeconds":0,"viewOnce":false}},"account":"+13130806347"}

##### Inspecting Users

~/signal-cli --output=json -u +13130806347 listContacts

```json
[{
    "number": "+353800679079",
    "uuid": "c5217511-a792-476b-93c2-0e51b75e272d",
    "username": "yavin.05",
    "name": "",
    "givenName": null,
    "familyName": null,
    "nickName": null,
    "nickGivenName": null,
    "nickFamilyName": null,
    "note": null,
    "color": null,
    "isBlocked": false,
    "isHidden": false,
    "messageExpirationTime": 0,
    "profileSharing": true,
    "unregistered": false,
    "profile": {
      "lastUpdateTimestamp": 1716622459843,
      "givenName": ".",
      "familyName": null,
      "about": "",
      "aboutEmoji": "",
      "hasAvatar": false,
      "mobileCoinAddress": null
    }
  },{
    "number": null,
    "uuid": "89daf2c4-afc9-4a42-b32b-6b3f6d429913",
    "username": null,
    "name": "",
    "givenName": null,
    "familyName": null,
    "nickName": null,
    "nickGivenName": null,
    "nickFamilyName": null,
    "note": null,
    "color": null,
    "isBlocked": false,
    "isHidden": false,
    "messageExpirationTime": 0,
    "profileSharing": true,
    "unregistered": false,
    "profile": {
      "lastUpdateTimestamp": 1716575025807,
      "givenName": "Neuma",
      "familyName": null,
      "about": "",
      "aboutEmoji": "",
      "hasAvatar": false,
      "mobileCoinAddress": null
    }
}]
```

##### Interacting with Groups

Group Invites:

{"envelope":{"source":"2c9cf595-6cf7-495a-96b3-282984149f6a","sourceNumber":null,"sourceUuid":"2c9cf595-6cf7-495a-96b3-282984149f6a","sourceName":"OAK","sourceDevice":1,"timestamp":1716660192680,"dataMessage":{"timestamp":1716660192680,"message":null,"expiresInSeconds":2419200,"viewOnce":false,"groupInfo":{"groupId":"wL3zRZV1Y6r0AqI1w2OZ4qoiJeLyPiAFDkXibpEau5U=","type":"UPDATE"}}},"account":"+13130806347"}

Joining a group:

~/signal-cli -u +13130806347 joinGroup --uri 'https://signal.group/#CjQKIB6QhO72WaVbqOm-IwDD1PL4g0P5jG7iAoaBOmuyYuazEhDNietcJ6WKynVxYaOiZaYb'

Listing Groups:

~/signal-cli -u +13130806347 listGroups

Id: iJKEHTR4z5S21uj9bHmKsMG0w5wRuA37SnJTCILfypM= Name: Eddie Test Group  Active: true Blocked: false

~/signal-cli -u +13130806347 --output=json listGroups

[{"id":"iJKEHTR4z5S21uj9bHmKsMG0w5wRuA37SnJTCILfypM=","name":"Eddie Test Group","description":"","isMember":true,"isBlocked":false,"messageExpirationTime":0,"members":[{"number":"+353800679079","uuid":"c5217511-a792-476b-93c2-0e51b75e272d"},{"number":"+13130806347","uuid":"89553559-0c35-4392-a717-61af37188764"}],"pendingMembers":[],"requestingMembers":[],"admins":[{"number":"+353800679079","uuid":"c5217511-a792-476b-93c2-0e51b75e272d"}],"banned":[],"permissionAddMember":"EVERY_MEMBER","permissionEditDetails":"EVERY_MEMBER","permissionSendMessage":"EVERY_MEMBER","groupInviteLink":null}]

Being added to a group:

Envelope from: “.” +353800679079 (device: 1) to +13130806347
Timestamp: 1716626904247 (2024-05-25T08:48:24.247Z)
Server timestamps: received: 1716626904973 (2024-05-25T08:48:24.973Z) delivered: 1716627590247 (2024-05-25T08:59:50.247Z)
Sent by unidentified/sealed sender
Message timestamp: 1716626904247 (2024-05-25T08:48:24.247Z)
Group info:
  Id: iJKEHTR4z5S21uj9bHmKsMG0w5wRuA37SnJTCILfypM=
  Name: Eddie Test Group
  Revision: 0
  Type: DELIVER

{"envelope":{"source":"+353800679079","sourceNumber":"+353800679079","sourceUuid":"c5217511-a792-476b-93c2-0e51b75e272d","sourceName":".","sourceDevice":2,"timestamp":1716681307395,"dataMessage":{"timestamp":1716681307395,"message":null,"expiresInSeconds":0,"viewOnce":false,"groupInfo":{"groupId":"EBWTZ+GLaY1MyltBLUeDhCLZKm4skCuAg0+8lep4Rqo=","type":"UPDATE"}}},"account":"+13130806347"}
Enqueued.

Group revision / update:

Envelope from: “.” +353800679079 (device: 1) to +13130806347
Timestamp: 1716627255459 (2024-05-25T08:54:15.459Z)
Server timestamps: received: 1716627256196 (2024-05-25T08:54:16.196Z) delivered: 1716627590247 (2024-05-25T08:59:50.247Z)
Sent by unidentified/sealed sender
Message timestamp: 1716627255459 (2024-05-25T08:54:15.459Z)
Group info:
  Id: iJKEHTR4z5S21uj9bHmKsMG0w5wRuA37SnJTCILfypM=
  Name: Eddie Test Group
  Revision: 1
  Type: UPDATE

Group message:

Envelope from: “.” +353800679079 (device: 1) to +13130806347
Timestamp: 1716627274592 (2024-05-25T08:54:34.592Z)
Server timestamps: received: 1716627275367 (2024-05-25T08:54:35.367Z) delivered: 1716627590248 (2024-05-25T08:59:50.248Z)
Sent by unidentified/sealed sender
Message timestamp: 1716627274592 (2024-05-25T08:54:34.592Z)
Body: Hi guys
Group info:
  Id: iJKEHTR4z5S21uj9bHmKsMG0w5wRuA37SnJTCILfypM=
  Name: Eddie Test Group
  Revision: 1
  Type: DELIVER
With profile key

Group message with @User mention:

Envelope from: “.” +353800679079 (device: 1) to +13130806347
Timestamp: 1716630436625 (2024-05-25T09:47:16.625Z)
Server timestamps: received: 1716630436871 (2024-05-25T09:47:16.871Z) delivered: 1716630436873 (2024-05-25T09:47:16.873Z)
Sent by unidentified/sealed sender
Message timestamp: 1716630436625 (2024-05-25T09:47:16.625Z)
Body: ￼ Tell me about your mother.
Group info:
  Id: iJKEHTR4z5S21uj9bHmKsMG0w5wRuA37SnJTCILfypM=
  Name: Eddie Test Group
  Revision: 1
  Type: DELIVER
With profile key
Mentions:
- “Eddie” +13130806347: 0 (length: 1)

.. also in JSON format..

{"envelope":{"source":"+353800679079","sourceNumber":"+353800679079","sourceUuid":"c5217511-a792-476b-93c2-0e51b75e272d","sourceName":".","sourceDevice":1,"timestamp":1716632242481,"dataMessage":{"timestamp":1716632242481,"message":"￼ I'd like to tell you something.","expiresInSeconds":0,"viewOnce":false,"mentions":[{"name":"+13130806347","number":"+13130806347","uuid":"89553559-0c35-4392-a717-61af37188764","start":0,"length":1}],"groupInfo":{"groupId":"iJKEHTR4z5S21uj9bHmKsMG0w5wRuA37SnJTCILfypM=","type":"DELIVER"}}},"account":"+13130806347"}

Thumbsup emoji placed on a group message (copy and paste this message into the shell and the emoji shows up):

{"envelope":{"source":"a113ebd8-cb2e-4ead-9e17-a3ed46011cdf","sourceNumber":null,"sourceUuid":"a113ebd8-cb2e-4ead-9e17-a3ed46011cdf","sourceName":"Chad B","sourceDevice":1,"timestamp":1716663714103,"dataMessage":{"timestamp":1716663714103,"message":null,"expiresInSeconds":2419200,"viewOnce":false,"reaction":{"emoji":"👍","targetAuthor":"+353800679079","targetAuthorNumber":"+353800679079","targetAuthorUuid":"c5217511-a792-476b-93c2-0e51b75e272d","targetSentTimestamp":1716663645456,"isRemove":false},"groupInfo":{"groupId":"wL3zRZV1Y6r0AqI1w2OZ4qoiJeLyPiAFDkXibpEau5U=","type":"DELIVER"}}},"account":"+13130806347"}

##### Receive Loop

$ ~/signal-cli -a +13130806347 receive --send-read-receipts -t -1
Envelope from: “.” +353800679079 (device: 1) to +13130806347
Timestamp: 1716527899762 (2024-05-24T05:18:19.762Z)
Server timestamps: received: 1716527900319 (2024-05-24T05:18:20.319Z) delivered: 1716527900320 (2024-05-24T05:18:20.320Z)
Sent by unidentified/sealed sender
Received a typing message
  Action: STARTED
  Timestamp: 1716527899762 (2024-05-24T05:18:19.762Z)

Envelope from: “.” +353800679079 (device: 1) to +13130806347
Timestamp: 1716527903585 (2024-05-24T05:18:23.585Z)
Server timestamps: received: 1716527904174 (2024-05-24T05:18:24.174Z) delivered: 1716527904176 (2024-05-24T05:18:24.176Z)
Sent by unidentified/sealed sender
Received a typing message
  Action: STOPPED
  Timestamp: 1716527903585 (2024-05-24T05:18:23.585Z)

Envelope from: “.” +353800679079 (device: 1) to +13130806347
Timestamp: 1716527918341 (2024-05-24T05:18:38.341Z)
Server timestamps: received: 1716527918929 (2024-05-24T05:18:38.929Z) delivered: 1716527918930 (2024-05-24T05:18:38.930Z)
Sent by unidentified/sealed sender
Message timestamp: 1716527918341 (2024-05-24T05:18:38.341Z)
Body: Test
With profile key

Envelope from: “Neuma” 88daf2ce-afe9-6342-c32d-6b3f6d389913 (device: 1) to +13130806347
Timestamp: 1716584893340 (2024-05-24T21:08:13.340Z)
Server timestamps: received: 1716584893855 (2024-05-24T21:08:13.855Z) delivered: 1716584893857 (2024-05-24T21:08:13.857Z)
Sent by unidentified/sealed sender
Message timestamp: 1716584893340 (2024-05-24T21:08:13.340Z)
Body: Pode dar-me orientação para começar a estudar inglês 

Envelope from: “Neuma” 88daf2ce-afe9-6342-c32d-6b3f6d389913 (device: 1) to +13130806347
Timestamp: 1716584868466 (2024-05-24T21:07:48.466Z)
Server timestamps: received: 1716584870348 (2024-05-24T21:07:50.348Z) delivered: 1716584872005 (2024-05-24T21:07:52.005Z)
Sent by unidentified/sealed sender
Message timestamp: 1716584868466 (2024-05-24T21:07:48.466Z)
With profile key
Attachments:
- Attachment:
  Content-Type: image/jpeg
  Type: Pointer
  Id: YKqFKOavzrzxtZHo9D5g.jpg
  Upload timestamp: 1716584869096 (2024-05-24T21:07:49.096Z)
  Size: 28358 bytes
  Dimensions: 900x1600
  Stored plaintext in: /home/jasonb/.local/share/signal-cli/attachments/YKqFKOavzrzxtZHo9D5g.jpg

##### signal-cli Documentation and Links

signal-cli Manual Page
https://github.com/AsamK/signal-cli/blob/master/man/signal-cli.1.adoc

signal-cli-jsonrpc Manual Page
https://github.com/AsamK/signal-cli/blob/master/man/signal-cli-jsonrpc.5.adoc

signal-cli-dbus Manual Page
https://github.com/AsamK/signal-cli/blob/master/man/signal-cli-dbus.5.adoc

### Server Setup

We chose Fedora 39 Linux.

#### Installing NodeJS and Typescript

     # dnf install -y nodejs typescript
     Installed:
       nodejs-1:20.12.2-1.fc39.x86_64
       nodejs-cjs-module-lexer-1.2.3-2.fc39.noarch
       nodejs-docs-1:20.12.2-1.fc39.noarch
       nodejs-full-i18n-1:20.12.2-1.fc39.x86_64
       nodejs-libs-1:20.12.2-1.fc39.x86_64
       nodejs-npm-1:10.5.0-1.20.12.2.1.fc39.x86_64
       nodejs-undici-6.11.1-2.fc39.noarch
       typescript-5.1.3-2.fc39.noarch

Here's what the node command looks like:

     # which node
     /usr/bin/node
     # node --version
     v20.12.2

#### Project Initialization

Create a repository on a git infrastructure site such as Github or Gitlab.

     $ mkdir ~/git
     $ cd git
     $ git clone git@github.com:yavin5/eddie.git
     $ cd eddie

Initialize a Node.js / Typescript Project:

     $ npm init -y
     $ npm install typescript @types/node
     $ npm install child_process readline axios
     $ npx tsc --init
     $ npm install ts-node

     Created a new tsconfig.json with:

     target: es2016
     module: commonjs
     strict: true
     esModuleInterop: true
     skipLibCheck: true
     forceConsistentCasingInFileNames: true

     You can learn more at https://aka.ms/tsconfig

#### Notes / additional ideas

- Admins should be able to also ask for the current list of admins.
- There should be a server log file, done the way it should be on Linux.
- Admins should be able to trigger an outage with a message to show to users.
- Plugins.


### Bot Software

The bot software is mostly generated by AI LLMs.

#### AI Code Generation Try #2..

- Generated by: GPT-4o on Poe

> Please write me a long-running LLM AI bot for Signal messenger by wrapping the signal-cli command with Typescript code. It needs to do the following: 1) It needs to have a configurable list of administrators to start with who are the only users who can command its use of Signal. 2) It needs to allow only the administrators to message it over Signal to add another administrator by Signal username. Example command message: "/admin Woz:1234" 3) It needs to allow unsolicited private messages, and it should introduce itself to the user and chat with them. 3) An administrator can tell the bot to stop talking to a specific user. Example: "/ignore Woz:1234" 4) Only administrators can successfully join the bot to a group.  5) When chatting in a group, first introduce itself by saying only "Hi guys!", and only respond to messages prefixed with the name of the bot in the channel. 6) The name of the bot should be auto-inferred from the first name field of the bot's Signal account profile. 7) All other messages should be sent to a local ollama LLM runtime as a chat message, and the response should be sent back over Signal as the response.

Create the Bot Script: Create a `bot.ts` file for the main bot logic:

```typescript
import { exec } from 'child_process';
import readline from 'readline';
import axios from 'axios';

// Update this path to where signal-cli is installed
const signalCliPath = '/home/jasonb/signal-cli';

// Update with the bot's phone number
const botPhoneNumber = '+13130806347';

// Update with your LLM API URL
const llmApiUrl = 'http://localhost:11434/api/chat';

// Add admin phone numbers
const administrators = new Set<string>(['+353800679079']);
const activeChats = new Set<string>();
const ignoredUsers = new Set<string>();

// Get bot's name from the Signal profile
function getBotName(): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`${signalCliPath} -u ${botPhoneNumber} listContacts`, (error, stdout, stderr) => {
            if (error) {
                return reject(stderr);
            }

            try {
                const contacts = JSON.parse(stdout);
                const botProfile = contacts.find((contact: any) => contact.number === botPhoneNumber);
                if (botProfile && botProfile.name) {
                    resolve(botProfile.name);
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
    exec(`${signalCliPath} -u ${botPhoneNumber} send -m "${message}" ${recipient}`);
}

// Handle incoming messages
async function handleMessage(botName: string, message: any): Promise<void> {
    const { envelope } = message;
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
                const response = await queryLLM(content);
                sendMessage(sender, response);
            }
        }
    }
}

// Query the local LLM runtime
async function queryLLM(message: string): Promise<string> {
    try {
        const response = await axios.post(llmApiUrl, { message });
        return response.data.response;
    } catch (error) {
        console.error('Error querying LLM:', error);
        return 'Sorry, I am unable to process your request right now.';
    }
}

// Parse signal-cli output and construct a message envelope
function parseSignalCliOutput(output: string): any {
    const lines = output.split('\n');
    let envelope: any = { dataMessage: {} };

    for (const line of lines) {
        if (line.startsWith('Envelope from:')) {
            const [_, source] = line.split('Envelope from: ');
            envelope.source = source.trim();
        } else if (line.startsWith('Source group:')) {
            const [_, sourceGroupId] = line.split('Source group: ');
            envelope.sourceGroupId = sourceGroupId.trim();
        } else if (line.startsWith('Timestamp:')) {
            const [_, timestamp] = line.split('Timestamp: ');
            envelope.timestamp = parseInt(timestamp.trim(), 10);
        } else if (line.startsWith('Message:')) {
            const [_, message] = line.split('Message: ');
            envelope.dataMessage.message = message.trim();
        }
    }
    return { envelope };
}

// Start the bot
async function startBot() {
    const botName = await getBotName();
    console.log(`Bot name is: ${botName}`);

    const rl = readline.createInterface({
        input: exec(`${signalCliPath} -u ${botPhoneNumber} receive`).stdout!,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', async (line) => {
        const message = parseSignalCliOutput(line);
        await handleMessage(botName, message);
    });
}

startBot().catch(console.error);
```

##### Linux Daemon

- Create a shell user to run the server as.. named something like `eddieuser`.
- Clone the eddie bot source repository into that user's home directory.
- Run the following command as the root user in order to run the bot as a daemon:
     runuser -s /bin/bash - eddieuser -c "cd /home/eddieuser/git/eddie; npm start" &>>eddie.log &
		    
#### AI Code Generation Try Number 1..

- Generated by: GPT-4o on Poe
> Please write me a long-running LLM AI bot for Signal messenger by wrapping the signal-cli command with Typescript code. It needs to do the following: 1) It needs to have a configurable list of administrators who are the only users who can command its use of Signal. 2) It needs to allow unsolicited private messages, and it should introduce itself to the user and chat with them. 3) An administrator can tell the bot to stop talking to specific users. 4) An administrator can tell the bot to join or leave a group. 5) When chatting in a group, introduce itself by saying only "Hi guys!", and only respond to messages prefixed with the name of the bot in the channel. 5) The name of the bot should be auto-inferred from the first name field of the bot's Signal account profile.

Initialize a Node.js / Typescript Project:

     $ mkdir eddie
     $ cd eddie
     $ npm init -y
     $ npm install typescript @types/node
     $ npm install child_process readline
     $ npx tsc --init

Create the Bot Script: Create a `bot.ts` file for the main bot logic:

```typescript
import { exec } from 'child_process';
import readline from 'readline';

const signalCliPath = '/path/to/signal-cli';  // Update this path to where signal-cli is installed
const botPhoneNumber = '+1234567890';         // Update with the bot's phone number

const administrators = new Set<string>(['+admin1', '+admin2']);  // Add admin phone numbers
const activeChats = new Set<string>();

// Get bot's name from the Signal profile
function getBotName(): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`${signalCliPath} -u ${botPhoneNumber} getProfile`, (error, stdout, stderr) => {
            if (error) {
                return reject(stderr);
            }
            const profile = JSON.parse(stdout);
            resolve(profile.firstName || 'Bot');
        });
    });
}

// Send a message via signal-cli
function sendMessage(recipient: string, message: string): void {
    exec(`${signalCliPath} -u ${botPhoneNumber} send -m "${message}" ${recipient}`);
}

// Handle incoming messages
function handleMessage(botName: string, message: any): void {
    const { envelope } = message;
    const sender = envelope.source;
    const groupId = envelope.sourceGroupId;
    const content = envelope.dataMessage?.message || '';

    if (administrators.has(sender)) {
        if (content.startsWith('!stop ')) {
            const target = content.split(' ')[1];
            activeChats.delete(target);
            sendMessage(sender, `Stopped chatting with ${target}`);
        } else if (content.startsWith('!join ')) {
            const group = content.split(' ')[1];
            exec(`${signalCliPath} -u ${botPhoneNumber} updateGroup --add ${botPhoneNumber} ${group}`);
            sendMessage(sender, `Joined group ${group}`);
        } else if (content.startsWith('!leave ')) {
            const group = content.split(' ')[1];
            exec(`${signalCliPath} -u ${botPhoneNumber} updateGroup --remove ${botPhoneNumber} ${group}`);
            sendMessage(sender, `Left group ${group}`);
        }
    } else if (groupId) {
        if (content.startsWith(botName)) {
            const response = `Hi ${sender}, you mentioned me in the group!`;
            sendMessage(groupId, response);
        }
    } else {
        if (!activeChats.has(sender)) {
            sendMessage(sender, `Hello! I'm ${botName}. How can I assist you today?`);
            activeChats.add(sender);
        } else {
            const response = `You said: ${content}`;
            sendMessage(sender, response);
        }
    }
}

// Start the bot
async function startBot() {
    const botName = await getBotName();
    console.log(`Bot name is: ${botName}`);

    const rl = readline.createInterface({
        input: exec(`${signalCliPath} -u ${botPhoneNumber} receive`).stdout!,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', (line) => {
        const message = JSON.parse(line);
        handleMessage(botName, message);
    });
}

startBot().catch(console.error);
```

### Links

signal-cli manpage
https://github.com/AsamK/signal-cli/blob/master/man/signal-cli.1.adoc

AsamK / signal-cli: A command line interface to operate a Signal client library.  Written in Java and rust, GPL v3 License.  This can be the base layer of Signal bots.  Recommended by GPT-4o on Poe.
https://github.com/AsamK/signal-cli

signal-cli-rest-api: This project doesn't use it, but it looks nice.
https://bbernhard.github.io/signal-cli-rest-api/

NodeJS Docs: child_process
https://nodejs.org/api/child_process.html#class-childprocess
https://nodejs.org/api/child_process.html#subprocesskillsignal

NodeJS Docs: readline.createInterface
https://nodejs.org/api/readline.html#readlinepromisescreateinterfaceoptions
