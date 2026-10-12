# Self-hosted LLM deployment snapshot

Snapshot: 2026-10-12.

- The user requested identical credential-free copies of `/data/vllm` and
  `/data/litellm` from `vm-llm` in `day-26`, `day-27`, `day-29`, and `day-30`.
  Those branches did not exist on `origin` when checked; their common base
  is the remote `main` fetched for this task.
- The copies live at [`vllm/`](../../vllm/README.md) and
  [`litellm/`](../../litellm/README.md). Real `.env` files, the vLLM `.env`
  symlink, caches, and model files are excluded. Empty credential fields live
  in `.env.example`; the named vLLM preset also has an empty `HF_TOKEN`.
- Sanitization happens in memory on the source server before transfer. Neither
  source credentials nor raw environment files are imported into Git. The
  five Python overlay files are copied byte-for-byte from the source.
- Compose and LiteLLM routing are preserved, including the external `llm`
  network, local Qwen routes, Groq title route, and the existing mutable
  LiteLLM image tag. No live services are changed by this import.
- Existing upstream overlays `config/speculative.py` (1591 lines) and
  `v1/worker/gpu_model_runner.py` (8181 lines) exceed the handwritten-file
  limit. This task imports them intact rather than restructuring upstream code.
