# Eddie — Agent Guide

## What This Is

Eddie is an LLM chatbot over Signal messenger. It wraps `signal-cli` with TypeScript, uses a LLM API for chat completions that is OpenAI-compatible, and relays replies back over Signal. It supports tool/function calling (web search, HTTP GET, maps, image generation) via a custom plugin framework. Also implements sending images to the AI via Signal, and receiving back a text reply from the model (which must be a vision-capable model). There are tools plugins for web search, and web URL download.

## Run

```bash
npm start        # ts-node bot.ts
npm test         # ts-node test.ts
npm run typecheck # tsc --noEmit
```

There is no build step; `ts-node` runs `.ts` directly.

## Environment

Uses `dotenv`. Required env vars (loaded in `bot.ts`):

| Var | Purpose |
|---|---|
| `SIGNAL_CLI_PATH` | Path to `signal-cli` binary |
| `BOT_PHONE_NUMBER` | Bot's Signal phone number |
| `LLM_API_URL` | Ollama-compatible chat endpoint (`/v1/chat/completions` or native `/api/chat`; both response shapes are accepted) |
| `LLM_MODEL` | Model name for Ollama |
| `LLM_MODEL_CONTEXT_SIZE` | Context window in tokens (default 8192) |
| `EDDIE_ADMIN_0` | Admin phone number |
| `PLUGIN_WEBSCRAPE_BRAVE_SEARCH_KEY` | Brave Search API key |
| `LLM_FUNCTION_RESPONSE_MAX_BYTES` | Max bytes for a single function response (default 280000) |
| `IMAGE_SERVER_DIR` | Optional: directory where Signal image attachments are saved before being sent to the LLM (default `../image-server`) |

## Plugin System

- Plugins live in `plugin/`, filenames must end in `Plugin.ts`
- Each file must `export default` a class
- The plugin loader (`plugin/pluginLoader.ts`) uses the TypeScript compiler API to parse JSDoc at runtime
- Methods exposed to the LLM require a `@llmFunction` JSDoc tag plus full `@param` / `@returns` JSDoc — missing types or names cause silent failures
- All plugin methods become callable as `plugins.<methodName>()` from `bot.ts`
- LLM tools metadata is at `plugins.tools` (array of OpenAI-compatible function schemas)

## Architecture Notes

- Entry point: `bot.ts` — single forever-loop calling `signal-cli receive`, queuing envelopes, dispatching to `handleMessage()`
- Per-conversation context stored in `idToConversationContextMap` (keyed by UUID for private chats, group ID for groups)
- Context pruning happens in `pruneChatMessages()` — keeps system message + most recent messages below the context token limit
- Web scrape mode is triggered by keyword matching in `shouldWebScrape()` (English/Spanish/Portuguese), not by the LLM
- Function call responses are clipped to `LLM_FUNCTION_RESPONSE_MAX_BYTES` bytes before being sent back to the LLM
- `<think>` tags from thinking models are clipped in `clipThinkTags()`
- Image vision: incoming Signal image attachments are fetched with `signal-cli fetchAttachment`, saved under `imageServerDir` (`IMAGE_SERVER_DIR` env var, default `../image-server`), MIME-detected by magic bytes, and inlined into the LLM request as `image_url` data-URL content parts (OpenAI-compatible multi-modal messages) via `buildMessageContent()`/`fetchAttachment()`/`imageFileToDataUrl()` in `bot.ts`

## Key Gotchas

- **Typing the LLM/Signal types (status)**: The old `any`s in `bot.ts` are replaced by the interfaces `LlmContentPart`, `LlmMessage`, `LlmRequest`, `LlmResponse`, `SignalDataMessage`, `SignalEnvelope`, `PluginCallMessage` (top of `bot.ts`; the loader exposes the matching `LoadedPlugins` interface in `plugin/pluginLoader.ts`; `LlmContentPart`/`SignalEnvelope`/`LlmResponse` are exported). Remaining intentional `any`: the method index-signature on `LoadedPlugins` (in `plugin/pluginLoader.ts`, consumed by the `plugins` variable in `bot.ts`), and the `SignalDataMessage`/`SignalEnvelope` escape index-signatures (for unmodeled fields). `buildMessageContent` returns `LlmContentPart[]`; `buildLlmMessages` returns `LlmMessage[]`; the LLM POST body is `LlmRequest`; `handleMessage`/`processQueuedMessages`/the receive queue use `SignalEnvelope`; `invokeLlmFunction` takes a `PluginCallMessage` with `funcArgs: string[]`. Any new `any` should be replaced with one of these (or a new typed interface) rather than left implicit.
- No lint or test framework beyond `npm test`; verify changes with `npm test` and `npm run typecheck`
- `tsconfig.json` has `strict: true` but no `outDir` — compiled output goes alongside source
- Image generation (`/image` command) talks to a separate Spectacle server at `../image-server` (relative to eddie)
- `signal-cli` must be running and registered as a separate prerequisite — not installed by npm
- The bot process runs as a systemd service; restarting via `systemctl restart eddie`
