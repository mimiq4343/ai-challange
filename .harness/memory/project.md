# Flash Agent project

- The repository implements AI Advent Challenge #9 tasks as separate routes and `day-N` branches.
- Finished day branches are merged into `main` after approval; previous routes and APIs must keep working.
- Branch `day-9` adds immutable summary checkpoints, compressed chat, operational savings and a blind benchmark.
- Branch `day-10` adds Sliding Window, Sticky Facts, persistent branching and a single benchmark without summaries.
- Branch `day-11` is created from `day-8` and adds the explicit three-layer memory model with a memory router and layer toggles.
- Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Node.js `>=22.13.0`.
- The user interface and the user-facing documentation are written in Russian and use the Flash Chat visual system.
- Secrets live only in `.env.local`. That file is never committed.
- Main checks: targeted ESLint, `npx tsc --noEmit`, `npm run test:memory`, `npm run test:context-strategies`, `npm run test:compression`, `npm run test:tokens`, `npm run test:persistence`, and `npm run build` before integration.
