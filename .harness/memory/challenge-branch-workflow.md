---
name: challenge-branch-workflow
description: "Git workflow of the AI Advent Challenge project — day-N branches, README rules in main and in day branches"
metadata:
  node_type: memory
  pinned: false
  originSessionId: 6bd89542-49f4-4184-8b72-02ece8e93846
  modified: 2026-09-02T08:30:58.996Z
---

The project in /srv/workspace/ai-challange is the user's entry in the
"AI Advent Challenge #9" (repository github.com/mimiq4343/ai-challange).

Git workflow required by the user: every challenge day is implemented on its own
`day-N` branch (day-2, day-3, ...) created from main. Day code is merged into main
only on an explicit user command; until then main keeps the previous stable
application version (at Day 2 the user explicitly required main to keep the Day 1
application).

README rules (the user corrected them twice; follow them without reminders):

- Every `day-N` branch carries a README describing that day's task.
- main carries a consolidated README timeline: branch structure, a description of
  each day, and how to run each day (git checkout day-N plus commands). Update it
  AS SOON AS a new day branch appears or changes materially, without waiting for
  the day code to be merged into main: the README in main lives separately from
  the application code in main.
