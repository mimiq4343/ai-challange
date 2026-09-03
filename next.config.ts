import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Приложение открывают не только с localhost, но и по внутреннему адресу
  // машины разработки: без этого списка Next 16 блокирует dev-ресурсы
  // (/_next/hmr и чанки) для стороннего origin, и страница остаётся
  // негидрированной — кнопки не реагируют.
  allowedDevOrigins: ["10.43.228.200"],
};

export default nextConfig;
