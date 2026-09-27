import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

import { MCP_MAX_RESPONSE_BYTES, MCP_PUBLIC_URL } from "./mcp-config";

// Разрешение относится только к нашему HTTPS origin, не ко всей локальной сети.
const TRUSTED_PRIVATE_ORIGIN = new URL(MCP_PUBLIC_URL).origin;

const privateAddresses = new BlockList();
privateAddresses.addSubnet("10.0.0.0", 8);
privateAddresses.addSubnet("172.16.0.0", 12);
privateAddresses.addSubnet("192.168.0.0", 16);

const reservedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) reservedAddresses.addSubnet(address, prefix);
reservedAddresses.addSubnet("2001::", 23, "ipv6");
reservedAddresses.addSubnet("2001:db8::", 32, "ipv6");
reservedAddresses.addSubnet("2002::", 16, "ipv6");
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

export class McpValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpValidationError";
  }
}

export function isMcpAddressAllowed(url: URL, address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const type = family === 6 ? "ipv6" : "ipv4";
  if (reservedAddresses.check(address, type)) return false;
  if (family === 6) return globalIpv6.check(address, "ipv6");
  if (privateAddresses.check(address, type)) return url.origin === TRUSTED_PRIVATE_ORIGIN;
  return true;
}

export function parseMcpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (cause) {
    throw new McpValidationError("Укажите полный HTTPS URL MCP-сервера.", { cause });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new McpValidationError("Нужен HTTPS URL без логина, пароля, параметров и фрагмента.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || (isIP(hostname) && !isMcpAddressAllowed(url, hostname))) {
    throw new McpValidationError("Локальные и служебные адреса MCP-серверов запрещены.");
  }
  return url;
}

export function createMcpDispatcher(url: URL): Agent {
  return new Agent({
    maxResponseSize: MCP_MAX_RESPONSE_BYTES,
    connect: {
      // Проверяем адрес именно при установке сокета, а не отдельным DNS-запросом:
      // иначе между проверкой и fetch возможен DNS rebinding.
      lookup(hostname, options, callback) {
        lookup(hostname, { family: options.family, all: true }, (error, addresses) => {
          if (error) {
            callback(error, "", 0);
            return;
          }
          if (!addresses.length || addresses.some(({ address }) => !isMcpAddressAllowed(url, address))) {
            callback(new McpValidationError("DNS MCP-сервера указывает на запрещённый адрес."), "", 0);
            return;
          }
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    },
  });
}

export function limitMcpResponse(response: Response): Response {
  if (!response.body) return response;
  let received = 0;
  // fetch уже распаковал Content-Encoding. Лимит на сокете ограничивает только
  // сжатые байты и сам по себе не защищает от чрезмерного распакованного ответа.
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MCP_MAX_RESPONSE_BYTES) {
        throw new McpValidationError("Ответ MCP-сервера превышает допустимый размер.");
      }
      controller.enqueue(chunk);
    },
  }));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
