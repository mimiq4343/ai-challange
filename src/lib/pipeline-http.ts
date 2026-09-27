import { getPipelineStore, type SqlitePipelineStore } from "./pipeline-store";

export function pipelineReportResponse(profileId: number, reportId: string, store: SqlitePipelineStore = getPipelineStore()): Response {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Flash-Profile-Id": String(profileId) };
  const download = store.getReportDownload(profileId, reportId);
  if (!download) return Response.json({ error: "Отчёт не найден в текущем профиле." }, { status: 404, headers });
  return new Response(new Uint8Array(download.bytes.buffer as ArrayBuffer, download.bytes.byteOffset, download.bytes.byteLength), {
    headers: {
      ...headers,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${download.report.fileName}"`,
      "Content-Length": String(download.bytes.byteLength),
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
