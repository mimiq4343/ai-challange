#!/usr/bin/env bash
set -euo pipefail

# Конфигурация этого развёртывания хранится в deploy/, а не правится в /etc.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$root" != /data/workspaces/ai-challange ]]; then
  printf '%s\n' 'Сервисы настроены на /data/workspaces/ai-challange. Для другого хоста сначала обновите deploy/*.service.' >&2
  exit 1
fi
if [[ ! -f "$root/.env.local" ]]; then
  printf '%s\n' 'Сначала настройте .env.local: OPENAI_* и MCP_SCHEDULER_TOKEN.' >&2
  exit 1
fi
if [[ ! -x /home/linuxbrew/.linuxbrew/Cellar/node/26.9.0/bin/node ]]; then
  printf '%s\n' 'Нужен Node.js 26.9.0 по пути, зафиксированному в deploy/*.service.' >&2
  exit 1
fi

sudo -n true
sudo -n systemd-analyze verify "$root/deploy/flash-mcp.service" "$root/deploy/flash-scheduler.service"
mkdir -p "$root/data"
changed=()
for service in flash-mcp.service flash-scheduler.service; do
  if ! sudo -n cmp -s "$root/deploy/$service" "/etc/systemd/system/$service"; then
    sudo -n install -m 0644 "$root/deploy/$service" "/etc/systemd/system/$service"
    changed+=("$service")
  fi
done
if (( ${#changed[@]} )); then
  sudo -n systemctl daemon-reload
fi
sudo -n systemctl enable flash-mcp.service flash-scheduler.service
# Код и .env.local могут измениться без изменения unit-файлов.
sudo -n systemctl restart flash-mcp.service flash-scheduler.service
sudo -n systemctl is-active flash-mcp.service flash-scheduler.service
