# LiteLLM

Снимок `/data/litellm` с `vm-llm` от 2026-10-12. Одинаковая копия сохранена
в ветках `day-26`, `day-27`, `day-29` и `day-30`.

`docker-compose.yml` публикует порт `4000` и подключается к внешней Docker-сети
`llm`. `config.yaml` сохраняет три маршрута исходного сервера:

- `qwen3.8-medium` и `qwen3.8-xhigh` — `openai/qwen3.8` через
  `http://vllm:8000/v1`, с разными `reasoning_effort`.
- `title-maker` — `groq/llama-3.1-8b-instant`, с ключом из `GROQ_API_KEY`.

Значение `api_key: "None"` у локальных маршрутов сохранено из исходника;
оно обозначает вызов vLLM без реального ключа. Настройки vLLM находятся
в [`../vllm`](../vllm/README.md).

Реальная `.env` не переносилась. В `.env.example` находится только пустой
`GROQ_API_KEY`. Для локальной настройки:

```bash
cp .env.example .env
```

Для `title-maker` заполните ключ только в локальной `.env`, исключённой из Git.
Исходный тег образа `ghcr.io/berriai/litellm:main-latest` сохранён без изменения;
он не закрепляет конкретную версию LiteLLM.
