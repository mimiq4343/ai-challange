import { ChatAgentError } from "@/lib/chat-agent";
import { CompressionBenchmark } from "@/lib/compression-benchmark";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный JSON в теле запроса." }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("confirmed" in body) ||
    body.confirmed !== true
  ) {
    return Response.json({ error: "Требуется confirmed: true." }, { status: 400 });
  }

  try {
    const run = await CompressionBenchmark.fromEnvironment().run(request.signal);
    return Response.json({ run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ChatAgentError) {
      return Response.json(
        { error: error.message },
        { status: error.kind === "configuration" ? 500 : 502 },
      );
    }
    console.error("Не удалось выполнить benchmark сжатия.", error);
    return Response.json({ error: "Не удалось выполнить benchmark." }, { status: 500 });
  }
}
