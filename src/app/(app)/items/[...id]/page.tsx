"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { CATEGORIES, type Category, type ItemPatchBody } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import { TxTable } from "@/components/TxTable";
import { Pagination, usePaging } from "@/components/Pagination";
import { BalanceLineChart, UsageTrendChart } from "@/components/Charts";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Field,
  Input,
  Checkbox,
  IconChevron,
  Loading,
  PageHeader,
  Panel,
  Select,
  Stat,
  TableWrap,
  categoryLabel,
  cn,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

function decodeParamId(raw: string | string[] | undefined): string {
  if (!raw) return "";
  const joined = Array.isArray(raw) ? raw.join("/") : raw;
  try {
    return decodeURIComponent(joined);
  } catch {
    return joined;
  }
}

export default function ItemDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const id = decodeParamId(params?.id);
  const { isAdmin } = usePermissions();
  const { data, error, loading, reload } = useApi(() => api.item(id), [id]);
  const [editing, setEditing] = useState(false);

  // The batch list can grow long, so it is Paginated like every other table.
  const batchPage = usePaging(data?.batches ?? [], 10, id);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  const { item, batches, transactions, monthly, balances } = data;
  const stocked = batches.filter((b) => b.balance !== 0);
  // Every month is labelled, but twenty-odd of them is too many to read on an axis, so the
  // chart thins them out rather than rotating the labels.
  const step = Math.max(1, Math.ceil(monthly.length / 12));
  const usage = monthly.filter((_, i) => i % step === 0 || i === monthly.length - 1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/items"
          className="-ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <IconChevron className="size-4 rotate-180" />
          Todos los artículos
        </Link>
        <PageHeader
          title={item.variant ? `${item.name} · ${item.variant}` : item.name}
          description={
            <span className="font-mono">
              {item.id} · {categoryLabel(item.category)}
              {!item.active ? " · inactivo" : ""}
            </span>
          }
          actions={
            isAdmin ? (
              <Button variant="plain" onClick={() => setEditing((v) => !v)}>
                {editing ? "Dejar de editar" : "Editar artículo"}
              </Button>
            ) : undefined
          }
        />
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="En existencia" value={data.balance} tone={data.lowStock ? "warn" : "plain"} hint={item.unit ?? "Sin unidad asignada"} />
        <Stat label="Lotes con stock" value={stocked.length} hint={`${batches.length} en total`} />
        <Stat label="Unidad" value={item.unit ?? "—"} tone={item.unit ? "plain" : "warn"} hint="Usada en cada movimiento" />
        <Stat
          label="Reordenar en"
          value={item.reorderLevel ?? "—"}
          tone={item.reorderLevel === null ? "warn" : "plain"}
          hint={item.reorderLevel === null ? "No definido" : "Stock bajo en o debajo de este valor"}
        />
      </dl>

      {data.lowStock ? (
        <Alert tone="warn">
          <span className="font-medium">En o por debajo del nivel de reorden de {item.reorderLevel}.</span>{" "}
          <Link href="/receive" className="font-medium underline underline-offset-2">
            Ingresar stock
          </Link>
        </Alert>
      ) : null}

      {editing && isAdmin ? <EditItemPanel itemId={item.id} current={item} onSaved={reload} /> : null}

      <Panel
        title="Lotes"
        description="Cada lote corresponde a una fecha de vencimiento. De aquí se suman todas las existencias."
      >
        {batches.length === 0 ? (
          <EmptyState
            title="Aún no hay lotes."
            hint="Un lote aparece cuando se recibe stock. Los artículos sin fecha de vencimiento conocida usan un lote compartido «sin vencimiento»."
            action={<Link href="/receive">Ingresar stock</Link>}
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Lote</th>
                  <th scope="col" className={thClass}>Vencimiento</th>
                  <th scope="col" className={thClass}>Estado</th>
                  <th scope="col" className={thClass}>Recibido el</th>
                  <th scope="col" className={thRightClass}>Ingreso</th>
                  <th scope="col" className={thRightClass}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {batchPage.rows.map((b) => (
                  <tr key={b.id} className={rowClass}>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      #{b.id}
                      {b.label ? <span className="ml-1 text-muted">{b.label}</span> : null}
                      {b.source ? <span className="ml-1 text-muted">· {b.source}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{b.expiry ?? "desconocido"}</td>
                    <td className="px-3 py-2.5"><ExpiryBadge status={b.expiryStatus} /></td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">{b.receivedOn ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted">{b.qtyReceived}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono font-medium", b.balance === 0 && "text-muted")}>
                      {b.balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination total={batches.length} page={batchPage.page} pageSize={batchPage.pageSize} onPage={batchPage.setPage} />
          </>
        )}
      </Panel>

      <Panel
        title="Consumo y existencias en el tiempo"
        description="Reconstruido mes a mes a partir de los registros. Si hay muchos meses, se espacian las barras para facilitar la lectura."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-sm font-medium">Recibido y dispensado</p>
            <UsageTrendChart data={usage} />
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-sm font-medium">
              En existencia al cierre de cada mes
              {item.reorderLevel ? (
                <span className="ml-1 font-normal text-muted">· la línea punteada es el nivel de reorden</span>
              ) : null}
            </p>
            <BalanceLineChart data={balances} reorderLevel={item.reorderLevel} />
          </Card>
        </div>
      </Panel>

      <Panel title="Movimientos" description="Todo lo registrado para este artículo, del más reciente al más antiguo.">
        <TxTable
          transactions={transactions}
          showItem={false}
          onChanged={reload}
          emptyTitle="Aún no hay movimientos para este artículo."
          emptyHint="Usa «Registrar movimiento» para ingresar el primer lote."
        />
      </Panel>
    </div>
  );
}

function EditItemPanel({
  itemId,
  current,
  onSaved,
}: {
  itemId: string;
  current: {
    name: string;
    variant: string | null;
    category: Category;
    unit: string | null;
    reorderLevel: number | null;
    active: boolean;
  };
  onSaved: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<{
    name: string;
    variant: string;
    category: Category;
    unit: string;
    reorderLevel: string;
    active: boolean;
  }>({
    name: current.name,
    variant: current.variant ?? "",
    category: current.category,
    unit: current.unit ?? "",
    reorderLevel: current.reorderLevel === null ? "" : String(current.reorderLevel),
    active: current.active,
  });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleting(true);
    setError(undefined);
    try {
      await api.deleteItem(itemId);
      router.replace("/items");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el artículo.");
      setDeleting(false);
      setConfirming(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: ItemPatchBody = {
      name: form.name,
      variant: form.variant || null,
      category: form.category,
      unit: form.unit || null,
      // Blank or zero means "no reorder level", which turns off the low-stock flag.
      reorderLevel: form.reorderLevel === "" || Number(form.reorderLevel) === 0 ? null : Number(form.reorderLevel),
      active: form.active,
    };
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await api.patchItem(itemId, patch);
      setNotice("Guardado.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Editar artículo"
      description="La unidad y el nivel de reorden controlan la alerta de stock bajo, por lo que modificarlos actualiza todas las pantallas."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="e-name">
            <Input id="e-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Variante o marca" htmlFor="e-variant">
            <Input
              id="e-variant"
              value={form.variant}
              onChange={(e) => setForm({ ...form, variant: e.target.value })}
            />
          </Field>
          <Field label="Categoría" htmlFor="e-category">
            <Select
              id="e-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unidad" htmlFor="e-unit" hint="p. ej. caja, frasco, tableta.">
            <Input id="e-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </Field>
          <Field label="Nivel de reorden" htmlFor="e-level" hint="Vacío o 0 desactiva la alerta de stock bajo.">
            <Input
              id="e-level"
              type="number"
              min={0}
              step={1}
              value={form.reorderLevel}
              onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
            />
          </Field>
          <Field label="Estado" htmlFor="e-active" hint="Los artículos inactivos se ocultan en todas las pantallas.">
            <div className="flex h-[38px] items-center">
              <Checkbox
                id="e-active"
                label={form.active ? "En el catálogo" : "Oculto"}
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
            </div>
          </Field>
        </div>

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" disabled={busy}>
            {busy ? "Guardando…" : "Guardar cambios"}
          </Button>
          <span className="text-xs text-muted">Se registra directamente en la bitácora de actividad.</span>
        </div>

        <div className="mt-2 border-t border-rule pt-4">
          <p className="text-sm font-medium text-danger">Eliminar este artículo</p>
          <p className="mt-0.5 text-xs text-muted">
            Elimina {current.name} junto con todos sus lotes y movimientos registrados. Esta acción no se puede deshacer;
            desactivarlo en su lugar conserva todo el historial.
          </p>
          {confirming ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="w-full text-sm font-medium text-danger">
                ¿Realmente deseas eliminar {itemId} de forma permanente?
              </p>
              <Button variant="danger" size="md" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? "Eliminando…" : "Sí, eliminarlo"}
              </Button>
              <Button type="button" variant="plain" size="md" onClick={() => setConfirming(false)} disabled={deleting}>
                Conservarlo
              </Button>
            </div>
          ) : (
            <Button type="button" variant="danger" size="md" className="mt-3" onClick={() => setConfirming(true)}>
              Eliminar artículo
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}
