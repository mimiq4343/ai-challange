import { ChatAgentError } from "./chat-agent";

export function collectCompletedTextStream(
  source: ReadableStream<Uint8Array>,
  onComplete: (text: string) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        chunks.push(chunk.slice());
        controller.enqueue(chunk);
      },
      async flush() {
        const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const completeResponse = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          completeResponse.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const text = new TextDecoder().decode(completeResponse);
        if (!text) throw new ChatAgentError("API вернул пустой ответ.", "upstream");
        await onComplete(text);
      },
    }),
  );
}
