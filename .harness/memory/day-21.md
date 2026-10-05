# Day 21: document indexing

Snapshot: 2026-10-05.

- The user approved a public README/code corpus, two chunking strategies, real
  embeddings and a local SQLite index with a comparison page. Design stayed in chat.
  `day-21` branched from `main` at `d874878`; the user explicitly approved its
  integration into `main` on 2026-10-05.
- Free embedding models were verified through the OpenRouter embeddings catalog
  and actual Russian/English requests. Selected `nvidia/nemotron-3-embed-1b:free`,
  2048 dimensions, using the existing local Nemotron tokenizer. The API can return
  `private/openrouter/nvidia/nemotron-3-embed-1b`; allow only verified aliases and
  require `usage.cost === 0`. Configuration is in
  [`document-config.ts`](../../src/lib/document-config.ts).
- The first 84-file run hit HTTP 429. The key's daily counter then confirmed a
  50-request ceiling. Narrowed the explicit public manifest to README plus eight
  modules covering all twelve control questions, and paced request starts at
  3500 ms. No retries or paid fallback. Never include private data in this corpus.
- Real snapshot: nine files, 94,748 characters, 2,376 lines, 32 nominal pages at
  3000 characters/page. Fixed: 88 chunks, 60 crossing section boundaries, HitRate@5
  11/12, MRR@5 0.729, 7.8 s, 720,896 vector bytes. Structural: 198 chunks, zero
  boundary crossings, HitRate@5 11/12, MRR@5 0.794, 23.5 s, 1,622,016 vector bytes.
  These timings include network and request pacing, not just model computation.
- [`document-indexer.ts`](../../src/lib/document-indexer.ts) validates question
  evidence before remote calls; stages complete vectors in memory, then replaces
  both strategies in one SQLite transaction. An exclusive local run lock covers
  indexing and JSON export. Read transactions keep report, sources and paged chunks
  in the same snapshot during a concurrent replacement; a changed `indexId` yields
  HTTP 409. Review reproduced both read-snapshot and concurrent-export races;
  regression tests cover their fixes with real SQLite/filesystem operations.
- Generated `data/documents.sqlite` and `data/documents-comparison.json` stay local
  and ignored. `/day-21` displays comparisons, top-five evidence matches and
  paginated chunks. Layout is fluid across the viewport, following the existing
  user preference.
