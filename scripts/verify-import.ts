// Verifica los datos importados en la base de datos contra NURSE.xlsx.
//
// Uso:
//   npm run import:verify -- --workbook "C:\ruta\a\NURSE.xlsx"
//
// Lee las transacciones desde Postgres, reconstruye cada saldo de fin de mes a partir de ellas y
// los compara con el ENDING BALANCE que el libro de Excel registró para el último día de cada mes.
// Es independiente del importador: prueba lo que está almacenado, no lo que fue planificado.

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { readWorkbook } from "../src/lib/workbook.ts";
import { fromDbDate } from "../src/lib/dates.ts";

const { values } = parseArgs({
  options: {
    workbook: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !values.workbook) {
  console.log("Uso: npm run import:verify -- --workbook <ruta>");
  process.exit(values.help ? 0 : 1);
}

const prisma = new PrismaClient();

async function main() {
  const parsed = await readWorkbook(values.workbook!);
  const txs = await prisma.transaction.findMany({
    where: { voidedAt: null },
    select: { itemId: true, batchId: true, date: true, type: true, qty: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  if (txs.length === 0) {
    console.error("La base de datos no contiene transacciones. Ejecuta `npm run import:workbook -- --apply` primero.");
    process.exit(1);
  }

  const byItem = new Map<string, { date: string; qty: number }[]>();
  const byBatch = new Map<number, number>();
  let receivedInDb = 0;
  let dispensedInDb = 0;

  for (const t of txs) {
    const date = fromDbDate(t.date)!;
    let list = byItem.get(t.itemId);
    if (!list) byItem.set(t.itemId, (list = []));
    list.push({ date, qty: t.qty });
    byBatch.set(t.batchId, (byBatch.get(t.batchId) ?? 0) + t.qty);
    if (t.type === "RECEIVE") receivedInDb += t.qty;
    if (t.type === "DISPENSE") dispensedInDb += -t.qty;
  }

  let checked = 0;
  const mismatches: string[] = [];
  let receivedInWb = 0;
  let dispensedInWb = 0;

  for (const month of parsed.months) {
    const expected = new Map<string, number>();
    for (const row of month.rows) {
      expected.set(row.itemId, row.ending);
      receivedInWb += row.received;
      dispensedInWb += row.dispensed;
    }
    for (const [itemId, ending] of expected) {
      checked++;
      const list = byItem.get(itemId) ?? [];
      let sum = 0;
      for (const e of list) if (e.date <= month.lastDate) sum += e.qty;
      if (sum !== ending) {
        mismatches.push(`${month.month} ${itemId}: la BD suma ${sum}, el libro dice ${ending}`);
      }
    }
  }

  const negativeBatches = [...byBatch.entries()].filter(([, v]) => v < 0);

  console.log(`Verificadas ${txs.length} transacciones en ${byBatch.size} lotes.`);
  console.log(`  Cierres de mes verificados: ${checked}, diferencias: ${mismatches.length}`);
  console.log(`  Total recibido:             libro ${receivedInWb}, BD ${receivedInDb}`);
  console.log(`  Total entregado:            libro ${dispensedInWb}, BD ${dispensedInDb}`);
  console.log(`  Lotes negativos:            ${negativeBatches.length}`);

  for (const m of mismatches.slice(0, 20)) console.error(`  DIFERENCIA: ${m}`);
  for (const [id, v] of negativeBatches) console.error(`  LOTE NEGATIVO #${id}: ${v}`);

  if (
    mismatches.length > 0 ||
    negativeBatches.length > 0 ||
    receivedInWb !== receivedInDb ||
    dispensedInWb !== dispensedInDb
  ) {
    process.exit(1);
  }
  console.log("OK: la base de datos coincide con el libro de Excel en cada cierre de mes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
