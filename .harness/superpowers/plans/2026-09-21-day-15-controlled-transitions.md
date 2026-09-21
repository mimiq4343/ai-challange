# Day 15 Controlled Transitions Implementation Plan

**Goal:** Переходы задачи, защищённые предусловиями, с утверждением плана и
видимой реакцией на отклонённую попытку.

**Spec:** `.harness/superpowers/specs/2026-09-21-day-15-controlled-transitions-design.md`

## Глобальные ограничения

- Работа только в ветке `day-15`, созданной от `main`.
- Маршруты дней 1–14 сохраняют поведение; `/day-13` и `/day-14` используют тот
  же автомат и получают предусловия автоматически.
- `task-machine.ts` остаётся чистым: без БД и сети.
- Каждый source-файл меньше 800 строк.
- `main` и remote не меняются без отдельной команды пользователя.

## Этапы

1. **Автомат** — контекст предусловий в `checkTransition`, причины отказа;
   миграция `task_runs` под `plan_approved` и `last_rejection`;
   `approvePlan`, сброс при правке плана, запись и очистка отказа в
   `task-store.ts`; тесты `task-machine` и `task-store`.
2. **Агент** — строки о плане и отказе в `renderTaskBlock`; `planApproved` в
   контракте и парсере роутера; применение отметки в `applyAgentUpdate`; тесты
   реакции.
3. **API и интерфейс** — `POST /api/tasks/:id/approve-plan`; панель задачи с
   бейджем, кнопками и плашкой отказа; страница `/day-15`, ссылка в шапке.
4. **Проверка и документация** — все наборы тестов, targeted ESLint,
   `npx tsc --noEmit`, `npm run build`, браузерный сценарий, README ветки,
   `.harness/memory/day-15.md`, обновление индексов.
