#!/bin/bash

# MODEL = "philbert440/Qwen3.8-27B-W4A16-AWQ"
MODEL="Twu31/Qwen3.8-27B-AWQ-INT4-MTP-LowLatency"

docker compose exec vllm vllm bench serve --model $MODEL --served-model-name qwen3.8 --base-url http://localhost:8000 --dataset-name random --random-prefix-len 8192 --random-input-len 1024 --random-output-len 64 --num-prompts 20 --max-concurrency 1
