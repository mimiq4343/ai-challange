# Day 8: tokens and context overflow

- The `/day-8` page reuses the Day 7 persistent chat and adds a token analytics rail on desktop and a bottom sheet on mobile.
- `@huggingface/transformers` loads only the committed official tokenizer assets from `tokenizers/`; `env.allowRemoteModels = false`.
- The local preflight counts system, history, request and a 4 096 token response reserve. The local breakdown is an estimate; provider `prompt_tokens` and `completion_tokens` are the source of truth.
- `ChatAgent` requests provider usage through `stream_options.include_usage`; `PersistentChatAgent` atomically persists the completed exchange together with its usage.
- SQLite holds the STRICT tables `exchange_usage` and `overflow_runs`. Legacy Day 7 exchanges are computed on read as `estimated` and never written back.
- Cost is stored as an integer number of micro-USD. An unknown cache split counts as a cache miss.
- The real overflow uses a single request without retry to OpenRouter Embeddings, model `nvidia/nemotron-3-embed-1b:free`, limit 32 768 and a deterministic input above the limit. The large input and the embedding vector are neither persisted nor logged.
- The single real overflow run: local input 33 288 tokens and 221 919 characters; OpenRouter returned HTTP 400 because of its 65 536 character limit, before any token context check. Stored `outcome = rejected`, `providerInputTokens = null`, duration 849 ms, cost 0.
- Verified real conversations: short — provider prompt 92, completion 186; long follow-up — local history 4 882, total provider prompt 9 942, completion 128, cost 1 744 micro-USD.
- A full Next.js restart preserved both provider usage records of the long conversation and `historyTokens = 4 882`.
- Permanent checks: `npm run test:tokens` and `npm run test:persistence`.
