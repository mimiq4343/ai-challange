import { DOCUMENT_INDEX_CONFIG } from "./document-config";
import type { SqliteDocumentStore } from "./document-store";

export function documentChunksResponse(request: Request, store: SqliteDocumentStore): Response {
  const params = new URL(request.url).searchParams;
  const strategy = params.get("strategy");
  const rawOffset = params.get("offset") ?? "0";
  const offset = Number(rawOffset);
  if ((strategy !== "fixed" && strategy !== "structural") || !/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset)) {
    return Response.json({ error: "Укажите strategy=fixed|structural и целый неотрицательный offset." }, { status: 400 });
  }
  const source = params.get("source");
  const { report, sources, page } = store.readIndexPage(strategy, { source, offset, limit: DOCUMENT_INDEX_CONFIG.chunkPageSize });
  if (!report) return Response.json({ error: "Индекс ещё не создан. Выполните npm run documents:index." }, { status: 404 });
  const indexId = params.get("indexId");
  if (indexId !== null && indexId !== report.id) {
    return Response.json({ error: "Индекс обновился. Перезагрузите страницу для просмотра нового результата." }, { status: 409 });
  }
  if (source !== null && !sources.includes(source)) {
    return Response.json({ error: "Файл отсутствует в индексе." }, { status: 400 });
  }
  return Response.json({ indexId: report.id, offset, limit: DOCUMENT_INDEX_CONFIG.chunkPageSize, ...page }, { headers: { "Cache-Control": "no-store" } });
}
