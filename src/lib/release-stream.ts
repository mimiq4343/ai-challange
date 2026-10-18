import { RELEASE_CONFIG as CONFIG } from "./release-config";
import { releaseEventSchema, type ReleaseEvent } from "./release-types";

export async function consumeReleaseStream(stream: ReadableStream<Uint8Array>, onEvent: (event: ReleaseEvent) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  function dispatch(line: string): boolean {
    if (!line.trim()) return false;
    let event: ReleaseEvent;
    try { event = releaseEventSchema.parse(JSON.parse(line)); }
    catch (cause) { throw new Error("Некорректное событие подготовки релиза.", { cause }); }
    if (event.type === "error") throw new Error(event.message);
    onEvent(event);
    return event.type === "result";
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        if (newline > CONFIG.maxEventCharacters) throw new Error("Событие релиза превышает допустимый объём.");
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (dispatch(line)) return;
      }
      if (pending.length > CONFIG.maxEventCharacters) throw new Error("Событие релиза превышает допустимый объём.");
      if (done) {
        if (pending && dispatch(pending)) return;
        throw new Error("Ответ оборвался до завершения подготовки релиза. Повторите запрос.");
      }
    }
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
}
