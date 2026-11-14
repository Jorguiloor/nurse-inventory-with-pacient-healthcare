import { context } from "@/server/context";
import { handleFile } from "@/server/http";
import { stockWorkbook, XLSX_TYPE } from "@/server/export";
import { stockQuerySchema } from "@/server/schemas";
import { limitExport } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/export/stock?q=&category=&lowOnly=1&from=YYYY-MM-DD&to=YYYY-MM-DD&mode=stock|gasto|ambos
 *
 * Exports the official "Reporte Control de Gastos Insumos y Medicamentos" spreadsheet.
 */
export async function GET(request: Request) {
  return handleFile(async () => {
    const ctx = await context();
    limitExport(ctx.user.id);
    const filter = stockQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const file = await stockWorkbook(ctx, filter);

    const datePart =
      filter.from && filter.to
        ? `_${filter.from}_a_${filter.to}`
        : filter.to
          ? `_Fecha_${filter.to}`
          : `_Fecha_${ctx.today}`;
    const modePart = filter.mode === "gasto" ? "_Gasto" : filter.mode === "ambos" ? "_Stock_y_Gasto" : "_Stock";
    const lowPart = filter.lowOnly ? "_StockBajo" : "";
    const fileName = `Control_de_Gastos_MediCheck${modePart}${datePart}${lowPart}.xlsx`;

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Length": String(file.length),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
