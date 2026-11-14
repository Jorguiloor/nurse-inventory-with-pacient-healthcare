import { db } from "@/lib/db";
import type { SyncSnapshot } from "@/lib/api-types";
import { context, NURSE_BACKDATE_DAYS } from "@/server/context";
import { handle } from "@/server/http";
import { fromDbDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync — the whole working set, so an offline device can mirror it in IndexedDB.
 *
 * No balances are sent: they are the sum of the entries, and the device applies the same
 * rules (src/lib/stock.ts) to rebuild them. Voided entries are included so the local history
 * can show them exactly as the server does.
 */
export async function GET() {
  return handle(async (): Promise<SyncSnapshot> => {
    const ctx = await context();

    const [items, batches, transactions, closed] = await Promise.all([
      db.item.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          name: true,
          variant: true,
          category: true,
          unit: true,
          reorderLevel: true,
          active: true,
        },
      }),
      db.batch.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          itemId: true,
          expiry: true,
          label: true,
          source: true,
          receivedOn: true,
          qtyReceived: true,
        },
      }),
      db.transaction.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          clientId: true,
          date: true,
          itemId: true,
          batchId: true,
          type: true,
          qty: true,
          source: true,
          remarks: true,
          user: { select: { name: true } },
          voidedAt: true,
          voidReason: true,
        },
      }),
      db.closedMonth.findMany({ orderBy: { month: "asc" }, select: { month: true } }),
    ]);

    return {
      today: ctx.today,
      user: ctx.user,
      closedMonths: closed.map((c) => c.month),
      nurseBackdateDays: NURSE_BACKDATE_DAYS,
      serverTime: new Date().toISOString(),
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        variant: i.variant,
        category: i.category,
        unit: i.unit,
        reorderLevel: i.reorderLevel,
        active: i.active,
      })),
      batches: batches.map((b) => ({
        id: b.id,
        itemId: b.itemId,
        expiry: fromDbDate(b.expiry),
        label: b.label,
        source: b.source,
        receivedOn: fromDbDate(b.receivedOn),
        qtyReceived: b.qtyReceived,
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        clientId: t.clientId,
        date: fromDbDate(t.date)!,
        itemId: t.itemId,
        batchId: t.batchId,
        type: t.type,
        qty: t.qty,
        source: t.source,
        remarks: t.remarks,
        userName: t.user.name,
        voidedAt: t.voidedAt ? t.voidedAt.toISOString() : null,
        voidReason: t.voidReason,
      })),
    };
  });
}
