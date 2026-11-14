// Writes the Excel files the office gets out of the app:
//
//   stock    "Reporte Control de Gastos Insumos y Medicamentos" matching the official MediCheck
//            template (Insumos Médicos, Medicación/Soluciones Intravenosas, ADICIONALES), with
//            support for date ranges (from..to) and viewing either Stock, Gasto (dispensed), or both.
//   ledger   the office's monthly wide tab, rebuilt from stored movements, preceded by the
//            "Reporte saldos" summary sheet.

import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { fromDbDate, monthOf, monthsBetween, toDbDate } from "@/lib/dates";
import {
  formatExpiry,
  ledgerRows,
  ledgerTotals,
  recordedMonths,
  spanDays,
  wideMonthSheet,
  type LedgerItem,
  type LedgerMovement,
} from "@/lib/export-ledger";
import type { Category, StockResponse } from "@/lib/api-types";
import { stockReport, type ItemFilter } from "./inventory";
import { audit, type Ctx } from "./context";
import { ApiError } from "./http";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const MAX_EXPORT_DAYS = 1100;

export type ExportMode = "stock" | "gasto" | "ambos";

export interface StockExportOptions extends ItemFilter {
  from?: string;
  to?: string;
  mode?: ExportMode;
}

export interface LedgerExport {
  from: string;
  to: string;
  activeOnly?: boolean;
  onlyRecorded?: boolean;
  mode?: ExportMode;
}

const CATEGORY_EXCEL_LABEL: Record<Category, string> = {
  SUPPLY: "Insumos Médicos",
  MEDICINE: "Medicación",
  SOLUTION: "Soluciones Intravenosas",
  EQUIPMENT: "Equipos",
  TOPICAL: "Tópicos",
  MISC: "Varios",
};

const OFFICIAL_SUPPLY_ORDER = [
  "ALCOCPP",
  "IN000328",
  "IN0008",
  "IN00109",
  "IN00114",
  "IN00118",
  "IN00134",
  "IN0015",
  "IN0018",
  "IN0019",
  "IN0023",
  "IN0028",
  "IN0032",
  "IN0036",
  "IN0040",
  "IN0042",
  "IN0056",
  "IN0057",
  "IN0058",
  "IN0084",
  "IN0085",
  "IN0091",
  "IN0097",
  "INB0021",
  "INS1530",
  "INSM025",
  "INSM029",
  "INSUTRAQ",
  "INSUZET",
  "ITACOSL",
  "SUJ TRAQUE-DALE",
];

const OFFICIAL_MEDICINE_ORDER = [
  "MA0.025%",
  "MCS50MG",
  "MD4MG/ML",
  "MDFCO200ML",
  "MDgtas",
  "MDXL30MG",
  "MED052",
  "MEDAMANT",
  "MEDAQUADR",
  "MEDDOLCO",
  "MEDF40",
  "MEDFARMAD",
  "MEDFLUI",
  "MEDLYR",
  "MEDNEU",
  "METMG",
  "MEUT",
  "MFA300MG",
  "MM15MG",
  "MS25/250",
  "MT-K FCO",
  "MTSL0.4MG",
  "INSCLOR250",
];

const OFFICIAL_ADDITIONAL_ORDER = ["IN0080", "MEDACID", "MEDFLOGO5MG"];
const OFFICIAL_ADDITIONAL_SET = new Set(OFFICIAL_ADDITIONAL_ORDER);

/** "2026-09" turned into the range a monthly export covers: the whole of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export async function recordedRange(): Promise<{ from: string; to: string } | null> {
  const { _min, _max } = await db.transaction.aggregate({
    where: { voidedAt: null },
    _min: { date: true },
    _max: { date: true },
  });
  if (!_min.date || !_max.date) return null;
  const first = fromDbDate(_min.date)!;
  const last = fromDbDate(_max.date)!;
  return { from: monthRange(monthOf(first)).from, to: monthRange(monthOf(last)).to };
}

async function readMovements(to: string): Promise<LedgerMovement[]> {
  const rows = await db.transaction.findMany({
    where: { date: { lte: toDbDate(to) }, voidedAt: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { date: true, itemId: true, qty: true, batch: { select: { expiry: true } } },
  });
  return rows.map((r) => ({
    date: fromDbDate(r.date)!,
    itemId: r.itemId,
    qty: r.qty,
    expiry: fromDbDate(r.batch.expiry),
  }));
}

async function readItems(activeOnly: boolean): Promise<LedgerItem[]> {
  return db.item.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: { id: "asc" },
    select: { id: true, name: true, variant: true },
  });
}

// ---------- the wide tab ----------

export async function buildLedger(_ctx: Ctx, options: LedgerExport): Promise<{
  from: string;
  to: string;
  items: LedgerItem[];
  movements: LedgerMovement[];
  totals: ReturnType<typeof ledgerTotals>;
}> {
  const days = spanDays(options.from, options.to);
  if (days < 1) throw ApiError.badRequest(`"${options.from}" es posterior a "${options.to}".`);
  if (days > MAX_EXPORT_DAYS) {
    throw ApiError.badRequest(
      `Son ${days} días. Exporta como máximo ${MAX_EXPORT_DAYS} días por vez, o un mes a la vez.`,
      "RANGE_TOO_LONG",
    );
  }

  const [items, movements] = await Promise.all([
    readItems(options.activeOnly ?? false),
    readMovements(options.to),
  ]);
  const totals = ledgerTotals(ledgerRows({ items, movements, from: options.from, to: options.to }));
  return { from: options.from, to: options.to, items, movements, totals };
}

/** The ledger as an .xlsx file, starting with the official "Reporte saldos" sheet followed by the monthly wide tabs. */
export async function ledgerWorkbook(ctx: Ctx, options: LedgerExport): Promise<Buffer> {
  const { from, to, items, movements, totals } = await buildLedger(ctx, options);

  const wb = new ExcelJS.Workbook();
  wb.creator = "MediCheck";
  wb.created = new Date();

  await addControlDeGastosSheet(wb, ctx, {
    includeInactive: !(options.activeOnly ?? false),
    from,
    to,
    mode: options.mode ?? "ambos",
  });

  const months = options.onlyRecorded
    ? recordedMonths(from.slice(0, 7), to.slice(0, 7), movements)
    : monthsBetween(from.slice(0, 7), to.slice(0, 7));
  for (const month of months) {
    const sheet = wideMonthSheet({ items, movements, month });
    const ws = wb.addWorksheet(sheet.sheet);
    ws.addRow([sheet.title]);
    ws.addRow([]);
    ws.addRow(sheet.headers);
    for (const row of sheet.rows) {
      const values: (string | number | null)[] = [
        row.index,
        row.name,
        formatExpiry(row.expiries[0] ?? null),
        formatExpiry(row.expiries[1] ?? null),
      ];
      for (const day of row.days) values.push(day.beginning, day.dispensed);
      values.push(row.balance, row.balance);
      ws.addRow(values);
    }
    styleWideSheet(ws, sheet.headers.length);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await audit(db, ctx, "ledger.export", "export", `${from}/${to}`, {
    items: items.length,
    days: spanDays(from, to),
    months,
    received: totals.received,
    dispensed: totals.dispensed,
    unitsOnHand: totals.closing,
  });

  return buffer;
}

export function ledgerFileName(from: string, to: string): string {
  const single = monthRange(from.slice(0, 7)).to === to && from.endsWith("-01") ? from.slice(0, 7) : `${from}_a_${to}`;
  return `Control_de_Gastos_MediCheck_${single}.xlsx`;
}

// ---------- Reporte Control de Gastos Insumos y Medicamentos ----------

const BATCH_HEADERS = [
  "CÓDIGO",
  "ARTÍCULO",
  "LOTE",
  "VENCIMIENTO",
  "RECIBIDO EL",
  "ORIGEN",
  "CANT. RECIBIDA",
  "SALDO",
] as const;

function sortByOfficialOrder<T extends { item: { id: string } }>(rows: T[], orderList: string[]): T[] {
  const rank = new Map(orderList.map((id, idx) => [id, idx]));
  return [...rows].sort((a, b) => {
    const ra = rank.get(a.item.id);
    const rb = rank.get(b.item.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.item.id.localeCompare(b.item.id);
  });
}

async function addControlDeGastosSheet(
  wb: ExcelJS.Workbook,
  ctx: Ctx,
  options: StockExportOptions,
): Promise<StockResponse> {
  const report: StockResponse = await stockReport(ctx, options);
  const mode: ExportMode = options.mode ?? "stock";
  const effectiveTo = options.to || ctx.today;
  const effectiveFrom = options.from || null;

  if (effectiveFrom && effectiveFrom > effectiveTo) {
    throw ApiError.badRequest(`La fecha inicial (${effectiveFrom}) no puede ser posterior a la fecha final (${effectiveTo}).`);
  }

  // Query transactions up to effectiveTo to compute exact stock at `to` and gasto in `[from, to]`.
  const txs = await db.transaction.findMany({
    where: {
      voidedAt: null,
      date: { lte: toDbDate(effectiveTo) },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      itemId: true,
      date: true,
      type: true,
      qty: true,
      remarks: true,
    },
  });

  const statsByItem = new Map<
    string,
    {
      stockAtTo: number;
      gastoInRange: number;
      receivedInRange: number;
      hasFractional4875: boolean;
      remarks: string[];
    }
  >();

  for (const row of report.rows) {
    statsByItem.set(row.item.id, {
      stockAtTo: 0,
      gastoInRange: 0,
      receivedInRange: 0,
      hasFractional4875: false,
      remarks: [],
    });
  }

  for (const tx of txs) {
    let st = statsByItem.get(tx.itemId);
    if (!st) {
      st = { stockAtTo: 0, gastoInRange: 0, receivedInRange: 0, hasFractional4875: false, remarks: [] };
      statsByItem.set(tx.itemId, st);
    }
    st.stockAtTo += tx.qty;
    if (tx.remarks?.includes("48.75")) {
      st.hasFractional4875 = true;
    }

    const d = fromDbDate(tx.date)!;
    const inRange = !effectiveFrom || (d >= effectiveFrom && d <= effectiveTo);
    if (inRange) {
      if (tx.type === "DISPENSE" || tx.type === "DISPOSE") {
        st.gastoInRange += Math.abs(tx.qty);
      } else if (tx.type === "RECEIVE") {
        st.receivedInRange += tx.qty;
      }
      if (tx.remarks && !tx.remarks.includes("Cantidad exacta: 48.75")) {
        if (!st.remarks.includes(tx.remarks)) st.remarks.push(tx.remarks);
      }
    }
  }

  const ws = wb.addWorksheet("Reporte saldos");

  // Row 1: blank merged A1:E1
  ws.addRow(["", "", "", "", ""]);
  ws.mergeCells("A1:E1");

  // Row 2: Title merged A2:E2
  const titleRow = ws.addRow(["Reporte Control de Gastos Insumos y Medicamentos", "", "", "", ""]);
  ws.mergeCells("A2:E2");
  titleRow.height = 18;
  titleRow.getCell(1).font = { name: "Century Gothic", size: 14, bold: true };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

  // Row 3: Subtitle with date range / mode merged A3:E3
  const hasCustomRange = Boolean(options.from || options.to || options.mode);
  const modeLabel =
    mode === "gasto"
      ? "Mostrando: Gasto (Dispensado en el rango)"
      : mode === "ambos"
        ? "Mostrando: Stock y Gasto en el rango"
        : "Mostrando: Stock disponible";
  const rangeText = hasCustomRange
    ? `Periodo: ${effectiveFrom ? `Desde ${effectiveFrom} ` : ""}Hasta ${effectiveTo}  ·  ${modeLabel}`
    : "";
  const subRow = ws.addRow([rangeText, "", "", "", ""]);
  ws.mergeCells("A3:E3");
  if (rangeText) {
    subRow.height = 16;
    subRow.getCell(1).font = { name: "Century Gothic", size: 10, bold: true };
    subRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  }

  // Row 4: blank
  ws.addRow(["", "", "", "", ""]);

  // Partition items into the 3 template blocks:
  // 1. Insumos Médicos (non-additional SUPPLY)
  // 2. Medicación & Soluciones Intravenosas (non-additional MEDICINE, SOLUTION, etc.)
  // 3. ADICIONALES (IN0080, MEDACID, MEDFLOGO5MG, or variant === "Adicional")
  const isAdditional = (r: StockResponse["rows"][number]) =>
    OFFICIAL_ADDITIONAL_SET.has(r.item.id) || r.item.variant?.toLowerCase() === "adicional";

  const supplyRows = sortByOfficialOrder(
    report.rows.filter((r) => !isAdditional(r) && r.item.category === "SUPPLY"),
    OFFICIAL_SUPPLY_ORDER,
  );
  const medicineRows = sortByOfficialOrder(
    report.rows.filter((r) => !isAdditional(r) && r.item.category !== "SUPPLY"),
    OFFICIAL_MEDICINE_ORDER,
  );
  const additionalRows = sortByOfficialOrder(
    report.rows.filter((r) => isAdditional(r)),
    OFFICIAL_ADDITIONAL_ORDER,
  );

  const writeDataRow = (r: StockResponse["rows"][number]) => {
    const st = statsByItem.get(r.item.id) ?? {
      stockAtTo: r.item.balance,
      gastoInRange: 0,
      receivedInRange: 0,
      hasFractional4875: false,
      remarks: [],
    };
    const exactStock = st.hasFractional4875 && st.stockAtTo > 0 ? st.stockAtTo - 0.25 : st.stockAtTo;
    const cantidad = mode === "gasto" ? st.gastoInRange : exactStock;

    const obsParts: string[] = [];
    if (mode === "gasto") {
      obsParts.push(`Stock al ${effectiveTo}: ${exactStock}`);
    } else if (mode === "ambos") {
      obsParts.push(`Gasto (${effectiveFrom ?? "inicio"} a ${effectiveTo}): ${st.gastoInRange}`);
      if (st.receivedInRange > 0) obsParts.push(`Ingresos: ${st.receivedInRange}`);
    } else if (effectiveFrom && st.gastoInRange > 0) {
      obsParts.push(`Gasto (${effectiveFrom} a ${effectiveTo}): ${st.gastoInRange}`);
    }
    for (const rem of st.remarks) obsParts.push(rem);

    const dataRow = ws.addRow([
      CATEGORY_EXCEL_LABEL[r.item.category] ?? r.item.category,
      r.item.id,
      r.item.name,
      cantidad,
      obsParts.length > 0 ? obsParts.join(" | ") : null,
    ]);
    styleTemplateDataRow(dataRow);
  };

  // Block 1: Insumos Médicos
  const h1 = ws.addRow(["Categoría", "Código", "Nombre", "Cantidad", "Observaciones"]);
  styleTemplateSectionHeader(h1, "medium");
  for (const r of supplyRows) writeDataRow(r);

  // Block 2: Medicación y Soluciones Intravenosas
  const h2 = ws.addRow(["     Categoría", "Código", "Nombre", "Cantidad", "Observaciones"]);
  styleTemplateSectionHeader(h2, "thin");
  for (const r of medicineRows) writeDataRow(r);

  // Block 3: ADICIONALES
  if (additionalRows.length > 0) {
    const bannerRow = ws.addRow(["ADICIONALES", "", "", "", ""]);
    ws.mergeCells(`A${bannerRow.number}:E${bannerRow.number}`);
    styleTemplateBannerRow(bannerRow);

    const h3 = ws.addRow(["Categoría", "Código", "Nombre", "Cantidad", "Observaciones"]);
    styleTemplateSectionHeader(h3, "medium");
    for (const r of additionalRows) writeDataRow(r);
  }

  ws.getColumn(1).width = 19.43;
  ws.getColumn(2).width = 17;
  ws.getColumn(3).width = 55.86;
  ws.getColumn(4).width = 11.57;
  ws.getColumn(5).width = hasCustomRange ? 32 : 15.14;

  return report;
}

/**
 * The /stock export in the exact "Reporte Control de Gastos Insumos y Medicamentos" layout,
 * plus the "LOTES" breakdown tab.
 */
export async function stockWorkbook(ctx: Ctx, filter: StockExportOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MediCheck";
  wb.created = new Date();

  const report = await addControlDeGastosSheet(wb, ctx, filter);

  const batches = wb.addWorksheet("LOTES");
  batches.addRow([...BATCH_HEADERS]);
  for (const row of report.rows) {
    for (const batch of row.batches) {
      batches.addRow([
        row.item.id,
        row.item.variant ? `${row.item.name} ${row.item.variant}` : row.item.name,
        batch.label ? `${batch.id} ${batch.label}` : String(batch.id),
        batch.expiry,
        batch.receivedOn,
        batch.source,
        batch.qtyReceived,
        batch.balance,
      ]);
    }
  }
  styleHeader(batches);
  batches.getColumn(1).width = 16;
  batches.getColumn(2).width = 45;
  for (const n of [3, 4, 5, 7, 8]) batches.getColumn(n).width = 15;
  batches.getColumn(6).width = 24;
  batches.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- shared styling ----------

const TEMPLATE_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9E1F2" },
};

function styleTemplateBannerRow(row: ExcelJS.Row): void {
  row.height = 15.75;
  const medium = { style: "medium" as const };
  for (let c = 1; c <= 5; c++) {
    const cell = row.getCell(c);
    cell.font = { name: "Century Gothic", size: 10, bold: true };
    cell.fill = TEMPLATE_HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "top" };
    cell.border = { top: medium, bottom: medium, left: medium, right: medium };
  }
}

function styleTemplateSectionHeader(row: ExcelJS.Row, borderStyle: "medium" | "thin"): void {
  row.height = 15.75;
  const b = { style: borderStyle };
  for (let c = 1; c <= 5; c++) {
    const cell = row.getCell(c);
    cell.font = { name: "Century Gothic", size: 10, bold: true };
    cell.fill = TEMPLATE_HEADER_FILL;
    cell.alignment = {
      horizontal: borderStyle === "medium" ? "center" : "left",
      vertical: "top",
    };
    cell.border = { top: b, bottom: b, left: b, right: b };
  }
}

function styleTemplateDataRow(row: ExcelJS.Row): void {
  const thin = { style: "thin" as const };
  for (let c = 1; c <= 5; c++) {
    const cell = row.getCell(c);
    cell.font = { name: "Century Gothic", size: 10 };
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    if (c === 4) {
      cell.alignment = { horizontal: "right", vertical: "top" };
    } else {
      cell.alignment = { horizontal: "left", vertical: "top" };
    }
  }
}

function styleHeader(ws: ExcelJS.Worksheet): void {
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

const OPENING_FILL = "FFDEEAF6"; // light blue
const DISPENSED_FILL = "FFE2EFD9"; // light green
const DISPENSED_FONT = "FFFF0000"; // red

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

const THIN = { style: "thin" as const };
const edged = (): ExcelJS.Borders =>
  ({ top: THIN, left: THIN, right: THIN, bottom: THIN }) as ExcelJS.Borders;

export function styleWideSheet(ws: ExcelJS.Worksheet, columnCount: number): void {
  ws.getRow(1).font = { bold: true, size: 18 };

  const header = ws.getRow(3);
  header.height = 51.75;
  header.font = { bold: true, size: 12 };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  for (let c = 2; c <= columnCount; c++) {
    const cell = header.getCell(c);
    cell.border = edged();
    if (c === 5 || c === columnCount) cell.fill = solidFill(OPENING_FILL);
    else if (c >= 6 && c % 2 === 0) cell.fill = solidFill(DISPENSED_FILL);
  }

  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.getCell(1).font = { size: 11 };
    row.getCell(2).font = { bold: true, size: 11 };
    for (let c = 2; c <= columnCount; c++) {
      const cell = row.getCell(c);
      cell.border = edged();
      if (c === 3 || c === 4) {
        cell.numFmt = "@";
        continue;
      }
      if (c >= 5) {
        cell.font = { size: 11 };
        cell.alignment = { horizontal: "center" };
      }
      if (c >= 6 && c < columnCount && c % 2 === 0) {
        cell.font = { bold: true, size: 11, color: { argb: DISPENSED_FONT } };
        cell.fill = solidFill(DISPENSED_FILL);
        cell.alignment = { horizontal: "center" };
      }
    }
  }

  ws.getColumn(1).width = 3.29;
  ws.getColumn(2).width = 38.86;
  ws.getColumn(3).width = 17;
  ws.getColumn(4).width = 13.29;
  ws.getColumn(5).width = 20.71;
  for (let c = 6; c <= columnCount - 2; c++) ws.getColumn(c).width = c % 2 === 0 ? 12.43 : 11.14;
  ws.getColumn(columnCount - 1).width = 11.14;
  ws.getColumn(columnCount).width = 15.57;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 3 }];
}
