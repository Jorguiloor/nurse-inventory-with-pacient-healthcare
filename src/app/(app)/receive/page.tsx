"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ItemDetail, ItemSummary, MovementBody, MovementResult } from "@/lib/api-types";
import { CATEGORIES } from "@/lib/api-types";
import { monthOf } from "@/lib/dates";
import { allocateFefo } from "@/lib/stock";
import { usePermissions } from "@/components/SessionProvider";
import { useFocusMode } from "@/components/FocusMode";
import { ItemPicker } from "@/components/ItemPicker";
import { Pagination, usePaging } from "@/components/Pagination";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Loading,
  LowBadge,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  TableWrap,
  Textarea,
  categoryLabel,
  cn,
  linkClass,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

type Kind = "RECEIVE" | "DISPENSE" | "DISPOSE" | "ADJUST";

const TABS: { kind: Kind; label: string; blurb: string }[] = [
  {
    kind: "RECEIVE",
    label: "Entrada / Recibido",
    blurb: "Stock que ingresa — desde un proveedor, entrega o pedido. La fecha de vencimiento que ingresas determina el lote.",
  },
  {
    kind: "DISPENSE",
    label: "Salida / Dispensado",
    blurb: "Medicamentos o insumos entregados a pacientes o áreas. Sugiere el lote próximo a vencer (FEFO).",
  },
  {
    kind: "DISPOSE",
    label: "Descarte / Merma",
    blurb: "Stock retirado por vencimiento, rotura o deterioro. Selecciona el lote de origen y especifica la causa.",
  },
  {
    kind: "ADJUST",
    label: "Ajuste de conteo",
    blurb: "Corrige las existencias de un lote para que coincida exactamente con el conteo físico real.",
  },
];

/** One batch row in the "which batch" table, with the amount the nurse is taking from it. */
interface Line {
  batchId: number;
  qty: number;
  expiry: string | null;
  label: string | null;
  balance: number;
}

export default function ReceivePage() {
  const { isAdmin, today, nurseBackdateDays, closedMonths } = usePermissions();
  const { focus, setFocus } = useFocusMode();

  const [kind, setKind] = useState<Kind>("RECEIVE");
  const [receiveType, setReceiveType] = useState<"RECEIVE" | "OPENING">("RECEIVE");
  const [item, setItem] = useState<ItemSummary>();
  const [detail, setDetail] = useState<ItemDetail>();
  const [qty, setQty] = useState("");
  const [expiry, setExpiry] = useState("");
  const [lot, setLot] = useState("");
  const [batchId, setBatchId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [manual, setManual] = useState<Record<number, number>>({});
  const [edited, setEdited] = useState(false);
  const [date, setDate] = useState(today);
  const [source, setSource] = useState("");
  const [remarks, setRemarks] = useState("");
  const [result, setResult] = useState<MovementResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [allItems, setAllItems] = useState<ItemSummary[]>();
  const [listQuery, setListQuery] = useState("");
  const [listCategory, setListCategory] = useState("ALL");

  const amount = Number(qty);
  const monthClosed = closedMonths.includes(monthOf(date));

  // Load every item once (again after each save, so the balances in the overview stay true).
  useEffect(() => {
    let live = true;
    api
      .items()
      .then((r) => live && setAllItems(r.items))
      .catch(() => live && setAllItems([]));
    return () => {
      live = false;
    };
  }, [result]);

  // Filter in the browser, the same way the item picker does.
  const filteredItems = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return (allItems ?? []).filter((i) => {
      if (listCategory !== "ALL" && i.category !== listCategory) return false;
      if (!q) return true;
      return `${i.id} ${i.name} ${i.variant ?? ""}`.toLowerCase().includes(q);
    });
  }, [allItems, listQuery, listCategory]);

  // Ten to a page: a long catalogue reads better in small pages than one long scroll.
  const listPage = usePaging(filteredItems, 10, `${listQuery}|${listCategory}`);
  const pageItems = listPage.rows;

  // Choosing from the overview table fills the form above and clears whatever was half-typed.
  const choose = (picked: ItemSummary) => {
    setItem(picked);
    setQty("");
    setExpiry("");
    setLot("");
    setBatchId("");
    setAdjustQty("");
    setManual({});
    setEdited(false);
    setResult(undefined);
    setError(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Deep-link straight to a tab, e.g. the dashboard's "Dispense stock" shortcut.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")?.toUpperCase();
    const match = TABS.find((t) => t.kind === requested);
    if (match) setKind(match.kind);
  }, []);

  // Load the item's batches: the ADJUST tab picks one directly; the others list every usable batch.
  useEffect(() => {
    if (!item || kind === "RECEIVE") {
      setDetail(undefined);
      setManual({});
      return;
    }
    let live = true;
    setDetail(undefined);
    setManual({});
    setEdited(false);
    api
      .item(item.id)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : undefined));
    return () => {
      live = false;
    };
  }, [item, kind]);

  // A new quantity starts the split fresh from earliest-expiry-first.
  useEffect(() => {
    setEdited(false);
    setManual({});
  }, [amount]);

  // Every batch that still holds stock and is not expired, earliest expiry first — the order the
  // nurse would reach for them in. Expired batches are kept to the side so they are never used.
  const liveBatches = detail?.batches.filter((b) => b.balance > 0) ?? [];
  const usableBatches = liveBatches
    .filter((b) => b.expiryStatus !== "EXPIRED")
    .sort((a, b) => {
      if (a.expiry === b.expiry) return a.id - b.id;
      if (a.expiry === null) return 1;
      if (b.expiry === null) return -1;
      return a.expiry < b.expiry ? -1 : 1;
    });
  const expiredBatches = liveBatches.filter((b) => b.expiryStatus === "EXPIRED");
  const usableTotal = usableBatches.reduce((s, b) => s + b.balance, 0);

  // The earliest-expiry-first suggestion for this amount, as a batchId -> quantity map. Null when
  // there is nothing to suggest (no amount yet, or not enough usable stock).
  const suggested = useMemo(() => {
    if (!Number.isInteger(amount) || amount <= 0 || amount > usableTotal) return null;
    const split = allocateFefo(
      usableBatches.map((b) => ({ batchId: b.id, expiry: b.expiry, balance: b.balance })),
      amount,
      today,
    );
    const out: Record<number, number> = {};
    for (const line of split) out[line.batchId] = line.qty;
    return out;
  }, [usableBatches, usableTotal, amount, today]);

  // One row per usable batch: the typed split once the nurse has changed it, otherwise the
  // earliest-expiry-first suggestion.
  const amounts = edited ? manual : (suggested ?? {});
  const lineViews: Line[] = usableBatches.map((b) => ({
    batchId: b.id,
    qty: amounts[b.id] ?? 0,
    expiry: b.expiry,
    label: b.label,
    balance: b.balance,
  }));
  const lineTotal = lineViews.reduce((s, l) => s + l.qty, 0);
  const isSplit = lineViews.filter((l) => l.qty > 0).length > 1;
  const shortOfStock = Number.isInteger(amount) && amount > 0 && amount > usableTotal;

  const reset = () => {
    setItem(undefined);
    setQty("");
    setExpiry("");
    setLot("");
    setBatchId("");
    setAdjustQty("");
    setManual({});
    setEdited(false);
    setSource("");
    setRemarks("");
    setDate(today);
    setResult(undefined);
    setError(undefined);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return setError("Selecciona un artículo primero.");

    let body: MovementBody;

    if (kind === "RECEIVE") {
      if (!Number.isInteger(amount) || amount <= 0) return setError("Ingresa una cantidad entera mayor a cero.");
      body = {
        type: receiveType,
        itemId: item.id,
        qty: amount,
        date,
        // The month picker gives "YYYY-MM"; the server reads a date and keeps the month's last day.
        expiry: expiry ? `${expiry}-01` : null,
        lot: lot || null,
        source: source || null,
        remarks: remarks || null,
      };
    } else if (kind === "ADJUST") {
      const delta = Number(adjustQty);
      if (!batchId) return setError("Selecciona el lote que deseas corregir.");
      if (!Number.isInteger(delta) || delta === 0) {
        return setError("Ingresa la diferencia, por ejemplo -2 o 5. No puede ser cero.");
      }
      body = { type: "ADJUST", itemId: item.id, qty: delta, batchId: Number(batchId), date, source: source || null, remarks: remarks || null };
    } else {
      if (!Number.isInteger(amount) || amount <= 0) return setError("Ingresa una cantidad entera mayor a cero.");
      // Only send a manual split when one was actually made; otherwise let the rules take the
      // earliest expiry first.
      const chosen = lineViews.filter((l) => l.qty > 0);
      body = {
        type: kind,
        itemId: item.id,
        qty: amount,
        date,
        source: source || null,
        remarks: remarks || null,
        ...(edited && chosen.length ? { allocations: chosen.map((l) => ({ batchId: l.batchId, qty: l.qty })) } : {}),
      };
    }

    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await api.record(body));
      setQty("");
      setExpiry("");
      setLot("");
      setAdjustQty("");
      setManual({});
      setEdited(false);
      setRemarks("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el movimiento.");
    } finally {
      setBusy(false);
    }
  };

  const tab = TABS.find((t) => t.kind === kind)!;
  const receiveLabel = receiveType === "OPENING" ? "saldo inicial" : "entrada";
  const saveLabel =
    kind === "RECEIVE"
      ? `Guardar ${receiveLabel}`
      : kind === "DISPENSE"
        ? "Guardar como dispensado"
        : kind === "DISPOSE"
          ? "Guardar como descartado"
          : "Guardar corrección";

  return (
    <div className="flex flex-col gap-6">
      {focus ? (
        <h1 className="sr-only">Registrar movimiento</h1>
      ) : (
        <PageHeader
          title="Registrar movimiento"
          description="¿Qué ocurrió? Elige una de las cuatro opciones y completa los detalles a continuación."
          actions={
            <Button type="button" variant="plain" onClick={() => setFocus(true)}>
              Modo enfoque
            </Button>
          }
        />
      )}

      {/* Segmented control rather than underline tabs: each option does something different, so they
          read as four equal choices. The active one is the only filled thing. It sticks to the top
          so the choice stays in reach while the long form below is being filled in. */}
      <div className="sticky top-0 z-30 -mx-1 -my-1 flex flex-col gap-2 bg-bg px-1 py-1">
        {focus ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-xs font-semibold tracking-wider text-muted uppercase">
              Modo enfoque — solo registro
            </span>
            <Button type="button" variant="plain" size="sm" onClick={() => setFocus(false)}>
              Volver a la vista normal
            </Button>
          </div>
        ) : null}
        <div
          className="flex flex-wrap gap-1.5 rounded-2xl border border-rule bg-surface p-1.5 shadow-card"
          role="tablist"
          aria-label="Tipo de registro"
        >
          {TABS.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="tab"
              aria-selected={kind === t.kind}
              onClick={() => {
                setKind(t.kind);
                setError(undefined);
                setResult(undefined);
                setManual({});
                setEdited(false);
              }}
              className={cn(
                "cursor-pointer flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.99]",
                kind === t.kind
                  ? "bg-accent-soft font-semibold text-accent shadow-raised"
                  : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">{tab.blurb}</p>
      </div>

      {result ? (
        <Alert tone="success">
          <span className="font-medium">Guardado.</span> {item?.name} tiene ahora{" "}
          <span className="font-mono">{result.balances[item!.id]}</span>
          {item?.unit ? ` ${item.unit}` : ""} en existencia.
          {result.allocations && result.allocations.length > 1 ? " Se tomó de más de un lote, como se muestra arriba." : ""}
        </Alert>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-5">
        <Panel
          title="1. Selecciona el artículo"
          description="Busca en el catálogo y elige el artículo."
          className="max-w-2xl"
        >
          <div className="flex flex-col gap-3">
            {kind === "RECEIVE" && isAdmin ? (
              <Field label="Tipo de entrada" htmlFor="receiveType" className="max-w-xs">
                <Select
                  id="receiveType"
                  value={receiveType}
                  onChange={(e) => setReceiveType(e.target.value as "RECEIVE" | "OPENING")}
                >
                  <option value="RECEIVE">Recibido (suma al stock actual)</option>
                  <option value="OPENING">Saldo inicial (cantidad con la que se inició)</option>
                </Select>
              </Field>
            ) : null}
            <ItemPicker value={item} onChange={setItem} />
            {item ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-rule bg-surface-2 px-3.5 py-3 text-sm">
                <span className="font-medium">{item.name}</span>
                {item.variant ? <span className="text-muted">{item.variant}</span> : null}
                <span className="font-mono text-xs text-muted">{item.id}</span>
                <span className="ml-auto font-mono">
                  En existencia: <span className="font-semibold">{item.balance}</span>
                  {item.unit ? <span className="text-muted"> {item.unit}</span> : null}
                </span>
              </div>
            ) : null}
          </div>
        </Panel>

        {item ? (
          <Panel
            title={kind === "ADJUST" ? "2. ¿Qué lote y por cuánto ajustarlo?" : "2. ¿Cuánto y cuándo?"}
            description={
              kind === "ADJUST"
                ? "Ajusta un lote para que coincida con lo que contaste físicamente en el estante."
                : kind === "RECEIVE"
                  ? "La fecha de vencimiento determina a qué lote se suma el stock."
                  : "Se utiliza primero el lote con vencimiento más próximo. Cambia la distribución abajo si tomaste de otro lote."
            }
            className="max-w-2xl"
          >
            <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
              {kind === "ADJUST" ? (
                <>
                  <Field label="Lote" htmlFor="batch" hint="Solo lotes que aún tienen existencias.">
                    <Select id="batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                      <option value="">Selecciona un lote…</option>
                      {usableBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          #{b.id} · {b.expiry ?? "sin vencimiento"} · {b.balance} disponibles
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Ajustar en" htmlFor="adjust" hint="Un número positivo suma, uno negativo resta. Por ejemplo 5 o -2.">
                    <Input
                      id="adjust"
                      value={adjustQty}
                      onChange={(e) => setAdjustQty(e.target.value)}
                      type="number"
                      step={1}
                      required
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="Cantidad"
                    htmlFor="qty"
                    hint={
                      kind === "RECEIVE"
                        ? item.unit
                          ? `¿Cuántos ingresaron? En ${item.unit}. Solo números enteros.`
                          : "¿Cuántos ingresaron? Solo números enteros."
                        : item.unit
                          ? `¿Cuántos? En ${item.unit}. Disponibles: ${usableTotal}.`
                          : `¿Cuántos? Disponibles: ${usableTotal}.`
                    }
                  >
                    <Input
                      id="qty"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      required
                    />
                  </Field>
                  {kind === "RECEIVE" ? (
                    <>
                      <Field
                        label="Vencimiento"
                        htmlFor="expiry"
                        hint="Elige el mes impreso en la caja. Déjalo vacío si no tiene fecha de vencimiento."
                      >
                        <Input id="expiry" type="month" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                      </Field>
                      <Field label="Número de lote" htmlFor="lot" hint="Opcional. Se guarda junto al lote.">
                        <Input id="lot" value={lot} onChange={(e) => setLot(e.target.value)} />
                      </Field>
                    </>
                  ) : null}
                </>
              )}

              <Field
                label="Fecha"
                htmlFor="date"
                hint={
                  isAdmin
                    ? "Puedes cambiar la fecha, pero no puede ser futura."
                    : `Puedes registrar hasta ${nurseBackdateDays} días hacia atrás.`
                }
              >
                <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
              </Field>

              <Field
                label="Origen / Destino"
                htmlFor="source"
                hint={kind === "RECEIVE" ? "Proveedor, servicio o persona que entrega." : kind === "DISPENSE" ? "Área, pabellón o referencia del paciente." : "Destino o motivo del movimiento."}
              >
                <Input id="source" value={source} onChange={(e) => setSource(e.target.value)} />
              </Field>

              <Field
                label="Observaciones"
                htmlFor="remarks"
                className={kind === "RECEIVE" ? "sm:col-span-2" : undefined}
                hint="Opcional, pero anotar un motivo facilita revisar la bitácora más adelante."
              >
                <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </div>
          </Panel>
        ) : null}

        {(kind === "DISPENSE" || kind === "DISPOSE") && item && amount > 0 && usableBatches.length > 0 ? (
          <Panel
            title="3. ¿De qué lote proviene?"
            description={
              shortOfStock
                ? `Esta cantidad supera las ${usableTotal} unidades utilizables en estante. Reduce la cantidad o registra primero el stock faltante.`
                : usableBatches.length === 1
                  ? "Este artículo tiene un solo lote, por lo que la cantidad proviene de él. Modifícalo si no tomaste todo de este lote."
                  : isSplit
                    ? "Esta cantidad supera lo que tiene un solo lote, por lo que se divide entre varios. Revisa las cantidades antes de guardar."
                    : "Sugerido del lote que vence primero. Cambia cualquier cantidad si lo tomaste de un lote diferente."
            }
            className="max-w-3xl"
            actions={
              edited ? (
                <Button
                  type="button"
                  variant="plain"
                  size="sm"
                  onClick={() => {
                    setEdited(false);
                    setManual({});
                  }}
                >
                  Usar primero el próximo a vencer
                </Button>
              ) : undefined
            }
          >
            <TableWrap className="shadow-none">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Lote</th>
                  <th scope="col" className={thClass}>Vencimiento</th>
                  <th scope="col" className={thRightClass}>En existencia</th>
                  <th scope="col" className={thRightClass}>Tomando</th>
                </tr>
              </thead>
              <tbody>
                {lineViews.map((line) => (
                  <tr key={line.batchId} className={rowClass}>
                    <td className="px-3 py-2 font-mono text-xs">
                      #{line.batchId}
                      {line.label ? <span className="ml-1 text-muted">{line.label}</span> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{line.expiry ?? "sin vencimiento"}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{line.balance}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={line.balance}
                        step={1}
                        value={line.qty}
                        aria-label={`Cantidad del lote ${line.batchId}`}
                        onChange={(e) => {
                          const next = e.target.value === "" ? 0 : Number(e.target.value);
                          setEdited(true);
                          // Zeros are kept so the amount can be moved from one batch to another.
                          setManual(() => {
                            const base: Record<number, number> = {};
                            for (const l of lineViews) base[l.batchId] = l.qty;
                            base[line.batchId] = Number.isFinite(next) ? next : 0;
                            return base;
                          });
                        }}
                        className="w-20 text-right font-mono"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-rule bg-surface-2">
                  <td className="px-3 py-2 text-xs text-muted" colSpan={3}>
                    {edited ? "Tu distribución" : "Próximo a vencer primero (FEFO)"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono font-semibold",
                      lineTotal !== amount ? "text-danger" : "",
                    )}
                  >
                    {lineTotal} / {amount}
                  </td>
                </tr>
              </tfoot>
            </TableWrap>
            {lineTotal !== amount ? (
              <Alert tone={shortOfStock ? "error" : "warn"} className="mt-3">
                {shortOfStock
                  ? `Solo hay ${usableTotal} utilizables en stock, pero se solicitaron ${amount}.`
                  : `Las cantidades por lote deben sumar ${amount}. Actualmente suman ${lineTotal}.`}
              </Alert>
            ) : null}
          </Panel>
        ) : null}

        {expiredBatches.length > 0 && (kind === "DISPENSE" || kind === "DISPOSE") ? (
          <Alert tone="warn">
            {expiredBatches.reduce((s, b) => s + b.balance, 0)} unidades de este artículo ya están vencidas y nunca se
            entregan automáticamente. Regístralas desde «Fechas de vencimiento» como descartadas para retirarlas.
          </Alert>
        ) : null}

        {monthClosed ? (
          <Alert tone="error">
            {monthOf(date)} está cerrado. Reábrelo desde «Cierre mensual» antes de registrar movimientos en esa fecha.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex max-w-2xl flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            disabled={
              busy ||
              !item ||
              monthClosed ||
              ((kind === "DISPENSE" || kind === "DISPOSE") &&
                (shortOfStock || (edited && lineTotal !== amount)))
            }
          >
            {busy ? "Guardando…" : saveLabel}
          </Button>
          <Button type="button" variant="plain" size="lg" onClick={reset} disabled={busy}>
            Limpiar formulario
          </Button>
          {!item ? <span className="text-sm text-muted">Elige un artículo arriba para habilitar el guardado.</span> : null}
        </div>
      </form>

      {kind === "RECEIVE" ? (
        <Panel title="Qué ocurre al guardar" className="max-w-2xl">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
            <li>El stock del mismo artículo y mismo mes de vencimiento se agrupa en un solo lote.</li>
            <li>Si dejas el vencimiento vacío, ingresa a un lote compartido «sin vencimiento» para ese artículo.</li>
            <li>Las existencias se calculan a partir de los registros, por lo que siempre se mantienen exactas.</li>
            <li>Tu nombre y la hora quedan guardados en cada movimiento.</li>
          </ul>
        </Panel>
      ) : (
        <Panel title="Lo que el sistema hace por ti" className="max-w-2xl">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
            <li>Sugiere primero el lote con vencimiento más próximo (FEFO), para que nada antiguo quede rezagado.</li>
            <li>Puedes cambiar de qué lote proviene la cantidad y dividirla entre varios lotes si lo necesitas.</li>
            <li>El stock vencido nunca se entrega ni se sugiere automáticamente.</li>
            <li>El stock nunca puede bajar de cero, evitando entregar dos veces la última unidad.</li>
          </ul>
        </Panel>
      )}

      {/* An overview of everything the office keeps, so the picker above is not the only way in. */}
      <Panel
        title="Todos los artículos de un vistazo"
        description="Toca una fila para elegir ese artículo en este registro. Usa el buscador y el filtro de categoría para acotar la lista."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="sm:w-60">
              <label htmlFor="receive-list-q" className="sr-only">Buscar artículos</label>
              <SearchInput
                id="receive-list-q"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="Nombre, marca o código…"
              />
            </div>
            <div className="sm:w-40">
              <label htmlFor="receive-list-category" className="sr-only">Categoría</label>
              <Select
                id="receive-list-category"
                value={listCategory}
                onChange={(e) => setListCategory(e.target.value)}
              >
                <option value="ALL">Todas las categorías</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        }
      >
        {!allItems ? (
          <Loading label="Cargando artículos…" />
        ) : filteredItems.length === 0 ? (
          <EmptyState title="Ningún artículo coincide." hint="Limpia la búsqueda o elige otra categoría." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Artículo</th>
                  <th scope="col" className={thClass}>Categoría</th>
                  <th scope="col" className={thRightClass}>En existencia</th>
                  <th scope="col" className={thClass}>Próx. vencimiento</th>
                  <th scope="col" className={thRightClass}><span className="sr-only">Elegir</span></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((row) => {
                  const selected = row.id === item?.id;
                  return (
                    <tr
                      key={row.id}
                      className={cn(rowClass, "cursor-pointer", selected && "bg-accent-soft")}
                      onClick={() => choose(row)}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            choose(row);
                          }}
                          className={cn(linkClass, "text-left")}
                        >
                          {row.name}
                          {row.variant ? <span className="text-muted"> · {row.variant}</span> : null}
                        </button>
                        <span className="ml-2 font-mono text-xs text-muted">{row.id}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{categoryLabel(row.category)}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={cn("font-medium", row.lowStock && "text-warn", row.expiredQty > 0 && "text-danger")}>
                          {row.balance}
                        </span>
                        {row.unit ? <span className="text-muted"> {row.unit}</span> : null}
                        {row.lowStock ? <LowBadge /> : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{row.nearestExpiry ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn("text-xs", selected ? "font-medium text-accent" : "text-muted")}>
                          {selected ? "Seleccionado" : "Elegir"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>

            <Pagination
              total={filteredItems.length}
              page={listPage.page}
              pageSize={listPage.pageSize}
              onPage={listPage.setPage}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
