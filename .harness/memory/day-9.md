# Day 9: history compression

- `/day-9` uses a separate `CompressedChatAgent`; Day 7 and Day 8 stay on the full-history `PersistentChatAgent`.
- The full `messages` table remains the immutable source of truth in SQLite. Summary checkpoints are stored separately in `conversation_summaries`.
- `deepseek-v4-flash` updates the summary in blocks of exactly 10 messages with an output limit of 512. A summary failure stops the main request.
- The last 10 messages are guaranteed to stay uncompressed. Between checkpoints the raw buffer temporarily holds up to 19 messages so that no message falls out of context.
- Provider usage is the source of truth for operational savings. Summary overhead is accounted separately; judge usage is not part of net savings.
- The benchmark uses a fixed 20 message history and exactly four sequential LLM calls without retry: summary, full, compressed, blind judge.
- The judge receives randomized A/B labels and must return strict JSON without Markdown or extra keys.
- Real benchmark: full prompt 403, compressed prompt 350, gross savings 53, summary overhead 574, net savings −521; the judge picked the compressed answer.
- Permanent checks: `npm run test:compression`, `npm run test:tokens`, `npm run test:persistence`, `npx tsc --noEmit`.
