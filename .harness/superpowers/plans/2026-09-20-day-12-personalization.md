# Day 12 Personalization Implementation Plan

**Goal:** Профиль пользователя со структурированными предпочтениями и
ограничениями, подключённый к каждому запросу, со своей долговременной памятью и
автоматическим обновлением через роутер памяти.

**Spec:** `.harness/superpowers/specs/2026-09-20-day-12-personalization-design.md`

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Node.js `node:sqlite`,
Tailwind CSS 4, Phosphor Icons, `node:test` через `tsx`.

## Глобальные ограничения

- Работа только в ветке `day-12`, созданной от `main`.
- Маршруты дней 1–11 продолжают работать; `/day-11` использует LTM активного профиля.
- Схему памяти создаёт единственный модуль `memory-schema.ts`; миграции идемпотентны.
- Обмен сохраняется одной транзакцией после полного стрима; сбой роутера не откатывает обмен.
- Внешние вызовы без retry; секреты только в `.env.local`.
- Каждый source-файл меньше 800 строк.
- `main` и remote не меняются без отдельной команды пользователя.

## Этапы

### 1. Схема и хранилище профиля

- `src/lib/memory-schema.ts` — `ensureMemorySchema(database)`: создание всех
  таблиц памяти Day 11, таблиц `memory_profiles` и `memory_profile_constraints`,
  миграция `memory_long_term` под `profile_id` и `memory_writes` под слой `profile`.
- `src/lib/profile-types.ts` — `UserProfile`, `ProfilePreferences`,
  `ProfileConstraint`, перечисления и их русские подписи.
- `src/lib/profile-store.ts` — `SqliteProfileStore`: `listProfiles`,
  `getActiveProfile`, `createProfile`, `updateProfile`, `deleteProfile`,
  `activateProfile`, `addConstraint`, `deleteConstraint`, `applyProfileWrite`.
- `src/lib/memory-store.ts` — все операции LTM принимают `profileId`.
- `tests/profile-store.test.ts` — миграция, единственный активный профиль,
  изоляция LTM между профилями, каскады, запрет удаления последнего профиля.

### 2. Промпт и роутер

- `src/lib/memory-composer.ts` — блок профиля первым после system,
  `profileTokens` в разбивке, тумблер `profile`.
- `src/lib/memory-router.ts` — слой `profile` в системном промпте и парсере,
  валидация значений полей по перечислениям.
- `src/lib/personalized-chat-agent.ts` — снимок профиля и памяти, композиция,
  стрим, сохранение обмена, применение записей роутера во все три слоя.
- `tests/personalized-agent.test.ts` — порядок блоков, нулевой вклад
  выключенного профиля, смена профиля меняет факты и стиль, автоучёт
  предпочтений, сбой роутера сохраняет обмен.

### 3. API

- `src/app/api/profiles/route.ts`, `[id]/route.ts`, `[id]/activate/route.ts`,
  `[id]/constraints/route.ts`, `[id]/constraints/[constraintId]/route.ts`.
- `src/app/api/conversations/[id]/personalized-messages/route.ts` с заголовками
  Day 11 плюс `X-Memory-Prof` и `X-Memory-Profile`.

### 4. Интерфейс

- `src/components/profile-panel.tsx` — селектор, создание, удаление, редактор
  полей, ограничения, тумблер слоя.
- `src/components/day12-workspace.tsx` — состояние профилей и слоёв,
  переиспользование `MemoryInspector` и `MemoryTelemetryBar`.
- `src/components/memory-telemetry-bar.tsx` — сегмент `PROF`.
- `src/app/day-12/page.tsx`, ссылка `Day 12` в `site-header.tsx`.

### 5. Проверка и документация

- `package.json` — скрипт `test:profiles`.
- Все наборы тестов, targeted ESLint, `npx tsc --noEmit`, `npm run build`.
- Браузер: `/day-12` на десктопе и мобильной ширине; два профиля с разными
  предпочтениями и один вопрос; автоматическая смена `verbosity`.
- README ветки, `.harness/memory/day-12.md`, обновление индексов.
