import { ChatAgentError } from "@/lib/chat-agent";
import { ContextStrategyBenchmark } from "@/lib/context-strategy-benchmark";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const run = await ContextStrategyBenchmark.fromEnvironment().run(request.signal);
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ChatAgentError || error instanceof TypeError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    console.error("Не удалось выполнить Day 10 benchmark.", error);
    return Response.json({ error: "Benchmark завершился ошибкой." }, { status: 500 });
  }
}
