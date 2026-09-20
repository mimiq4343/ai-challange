---
name: fluid-fullwidth-layouts
description: "The user requires fluid full-viewport layouts, with no empty bands along the sides"
metadata:
  node_type: memory
  pinned: false
  originSessionId: 6bd89542-49f4-4184-8b72-02ece8e93846
  modified: 2026-09-01T05:58:16.941Z
---

While building landing pages and web pages the user twice rejected containers with
a fixed maximum width (`max-w-[1200px]`, then even large fixed paddings such as
`xl:px-20`). Verbatim corrections: «По бокам пустые полосы, исправь» and «Сделай
вообще динамическую верстку, чтобы подгонялась под размер экрана».

Lesson: for this user, make the default layout fully fluid across the whole
viewport width. Express paddings and sizes through `clamp()` with a vw/vh component
instead of fixed breakpoint values; stretch decorative backgrounds (glows,
gradients) full-bleed across the viewport so their edges do not read as "bands".
Hard narrow containers are acceptable only when the user asks for them. Limit long
line length locally (`max-w-[65ch]` on paragraphs) rather than by narrowing the
whole page.
