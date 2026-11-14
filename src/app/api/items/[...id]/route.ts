import { context } from "@/server/context";
import { handle } from "@/server/http";
import { deleteItem, updateItem } from "@/server/items";
import { getItem } from "@/server/inventory";
import { itemPatchSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string | string[] }> };

function resolveItemId(raw: string | string[]): string {
  const joined = Array.isArray(raw) ? raw.join("/") : raw;
  try {
    return decodeURIComponent(joined);
  } catch {
    return joined;
  }
}

/** GET /api/items/:id — the item, its batches with balances, and its recent entries. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const ctx = await context();
    const { id } = await params;
    return await getItem(ctx, resolveItemId(id));
  });
}

/** PATCH /api/items/:id  (admin) */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const ctx = await context();
    const { id } = await params;
    const patch = itemPatchSchema.parse(await request.json());
    return { item: await updateItem(ctx, resolveItemId(id), patch) };
  });
}

/** DELETE /api/items/:id  (admin) — removes the item, its batches, entries and month counts. */
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const ctx = await context();
    const { id } = await params;
    await deleteItem(ctx, resolveItemId(id));
    return { ok: true };
  });
}
