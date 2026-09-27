export function validateMcpMutation(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  // Next dev подставляет адрес слушателя в request.url; браузерный адрес
  // сохраняется в Host. Произвольным X-Forwarded-* здесь не доверяем.
  const requestOrigin = new URL(request.url);
  const host = request.headers.get("host");
  if (host !== null) requestOrigin.host = host;
  if (
    fetchSite === "cross-site" ||
    fetchSite === "same-site" ||
    (origin !== null && origin !== requestOrigin.origin)
  ) {
    return Response.json(
      { error: "Изменять MCP-серверы можно только с этого сайта." },
      { status: 403 },
    );
  }

  if (
    request.method === "POST" &&
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
  ) {
    return Response.json(
      { error: "Тело запроса должно иметь тип application/json." },
      { status: 400 },
    );
  }
  return null;
}

export async function readMcpObjectBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Тело запроса должно быть JSON-объектом." }, { status: 400 });
  }
  return body as Record<string, unknown>;
}

export function parseMcpServerId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
