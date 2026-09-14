import {
  OverflowExperimentError,
  OverflowExperimentService,
} from "@/lib/overflow-experiment";

export const runtime = "nodejs";

const FORBIDDEN_FIELDS: Record<string, true> = {
  model: true,
  endpoint: true,
  targetTokens: true,
  apiKey: true,
  authorization: true,
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Подтвердите реальный overflow-тест." }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  if (
    values.confirmed !== true ||
    Object.keys(values).some((field) => FORBIDDEN_FIELDS[field])
  ) {
    return Response.json({ error: "Подтвердите реальный overflow-тест." }, { status: 400 });
  }

  try {
    const run = await new OverflowExperimentService().run({
      confirmed: true,
      signal: request.signal,
    });
    return Response.json(
      { run },
      {
        status: run.outcome === "network_error" ? 502 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof OverflowExperimentError) {
      return Response.json(
        { error: error.message },
        { status: error.kind === "validation" ? 400 : 500 },
      );
    }

    console.error("Не удалось выполнить overflow-тест.", error);
    return Response.json({ error: "Не удалось выполнить overflow-тест." }, { status: 500 });
  }
}
