import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Правила для агентов лежат в общей конфигурации разработчика, поэтому
  // автогенерация AGENTS.md и CLAUDE.md в корне репозитория не нужна.
  agentRules: false,
};

export default nextConfig;
