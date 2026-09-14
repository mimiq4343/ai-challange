# Проект Flash Agent

- Репозиторий реализует задания AI Advent Challenge #9 отдельными маршрутами и ветками `day-N`.
- Завершённые дневные ветки после одобрения сливаются в `main`; предыдущие маршруты и API должны оставаться рабочими.
- Ветка `day-8` добавляет локальный подсчёт токенов, provider usage, стоимость и подтверждаемый OpenRouter overflow-тест.
- Стек: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Node.js `>=22.13.0`.
- Интерфейс и документация для пользователя написаны по-русски и используют визуальную систему Flash Chat.
- Секреты живут только в `.env.local`. Файл не коммитится.
- Основные проверки: targeted ESLint, `npx tsc --noEmit`, `npm run test:tokens`, `npm run test:persistence` и `npm run build` перед интеграцией.
