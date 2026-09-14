import { getCompressionRunStore } from "@/lib/compression-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(
      { run: getCompressionRunStore().getLatestRun() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Не удалось загрузить последний benchmark сжатия.", error);
    return Response.json({ error: "Не удалось загрузить benchmark." }, { status: 500 });
  }
}
