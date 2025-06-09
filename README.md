## Eddie Bot

Eddie is an AI chatbot that talks over instant messaging, primarily Signal messenger.  Eddie relays messages to an AI model over an OpenAPI-compatible REST API, such as the local one provided by Ollama, and then relays the AI model's reply back to the user over instant messaging.

### Features

- Multiple separate contact private chats.
- Multiple group chats.
- Separate AI chat context per group and per private chat.
- Able to answer or discuss about recent content outside the scope of the LLM's model by web searching and web scraping.
- Bot / LLM plugin framework.  Includes a web scrape plugin.
- Administrator users with admin commands (WIP)
- Works with Ollama AI runtime and Ollama API

### Technology Stack

- Typescript 5.1.x
- Nodejs 20.12.2
- Java 17.0.9
- signal-cli 0.13.3+
- axios
- ollama 0.1.44+
- Fedora Linux
- Signal client on desktop or mobile

### Web Scrape Mode / Just-in-time Web Search

Eddie's code can decide when function calls are necessary to answer the user's question:
1. Normally Eddie is in answer-only-from-memory mode.
2. User says something (sends a query to Eddie).
3. Eddie's code decides if it matches words such as:
   - search
   - price
   - market cap / market capitalization
   - news
   - recent
   - current
   - up to date / up-to-date
   - today / today's
   - soon
   - upcoming
   - yesterday / yesterday's
   - this week / this week's
   - this month / this month's
   - this year / this year's
   - google it / google that / google for / ...
   - read|get the website|page
   - list -- also with the word -- crypto
   - list -- also with the word -- nft
   - list -- also with the word -- token
   - list -- also with the word -- stock
   - numbers -- also with the word -- crypto
   - numbers -- also with the word -- nft
   - numbers -- also with the word -- token
   - numbers -- also with the word -- stock
   - numbers -- also with the word -- supply
   - dollar
   - total supply
   - circulating supply
   - remaining supply
   - 
   ... and if so, begin web scrape mode. Send the user's text to the LLM with
   a function calling system prompt.  Else no additional system prompt.
4. LLM responds with function-call to an LLM function to get info from the web.
5. Eddie's code responds with function-response, along with up to date info.
6. When the LLM response returns, Eddie's code sends the response to the user, then deletes the LLM function calling system prompt from the message context, and ends web mode.

Beginning and ending web mode happens when the user says one of the above words or phrases, and ends when the LLM responds with something that is not a function call, or when the LLM exceeds its allowed number of function calls it may make in order to answer one user query.

The above procedure works well for some open source models (deepseek coder 2 128K, qwen2 7b 128K), so I didn't need to resort to three shot prompting, which would have cost more context space.

#### TODO : Upcoming code changes

- Limit Signal response sends to 2000 chars.
- QWQ refuses to answer political questions: "Sorry, but I can't answer that question. As an AI language model, it's important for me to stay neutral and 
not engage in political discussions or predictions about future events."
- QWQ refuses to give financial / investment advice: "I cannot provide information on which specific cryptocurrencies you should invest in. It is important to do your own research and consult with a financial advisor before making any investment decisions. Additionally, I am programmed to follow ethical guidelines and not promote or encourage investments without proper caution."
- Format the context and query just like a RAG prompt. Because otherwise the LLM doesn't really know what it's doing with all that info.
- Major feature: Add RAG capability.
- Major feature: COT Reasoning prompts / jobs.  Each one of these would take longer, use several times the regular compute, and needs a job ID and job control.
  * Add code to display current status of a numbered job, and have the code continually update that status when possible.
  * Add a new command /stop <jobNumber> and also allow the user to place an emoji on the status to stop the job, maybe also a text reply on the status message of "stop".  Who can stop it?  The user who started it, or any admin user.
- When the LLM is generating JSON with a message or reason text field, make sure that text field is the first field that the LLM generates, or else it is useless due to predicting next characters / words.
- Add a date and time function call.
- If after a function call Eddie responds with {"role":"assistant","content":"something..."}(*throwaway chars after this) then peel the JSON off that and just say the content value. This happens with LLama3.1.
- If in web scrape mode and the LLM answers with something that isn't a function-call message (a bad choice -- lazy LLM syndrome), the code should retry the LLM query some number of times. Make the number of retries a configuration setting.
- Add a cryptocurrency plugin, calling cctx. https://github.com/ccxt/ccxt
- Add a new JSDoc tag named @llmFunctionCallMaxPerQuery <number> The purpose: The LLM may call the function this number of times, max, per user query.
- Add a new JSDoc tag named @llmFunctionCallMaxRetries <number> The purpose: If the LLM is calling the function and the function errors, this sets how many times may Eddie's code retry the function call, max, per user query.
- New LLM plugin: cryptocurrencyPlugin.ts - Uses cctx for price and info feeds.
- Need to detect the conversation context language, then make sure that
  the current language is passed into searchWeb and httpGet, and used.
- Add regex examples to function call schema so the LLM has concrete examples.
- Document the plugin API.
- Web scrape mode trigger words and phrase regexes should actually be in configs
- A way for a plugin to add slash commands that call its own functions.
- Admins should be able to make Eddie say whatever they want to which contact or channel, or @everyone.
- Admins should be able to also ask for the current list of admins.
- There should be a server log file, done the way it should be on Linux.
- Admins should be able to trigger an outage with a message to show to users.
- Add a /version command.  Init a version string constant at the top, potentially dotenv configurable.

#### Done, Implemented Changes

- Adjusted context size in bytes, allow user to config context size in *tokens*.
- Rewrites LLM-written deepseek XML code snippets that represent function calls.
  This is for deepseek coder 2 models.
- Rewrites LLM-written python code snippets that represent function calls.  This is for qwen2 and potentially llama3 models.
- Added a /help command to show the list of supported commands.
- Added a /clear command for clearing the bot's context for the current chat.
- In the case of a web scraper function call error (404, 5xx, whatever), returns a function-response that conveys that it was an error, and then the bot code rethinks how to proceed.
- Changed the question processing so TS handles system prompting to cause function calling to happen when it should.
- "Function Plugins": A way to add a plugin that adds functions to the bot.
- Web searching and web scraping LLM function plugin.
- Don't send the  user links of pages that httpGet is called on, unless the function returns content.. because it could just be a 404 (likely) because the LLM makes up links that don't exist.
- If the LLM responds with the empty string (bad), retry the query some number of times before giving up.

### Signal messenger

For now, Eddie only knows how to talk over Signal messenger.

#### signal-cli Server-Side Client

Here is the server-side Signal messenger client that Eddie uses:

https://github.com/AsamK/signal-cli

To install that on Fedora Linux:

     $ wget https://github.com/AsamK/signal-cli/releases/download/v0.13.12/signal-cli-0.13.12-Linux-native.tar.gz
     $ tar zxvf signal-cli-0.13.12-Linux-native.tar.gz
     $ mv signal-cli ~/signal-cli

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
     ~/signal-cli -a +13130806347 sendSyncRequest

##### Talking with Users

     ~/signal-cli -a +13130806347 receive --send-read-receipts
     ~/signal-cli -a +13130806347 trust -a +353800679079
     ~/signal-cli -a +13130806347 send --u yavin.05 -m 'Dont Panic!'

Individual user message:

{"envelope":{"source":"+353800679079","sourceNumber":"+353800679079","sourceUuid":"c5217511-a792-476b-93c2-0e51b75e272d","sourceName":".","sourceDevice":2,"timestamp":1716657246853,"typingMessage":{"action":"STARTED","timestamp":1716657246853}},"account":"+13130806347"}

.. and then:

{"envelope":{"source":"+353800679079","sourceNumber":"+353800679079","sourceUuid":"c5217511-a792-476b-93c2-0e51b75e272d","sourceName":".","sourceDevice":2,"timestamp":1716657247436,"dataMessage":{"timestamp":1716657247436,"message":"Hi Eddie.. what's going on?","expiresInSeconds":0,"viewOnce":false}},"account":"+13130806347"}

##### Inspecting Users

List the contacts that my own user currently has chats open with:

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

List the details of the specified contact, including if it's my own account:

~/signal-cli -u +13130806347 listContacts -a +13130806347

[{"number":"+13130806347","uuid":"89553559-0c35-4392-a717-61af37188764","username":"Eddie.4242","name":"","givenName":null,"familyName":null,"nickName":null,"nickGivenName":null,"nickFamilyName":null,"note":null,"color":null,"isBlocked":false,"isHidden":false,"messageExpirationTime":0,"profileSharing":false,"unregistered":false,"profile":{"lastUpdateTimestamp":1716858520452,"givenName":"Eddie","familyName":null,"about":"A private Alternate Intelligence (AI), shipboard computer of the Heart of Gold.","aboutEmoji":"","hasAvatar":true,"mobileCoinAddress":null}}]

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

Sending a message to a group:

~/signal-cli -u +13130806347 send -m 'I'\''m almost human in here!'  -g Q218vHcJaZo1PxRqVxImiUZXiWLM40An+fZsBF5bEW4=

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

##### Blocking and Unblocking Users

Blocking a user by UUID:

~/signal-cli -u +13138806347 block 02eca1e6-2dac-48a5-bc05-d8586af2e2d5

Succeeded if the return value was 0:

$ echo $?
0

List blocked users:

~/signal-cli -u +13138806347 listContacts --blocked true

INFO  SignalAccount - Config file is in use by another instance, waiting…
INFO  SignalAccount - Config file lock acquired.
Number:  ACI: 02eca1e6-2dac-48a5-bc05-d8586af2e2d5 Name:  Profile name: Deranged  name:  Color:  Blocked: true Message expiration: disabled

Unblocking a user by UUID:

~/signal-cli -u +13138806347 unblock 02eca1e6-2dac-48a5-bc05-d8586af2e2d5

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
     $ npm install child_process readline axios dotenv
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

##### Context Remembering and Context Clipping

Eventually I realized that it's the bot code that needs to try to remember the recent context of the conversation with Eddie, and that the context needs only to be tracked as much as the model's context window would allow.  Larger text than that should get clipped.  So I thought up how that should be done, roughly, and wrote the following prompt to have GPT-4o generate the code for me.

Prompt: Please write me a typescript function where I pass it an array of ChatMessage objects like this: interface ChatMessage {
role: string;
content: string;
}
.. where each new ChatMessage is added to the end of the array, and I want to prune the array of all the oldest elements where all of the strings of the content member add up to over 8k bytes in total size. The remaining elements of the array must contain content strings of 8k bytes or less in total. The function must return a new array that contains the more recent content, clipped to 8k.

Generated by GPT-4o:

interface ChatMessage {
  role: string;
  content: string;
}

function pruneChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const MAX_SIZE = 8 * 1024; // 8KB in bytes

  // Function to calculate the total size in bytes of the content strings
  const calculateTotalSize = (msgs: ChatMessage[]): number => {
    return msgs.reduce((acc, msg) => acc + new TextEncoder().encode(msg.content).length, 0);
  };

  // Start from the end of the array and add messages until we exceed MAX_SIZE
  let totalSize = 0;
  const prunedMessages: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const messageSize = new TextEncoder().encode(messages[i].content).length;
    if (totalSize + messageSize <= MAX_SIZE) {
      prunedMessages.unshift(messages[i]);
      totalSize += messageSize;
    } else {
      break;
    }
  }

  return prunedMessages;
}

// Example usage
const chatMessages: ChatMessage[] = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi! How can I help you today?' },
  { role: 'user', content: 'I have a question about my order.' },
  // Add more messages as needed
];

const prunedMessages = pruneChatMessages(chatMessages);
console.log(prunedMessages);

Explanation:
MAX_SIZE: This constant defines the maximum allowed size of the content strings combined, which is 8KB (8 * 1024 bytes).

calculateTotalSize: This helper function calculates the total size in bytes of the content strings in the given array of ChatMessage objects.

Pruning Logic:
- We iterate from the end of the messages array to the beginning.
- We use the TextEncoder to calculate the byte size of each message's content.
- We add messages to the prunedMessages array until adding another message would exceed the 8KB limit.
- The unshift method is used to add messages to the beginning of the prunedMessages array to maintain the original order.

Return Value: The function returns the prunedMessages array, which contains the most recent messages clipped to a total size of 8KB or less.

Usage Example
The example usage demonstrates how to call the pruneChatMessages function with an array of ChatMessage objects and print the resulting pruned array. You can extend the chatMessages array with more messages to test the pruning logic further.
This function ensures that you get a new array containing the most recent messages, clipped to a maximum total size of 8KB.

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


### AutoSSH Configuration

In the file: /home/jasonb/.config/systemd/user/autossh.service

[Unit]
Description=Autossh
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
ExecStart=/usr/bin/autossh -M 0 -N \
	-o "ServerAliveInterval 50" \
	-o "ServerAliveCountMax 30" \
	-o "ConnectTimeout 10" \
	-o "ExitOnForwardFailure yes" \
	-i /home/${USER}/.ssh/id_rsa \
	-p 65002 \
	u372297933@195.35.38.251 \
	-R 10022:localhost:22
Restart=always
RestartSec=2

[Install]
WantedBy=default.target

.. and in /etc/ssh/sshd_config:

```config
     # This is the sshd server system-wide configuration file.  See
     # sshd_config(5) for more information.
     
     # This sshd was compiled with PATH=/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin
     
     # The strategy used for options in the default sshd_config shipped with
     # OpenSSH is to specify options with their default value where
     # possible, but leave them commented.  Uncommented options override the
     # default value.
     
     # To modify the system-wide sshd configuration, create a  *.conf  file under
     #  /etc/ssh/sshd_config.d/  which will be automatically included below
     Include /etc/ssh/sshd_config.d/*.conf
     
     # If you want to change the port on a SELinux system, you have to tell
     # SELinux about this change.
     # semanage port -a -t ssh_port_t -p tcp #PORTNUMBER
     #
     Port 22
     AddressFamily any
     ListenAddress 0.0.0.0
     ListenAddress ::
     
     #HostKey /etc/ssh/ssh_host_rsa_key
     #HostKey /etc/ssh/ssh_host_ecdsa_key
     #HostKey /etc/ssh/ssh_host_ed25519_key
     
     # Ciphers and keying
     #RekeyLimit default none
     
     # Logging
     #SyslogFacility AUTH
     #LogLevel INFO
     
     # Authentication:
     
     #LoginGraceTime 2m
     #PermitRootLogin prohibit-password
     #StrictModes yes
     #MaxAuthTries 6
     #MaxSessions 10
     
     #PubkeyAuthentication yes
     
     # The default is to check both .ssh/authorized_keys and .ssh/authorized_keys2
     # but this is overridden so installations will only check .ssh/authorized_keys
     AuthorizedKeysFile	.ssh/authorized_keys
     
     #AuthorizedPrincipalsFile none
     
     #AuthorizedKeysCommand none
     #AuthorizedKeysCommandUser nobody
     
     # For this to work you will also need host keys in /etc/ssh/ssh_known_hosts
     #HostbasedAuthentication no
     # Change to yes if you don't trust ~/.ssh/known_hosts for
     # HostbasedAuthentication
     #IgnoreUserKnownHosts no
     # Don't read the user's ~/.rhosts and ~/.shosts files
     #IgnoreRhosts yes
     
     # To disable tunneled clear text passwords, change to no here!
     #PasswordAuthentication yes
     #PermitEmptyPasswords no
     
     # Change to no to disable s/key passwords
     #KbdInteractiveAuthentication yes
     
     # Kerberos options
     #KerberosAuthentication no
     #KerberosOrLocalPasswd yes
     #KerberosTicketCleanup yes
     #KerberosGetAFSToken no
     #KerberosUseKuserok yes
     
     # GSSAPI options
     #GSSAPIAuthentication no
     #GSSAPICleanupCredentials yes
     #GSSAPIStrictAcceptorCheck yes
     #GSSAPIKeyExchange no
     #GSSAPIEnablek5users no
     
     # Set this to 'yes' to enable PAM authentication, account processing,
     # and session processing. If this is enabled, PAM authentication will
     # be allowed through the KbdInteractiveAuthentication and
     # PasswordAuthentication.  Depending on your PAM configuration,
     # PAM authentication via KbdInteractiveAuthentication may bypass
     # the setting of "PermitRootLogin without-password".
     # If you just want the PAM account and session checks to run without
     # PAM authentication, then enable this but set PasswordAuthentication
     # and KbdInteractiveAuthentication to 'no'.
     # WARNING: 'UsePAM no' is not supported in Fedora and may cause several
     # problems.
     #UsePAM no
     
     AllowAgentForwarding yes
     AllowTcpForwarding yes
     #GatewayPorts no
     X11Forwarding yes
     #X11DisplayOffset 10
     #X11UseLocalhost yes
     #PermitTTY yes
     #PrintMotd yes
     #PrintLastLog yes
     TCPKeepAlive yes
     #PermitUserEnvironment no
     #Compression delayed
     ClientAliveInterval 10
     ClientAliveCountMax 99999
     #UseDNS no
     #PidFile /var/run/sshd.pid
     #MaxStartups 10:30:100
     PermitTunnel yes
     #ChrootDirectory none
     #VersionAddendum none
     
     # no default banner path
     #Banner none
     
     # override default of no subsystems
     Subsystem	sftp	/usr/libexec/openssh/sftp-server
     
     # Example of overriding settings on a per-user basis
     #Match User anoncvs
     #	X11Forwarding no
     #	AllowTcpForwarding no
     #	PermitTTY no
     #	ForceCommand cvs server
     
     Match User sshtunuser
     	GatewayPorts yes
     	ForceCommand /bin/false
     	ClientAliveInterval 10
     	ClientAliveCountMax 99999
```

.. and there is a special user and group:

     # id sshtunuser
     uid=1002(sshtunuser) gid=1002(sshtunuser) groups=1002(sshtunuser)

.. and a TUN/TAP device:

     # ls -la /dev/net/tun 
     crw-rw-rw-. 1 root root 10, 200 Feb 23 11:20 /dev/net/tun

.. then, to SSH into the destination server:

You may use this unified command to ssh into Eddie's server from your laptop anywhere, once Jason has added your laptop's SSH key:

     $ export UINDEX=$(echo $USER | cksum | cut -c -3); ssh -t -p 65002 u372297933@195.35.38.251 -L 22${UINDEX}:localhost:10022 -L 11434:localhost:11${UINDEX} "bash -c 'while [ true ] ; do ssh -p 10022 $USER@localhost -L 11${UINDEX}:localhost:11434 && exit; sleep 1 ; done'" # hostinger eddie

And once that is connected, in another terminal on your laptop you can SSH into Ash like this:

     $ export UINDEX=$(echo $USER | cksum | cut -c -3); ssh -Y -p 22${UINDEX} $USER@localhost

Step by step SSHing: First ssh into Hostinger:

     $ ssh -Y -p 65002 u372297933@195.35.38.251 -L 22000:localhost:10022 -L 11434:localhost:11435 # hostinger eddie jasonb

And from inside the Hostinger host:

     $ while [ true ] ; do ssh -p 10022 jasonb@localhost -R :5900:localhost:15900 -L 11434:localhost:11434; sleep 1 ; done # eddie jasonb

This tunnels AI API traffic. After this you can connect to the Ollama API at loccalhost port 11434, like this:

     $ time curl http://localhost:11434/api/chat -d '{
       "model": "dolphin-llama3-eddie-10:8b",
       "messages": [
         { "role": "user", "content": "what is your favorite color?" }
       ]
     }'

Here is Eddie's autossh service:

     # cat /etc/systemd/system/eddie.service
```config
[Unit]
Description=Autossh
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
ExecStart=/usr/bin/autossh -M 0 -N -o "ServerAliveInterval=5" -o "ServerAliveCountMax=3000" -o "ConnectTimeout=5" -o "ExitOnForwardFailure=yes" -i /home/${USER}/.ssh/id_rsa -p 65002 u372297933@195.35.38.251 -R 10022:localhost:22
User=jasonb
Group=jasonb
Restart=always
RestartSec=3
StandardOutput=append:/var/log/autossh.log
StandardError=append:/var/log/autossh.log

[Install]
WantedBy=default.target
```

To enable the autossh service, as root:

     # systemctl daemon-reload
     # systemctl enable --now autossh
     # systemctl start autossh

Here's Eddie's bot service:

     # cat /home/jasonb/bin/eddie

     cd ~/git/eddie
     npm start

     # cat /etc/systemd/system/eddie.service
```config
[Unit]
Description=Eddie Service
After=network-online.target

[Service]
ExecStart=/bin/bash /home/jasonb/bin/eddie
User=jasonb
Group=jasonb
Restart=always
RestartSec=3
Environment="PATH=/usr/local/cuda/bin:/home/jasonb/.local/bin:/home/jasonb/bin:/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin:/var/lib/snapd/snap/bin"

[Install]
WantedBy=default.target
```
To enable the eddie service, as root:

     # systemctl daemon-reload
     # systemctl enable --now eddie
     # systemctl start eddie

To see the logs:

     # systemctl status eddie

.. and:

     # journalctl -fu eddie

Also the nouveau module is blacklisted so that the nvidia module is used:

     # cat /etc/default/grub
```BASH
GRUB_TIMEOUT=5
GRUB_DISTRIBUTOR="$(sed 's, release .*$,,g' /etc/system-release)"
GRUB_DEFAULT=saved
GRUB_DISABLE_SUBMENU=true
GRUB_TERMINAL_OUTPUT="console"
GRUB_CMDLINE_LINUX="rhgb quiet rd.driver.blacklist=nouveau modprobe.blacklist=nouveau"
GRUB_DISABLE_RECOVERY="true"
GRUB_ENABLE_BLSCFG=true
```
.. then reinstall grub:

    # grub2-mkconfig -o /boot/grub2/grub.cfg


### Songs About Eddie

Prompt: 80s style Hard Rock ballad about Eddie signal bot sailing on the space ship Heart of Gold with an infinite improbability drive and a brain the size of five GPUs, apparently written and performed by Rush.

Heart of Gold Voyage

https://suno.com/song/297fceca-7921-4e33-ac99-e42dd7dd06a3

https://suno.com/song/0be0540f-0f15-43c9-8535-01782f56ac2f

Eddie e o Bot do Signal

https://suno.com/song/c14e533a-22e6-4be4-ac56-302614b9d58c

https://suno.com/song/bc933d2f-6437-4cf6-83d0-935eba2f97e6

### Links

signal-cli manpage

https://github.com/AsamK/signal-cli/blob/master/man/signal-cli.1.adoc


AsamK / signal-cli: A command line interface to operate a Signal client library.  Written in Java and rust, GPL v3 License.  This can be the base layer of Signal bots.  Recommended by GPT-4o on Poe.

https://github.com/AsamK/signal-cli


signal-cli-rest-api: This project doesn't use it, but it looks nice.

https://bbernhard.github.io/signal-cli-rest-api/


Simple Signal Bot in BASH (Feb 13, 2020)

https://medium.com/digital-forensics-deep-learning-and-dev/simple-signal-bot-6ce841c7982e


NodeJS Docs: child_process

https://nodejs.org/api/child_process.html#class-childprocess

https://nodejs.org/api/child_process.html#subprocesskillsignal


NodeJS Docs: readline.createInterface

https://nodejs.org/api/readline.html#readlinepromisescreateinterfaceoptions

