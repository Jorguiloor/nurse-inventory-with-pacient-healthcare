// Importa NURSE.xlsx en la base de datos o imprime el informe de reconciliación sin escribir nada.
//
// Uso:
//   npm run import:workbook -- --report --workbook "C:\ruta\a\NURSE.xlsx"
//   npm run import:workbook -- --apply  --workbook "C:\ruta\a\NURSE.xlsx"
//   npm run import:workbook -- --apply  --workbook "C:\ruta\a\NURSE.xlsx" --reject-gap MED-018:2026-02-01
//   npm run import:workbook -- --apply  --workbook "C:\ruta\a\NURSE.xlsx" --reset

import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { PrismaClient, Role, TxType as PrismaTxType } from "@prisma/client";
import { readWorkbook } from "../src/lib/workbook.ts";
import { batchKey, buildImportPlan, splitBatchKey, type ImportPlan } from "../src/lib/import-ledger.ts";
import { today } from "../src/lib/dates.ts";

const USAGE = `Uso:
  npm run import:workbook -- (--report | --apply) --workbook <ruta>
                             [--out <import-report.json>]
                             [--user <correo>]
                             [--reject-gap <ARTICULO:AAAA-MM-DD>]...
                             [--reset]

  --report       Analiza el libro de Excel, ejecuta todas las verificaciones, escribe el informe JSON e imprime un resumen.
                 No modifica la base de datos.
  --apply        Igual que --report, luego escribe los lotes y movimientos en una única transacción.
                 Se niega a ejecutar si existen diferencias de fin de mes o si ya hay movimientos previos
                 (pasa --reset para limpiar primero las tablas de importación).
  --reject-gap   Omite el ajuste automático para una brecha de apertura de mes específica, por ejemplo:
                 --reject-gap MED-018:2026-02-01. Puede pasarse varias veces.
  --user         Correo electrónico de la cuenta ADMIN a cuyo nombre se registrarán las filas importadas.
                 Por defecto toma el primer ADMIN activo.`;

const { values } = parseArgs({
  options: {
    workbook: { type: "string" },
    report: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    out: { type: "string", default: "import-report.json" },
    user: { type: "string" },
    "reject-gap": { type: "string", multiple: true, default: [] },
    reset: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !values.workbook || (!values.report && !values.apply)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const rejected = new Set(values["reject-gap"] ?? []);
for (const spec of rejected) {
  if (!/^[A-Z]+-\d{3}:\d{4}-\d{2}-\d{2}$/.test(spec)) {
    console.error(`--reject-gap debe tener el formato ARTICULO:AAAA-MM-DD (se recibió "${spec}").`);
    process.exit(1);
  }
}

function dropRejectedGaps(plan: ImportPlan, rejectedSpecs: Set<string>): void {
  if (rejectedSpecs.size === 0) return;
  const keep: typeof plan.transactions = [];
  for (const tx of plan.transactions) {
    if (tx.type === "ADJUST" && rejectedSpecs.has(`${tx.itemId}:${tx.date}`)) {
      plan.summary.counts.ADJUST--;
      plan.summary.adjustUnits -= tx.qty;
      const key = batchKey(tx.itemId, tx.expiry);
      plan.batchBalances.set(key, (plan.batchBalances.get(key) ?? 0) - tx.qty);
      continue;
    }
    keep.push(tx);
  }
  plan.transactions = keep;
}

function toJsonReport(plan: ImportPlan, parsed: Awaited<ReturnType<typeof readWorkbook>>) {
  return {
    generatedAt: new Date().toISOString(),
    workbook: values.workbook,
    rejectedGaps: [...rejected],
    summary: plan.summary,
    reconciliation: {
      monthEndsChecked: plan.reconciliation.rows.length,
      mismatches: plan.reconciliation.mismatches,
      received: {
        inWorkbook: plan.reconciliation.receivedInWorkbook,
        planned: plan.reconciliation.receivedPlanned,
      },
      dispensed: {
        inWorkbook: plan.reconciliation.dispensedInWorkbook,
        planned: plan.reconciliation.dispensedPlanned,
      },
    },
    months: parsed.months.map((m) => ({
      sheet: m.sheet,
      month: m.month,
      rows: m.rows.length,
      firstDate: m.firstDate,
      lastDate: m.lastDate,
    })),
    sources: parsed.sources,
    gaps: plan.gaps,
    lateOpenings: plan.lateOpenings,
    overIssued: plan.overIssued,
    noExpiry: plan.noExpiry,
    expired: plan.expired,
    stoppedRecording: plan.stoppedRecording,
    unusedItems: plan.unusedItems,
    unmatchedWideRows: parsed.unmatched,
  };
}

function printSummary(plan: ImportPlan, parsed: Awaited<ReturnType<typeof readWorkbook>>) {
  const s = plan.summary;
  const r = plan.reconciliation;
  console.log(`Libro de Excel: ${values.workbook}`);
  console.log(`  Artículos en pestaña ITEMS: ${parsed.items.length} (${s.items} con filas, ${plan.unusedItems.length} sin uso)`);
  console.log(`  Pestañas mensuales:         ${s.months} (${s.firstDate} .. ${s.lastDate}, ${s.days} días activos)`);
  console.log(`  Lotes planificados:         ${plan.batches.length} (${s.stockedBatches} con stock al final)`);
  console.log(
    `  Movimientos planificados:   ${plan.transactions.length} ` +
      `(OPENING ${s.counts.OPENING}, RECEIVE ${s.counts.RECEIVE}, DISPENSE ${s.counts.DISPENSE}, ADJUST ${s.counts.ADJUST})`,
  );
  console.log(
    `  Unidades:                   iniciales ${s.openingUnits} + recibidas ${s.receivedUnits} ` +
      `- entregadas ${s.dispensedUnits} + ajustes ${s.adjustUnits} = disponibles ${s.unitsOnHand}`,
  );
  console.log("");
  console.log("Reconciliación contra el libro:");
  console.log(`  Cierres de mes verificados: ${r.rows.length}, diferencias: ${r.mismatches.length}`);
  console.log(`  Total recibido:             libro ${r.receivedInWorkbook}, planificado ${r.receivedPlanned}`);
  console.log(`  Total entregado:            libro ${r.dispensedInWorkbook}, planificado ${r.dispensedPlanned}`);
  console.log(`  Entregas sobre stock:       ${plan.overIssued.length}`);
  console.log("");
  console.log("Elementos para revisión:");
  console.log(`  Brechas de apertura de mes: ${plan.gaps.length}`);
  for (const g of plan.gaps) {
    const tag = rejected.has(`${g.itemId}:${g.date}`) ? " [RECHAZADO]" : "";
    const where = g.midTab ? `${g.month} mitad de pestaña` : `${g.previousMonth} -> ${g.month}`;
    console.log(
      `    ${g.itemId} el ${g.date} (${where}): ${g.from} -> ${g.to} (${g.difference > 0 ? `+${g.difference}` : g.difference})${tag}`,
    );
  }
  console.log(`  Aperturas tardías:          ${plan.lateOpenings.length}`);
  console.log(`  En stock sin vencimiento:   ${plan.noExpiry.length} lotes`);
  console.log(`  En stock ya vencidos:       ${plan.expired.length} lotes`);
  for (const e of plan.expired) {
    console.log(`    ${e.itemId} vence ${e.expiry}: ${e.balance} en stock`);
  }
  console.log(`  Dejaron de registrarse:     ${plan.stoppedRecording.length} artículos`);
  for (const st of plan.stoppedRecording) {
    console.log(`    ${st.itemId} última fila ${st.lastDate} (saldo ${st.balance})`);
  }
  if (parsed.unmatched.length) {
    console.log(`  Filas anchas sin coincidir: ${parsed.unmatched.length}`);
    for (const u of parsed.unmatched) console.log(`    ${u.sheet} fila ${u.row}: ${u.name}`);
  }
}

const toDate = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

async function applyPlan(plan: ImportPlan, report: ReturnType<typeof toJsonReport>) {
  for (const [key, balance] of plan.batchBalances) {
    if (balance < 0) {
      const { itemId, expiry } = splitBatchKey(key);
      throw new Error(`El lote ${itemId} (${expiry ?? "sin vencimiento"}) terminaría en ${balance}; se rechaza la aplicación.`);
    }
  }

  const prisma = new PrismaClient();
  try {
    const actor = values.user
      ? await prisma.user.findUnique({ where: { email: values.user.trim().toLowerCase() } })
      : await prisma.user.findFirst({ where: { role: Role.ADMIN, active: true }, orderBy: { id: "asc" } });
    if (!actor || actor.role !== Role.ADMIN || !actor.active) {
      throw new Error(
        values.user
          ? `${values.user} no es un usuario ADMIN activo.`
          : "No se encontró ningún usuario ADMIN activo. Ejecuta `npm run db:seed` o `npm run user:create` primero.",
      );
    }

    const existingTx = await prisma.transaction.count();
    if (existingTx > 0 && !values.reset) {
      throw new Error(
        `La base de datos ya contiene ${existingTx} transacciones. Pasa --reset para limpiar e importar de nuevo.`,
      );
    }

    const dbItems = new Set((await prisma.item.findMany({ select: { id: true } })).map((i) => i.id));
    const missing = [...new Set(plan.batches.map((b) => b.itemId))].filter((id) => !dbItems.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Faltan ${missing.length} artículos del libro en la base de datos (${missing.slice(0, 5).join(", ")}). ` +
          `Ejecuta \`npm run db:seed\` primero.`,
      );
    }

    console.log("");
    console.log(`Aplicando como ${actor.email} (id=${actor.id})...`);

    await prisma.$transaction(
      async (tx) => {
        if (values.reset) {
          await tx.monthClosing.deleteMany({});
          await tx.closedMonth.deleteMany({});
          await tx.transaction.deleteMany({});
          await tx.batch.deleteMany({});
          await tx.auditLog.deleteMany({ where: { action: "workbook.import" } });
        }

        const batchIds = new Map<string, number>();
        for (const b of plan.batches) {
          const created = await tx.batch.create({
            data: {
              itemId: b.itemId,
              expiry: toDate(b.expiry),
              receivedOn: toDate(b.receivedOn),
              source: b.source,
              qtyReceived: b.qtyReceived,
            },
            select: { id: true },
          });
          batchIds.set(batchKey(b.itemId, b.expiry), created.id);
        }

        const rows = plan.transactions.map((t) => {
          const batchId = batchIds.get(batchKey(t.itemId, t.expiry));
          if (!batchId) throw new Error(`No existe lote para ${t.itemId} (${t.expiry}).`);
          return {
            date: toDate(t.date)!,
            itemId: t.itemId,
            batchId,
            type: t.type as PrismaTxType,
            qty: t.qty,
            source: t.source,
            remarks: t.remarks,
            userId: actor.id,
          };
        });

        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          await tx.transaction.createMany({ data: rows.slice(i, i + CHUNK) });
        }

        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: "workbook.import",
            entity: "Workbook",
            entityId: "NURSE.xlsx",
            detail: JSON.parse(
              JSON.stringify({
                appliedAt: new Date().toISOString(),
                workbook: values.workbook,
                rejectedGaps: [...rejected],
                summary: report.summary,
                reconciliation: report.reconciliation,
                months: report.months,
                sources: report.sources,
                gaps: report.gaps,
                lateOpenings: report.lateOpenings,
                noExpiry: report.noExpiry,
                expired: report.expired,
                stoppedRecording: report.stoppedRecording,
                unusedItems: report.unusedItems,
                unmatchedWideRows: report.unmatchedWideRows,
              }),
            ),
          },
        });
      },
      { maxWait: 30_000, timeout: 120_000 },
    );

    console.log(`Se importaron ${plan.batches.length} lotes y ${plan.transactions.length} transacciones.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const parsed = await readWorkbook(values.workbook!);
  const plan = buildImportPlan(parsed, { today: today() });
  dropRejectedGaps(plan, rejected);

  const report = toJsonReport(plan, parsed);
  writeFileSync(values.out!, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(plan, parsed);
  console.log("");
  console.log(`Informe escrito en ${values.out}`);

  if (plan.reconciliation.mismatches.length > 0 && rejected.size === 0) {
    console.error(`Reconciliación fallida: ${plan.reconciliation.mismatches.length} cierres de mes no coinciden.`);
    process.exit(1);
  }
  if (plan.overIssued.length > 0) {
    console.error(`Reconciliación fallida: ${plan.overIssued.length} días entregaron más de lo disponible en los lotes.`);
    process.exit(1);
  }

  if (values.apply) {
    await applyPlan(plan, report);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
