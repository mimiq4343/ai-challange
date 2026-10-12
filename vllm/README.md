# vLLM

Снимок `/data/vllm` с `vm-llm` от 2026-10-12. Одинаковая копия сохранена
в ветках `day-26`, `day-27`, `day-29` и `day-30`.

В каталоге находятся `docker-compose.yml`, `bench.sh`,
`preset-qwen3.8-27b-philbert440`, `Dockerfile.mtp` и пять Python-файлов
в `patches/overlay/vllm/`. Патчи перенесены без изменений; `Dockerfile.mtp`
накладывает их на `vllm/vllm-openai:qwen38-x86_64-cu129` для MTP при pipeline
parallelism. Compose выбирает образ через `VLLM_IMAGE` из пресета.

Исходная `.env` была ссылкой на пресет. В репозитории вместо неё находится
обычный `.env.example` с теми же параметрами и пустым `HF_TOKEN`.
Сам пресет также очищен от токена. Для локальной настройки:

```bash
cp .env.example .env
```

При необходимости доступа к закрытой модели заполните `HF_TOKEN` только
в локальной `.env`. Реальные `.env`, кэш и Python bytecode исключены из Git.

Compose использует GPU NVIDIA, каталог моделей `/data/models`, порт `8000`
и существующую внешнюю Docker-сеть `llm`. Каталог `.cache` с сервера не
переносился. Маршрутизатор моделей находится в [`../litellm`](../litellm/README.md).
