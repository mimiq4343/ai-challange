import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Приложение открывают не только с localhost, но и по внутреннему адресу
  // машины разработки: без этого списка Next 16 блокирует dev-ресурсы
  // (/_next/hmr и чанки) для стороннего origin, и страница остаётся
  // негидрированной — кнопки не реагируют.
  allowedDevOrigins: ["10.43.228.200", "10.43.228.165", "127.0.0.1"],
  // Правила для агентов лежат в общей конфигурации разработчика, поэтому
  // автогенерация AGENTS.md и CLAUDE.md в корне репозитория не нужна.
  agentRules: false,
};

export default nextConfig;
