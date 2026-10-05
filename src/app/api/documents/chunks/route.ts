import { documentChunksResponse } from "@/lib/document-api";
import { DOCUMENT_INDEX_CONFIG } from "@/lib/document-config";
import { SqliteDocumentStore } from "@/lib/document-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  let store: SqliteDocumentStore | undefined;
  try {
    store = new SqliteDocumentStore(DOCUMENT_INDEX_CONFIG.databasePath);
    return documentChunksResponse(request, store);
  } catch (error) {
    console.error("Не удалось прочитать индекс документов.", error);
    return Response.json({ error: "Не удалось загрузить чанки локального индекса." }, { status: 500 });
  } finally {
    store?.close();
  }
}
