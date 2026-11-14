"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { api, downloadUrls } from "@/lib/api";
import { CATEGORIES } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import { DownloadButton } from "@/components/DownloadButton";
import { Pagination, usePaging } from "@/components/Pagination";
import {
  Card,
  Checkbox,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  IconChevron,
  Input,
  Loading,
  LowBadge,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Stat,
  TableWrap,
  categoryLabel,
  cn,
  linkClass,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

export default function StockPage() {
  const { today } = usePermissions();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [lowOnly, setLowOnly] = useState(false);
  const [expanded, setExpanded] = useState<string>();

  // Date range & mode for the Excel Control de Gastos export
  const [fromDate, setFromDate] = useState(`${today.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(today);
  const [exportMode, setExportMode] = useState<"stock" | "gasto" | "ambos">("stock");

  const { data, error, loading, refreshing } = useApi(
    () => api.stock({ q, category, lowOnly }),
    [q, category, lowOnly],
  );

  // A new search, category or filter starts again from the first page.
  const stockPage = usePaging(data?.rows ?? [], 10, `${q}|${category}|${lowOnly}`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock actual"
        description="Existencias en anaquel en este momento. Despliega una fila para ver en qué lote se encuentra."
      />

      {/* Filters sit in one card so they read as a single control, not four loose inputs. */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <label htmlFor="stock-q" className="text-sm font-medium">Buscar</label>
            <SearchInput
              id="stock-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, marca o código…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="stock-category" className="text-sm font-medium">Categoría</label>
            <Select
              id="stock-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-48"
            >
              <option value="ALL">Todas las categorías</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex h-[38px] items-center pb-0.5">
            <Checkbox label="Solo stock bajo" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          </div>
        </div>

        {/* Excel Export Section with Date Range (Desde / Hasta) and Mode (Stock / Gasto / Ambos) */}
        <div className="flex flex-wrap items-end gap-3 border-t border-rule pt-3.5">
          <div className="flex flex-col gap-1">
            <label htmlFor="export-mode" className="text-xs font-semibold text-muted uppercase tracking-wider">
              Qué ver en el Excel
            </label>
            <Select
              id="export-mode"
              value={exportMode}
              onChange={(e) => setExportMode(e.target.value as "stock" | "gasto" | "ambos")}
              className="w-56"
            >
              <option value="stock">Ver Stock disponible</option>
              <option value="gasto">Ver Gasto (Consumo en fechas)</option>
              <option value="ambos">Ver Stock + Gasto en Observaciones</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="export-from" className="text-xs font-semibold text-muted uppercase tracking-wider">
              Desde el día
            </label>
            <Input
              id="export-from"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="export-to" className="text-xs font-semibold text-muted uppercase tracking-wider">
              Hasta el día
            </label>
            <Input
              id="export-to"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="ml-auto">
            <DownloadButton
              url={downloadUrls.stock({
                q,
                category,
                lowOnly,
                from: fromDate || undefined,
                to: toDate || undefined,
                mode: exportMode,
              })}
              fallbackName={`Control_de_Gastos_MediCheck_${fromDate}_a_${toDate}.xlsx`}
              size="md"
            >
              Exportar a Excel
            </DownloadButton>
          </div>
        </div>
      </Card>

      {loading ? <Loading /> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}

      {data ? (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Artículos mostrados" value={data.total.items} />
            <Stat label="Unidades totales" value={data.total.units} />
            <Stat
              label="Stock bajo"
              value={data.total.lowStock}
              tone={data.total.lowStock ? "warn" : "plain"}
            />
            <Stat
              label="Stock vencido"
              value={data.total.expired}
              tone={data.total.expired ? "danger" : "plain"}
            />
          </dl>

          {refreshing ? <p className="text-xs text-muted">Actualizando…</p> : null}

          <Panel
            title={lowOnly ? "Solo stock bajo" : category === "ALL" ? "Todos los artículos" : categoryLabel(category)}
            description={q ? `Coincidencias para “${q}”` : undefined}
          >
            {data.rows.length === 0 ? (
              <EmptyState
                title="No se encontraron artículos."
                hint="Limpia la búsqueda, amplía la categoría o desactiva “Solo stock bajo”."
              />
            ) : (
              <>
                <TableWrap className={cn(refreshing && "opacity-60")}>
                  <thead>
                    <tr>
                      <th scope="col" className={thClass}>Artículo</th>
                      <th scope="col" className={thClass}>Categoría</th>
                      <th scope="col" className={thRightClass}>En existencia</th>
                      <th scope="col" className={thRightClass}>Reordenar en</th>
                      <th scope="col" className={thClass}>Próximo venc.</th>
                      <th scope="col" className={thClass}><span className="sr-only">Lotes</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockPage.rows.map(({ item, batches }) => {
                      const open = expanded === item.id;
                      return (
                        <Fragment key={item.id}>
                          <tr className={rowClass}>
                            <td className="px-3 py-2">
                              <Link href={`/items/${encodeURIComponent(item.id)}`} className={linkClass}>
                                {item.name}
                                {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                              </Link>
                              <span className="ml-2 font-mono text-xs text-muted">{item.id}</span>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted">{categoryLabel(item.category)}</td>
                            <td className="px-3 py-2 text-right font-mono">
                              <span className={cn("font-medium", item.lowStock && "text-warn", item.expiredQty > 0 && "text-danger")}>
                                {item.balance}
                              </span>
                              {item.unit ? <span className="text-muted"> {item.unit}</span> : null}
                              {item.lowStock ? <LowBadge /> : null}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-muted">{item.reorderLevel ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                              {item.nearestExpiry ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {batches.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setExpanded(open ? undefined : item.id)}
                                  aria-expanded={open}
                                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface hover:text-fg"
                                >
                                  {batches.length} {batches.length === 1 ? "lote" : "lotes"}
                                  <IconChevron className={cn("transition-transform duration-150", open && "rotate-90")} />
                                </button>
                              ) : (
                                <span className="text-xs text-muted">—</span>
                              )}
                            </td>
                          </tr>
                          {open ? (
                            <tr className="border-t border-rule bg-surface-2">
                              <td colSpan={6} className="px-3 py-3">
                                <table className="w-full border-collapse text-xs">
                                  <thead>
                                    <tr>
                                      <th scope="col" className="py-1 pr-3 text-left font-semibold tracking-wider text-muted uppercase">Lote</th>
                                      <th scope="col" className="py-1 pr-3 text-left font-semibold tracking-wider text-muted uppercase">Vencimiento</th>
                                      <th scope="col" className="py-1 pr-3 text-left font-semibold tracking-wider text-muted uppercase">Estado</th>
                                      <th scope="col" className="py-1 pr-3 text-right font-semibold tracking-wider text-muted uppercase">Recibido</th>
                                      <th scope="col" className="py-1 text-right font-semibold tracking-wider text-muted uppercase">Saldo</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {batches.map((b) => (
                                      <tr key={b.id}>
                                        <td className="py-1 pr-3">
                                          <span className="font-mono">#{b.id}</span>
                                          {b.label ? <span className="ml-1 text-muted">{b.label}</span> : null}
                                          {b.source ? <span className="ml-1 text-muted">· {b.source}</span> : null}
                                        </td>
                                        <td className="py-1 pr-3 font-mono">{b.expiry ?? "sin fecha"}</td>
                                        <td className="py-1 pr-3"><ExpiryBadge status={b.expiryStatus} /></td>
                                        <td className="py-1 pr-3 text-right font-mono">{b.qtyReceived}</td>
                                        <td className={cn("py-1 text-right font-mono font-medium", b.balance === 0 && "text-muted")}>
                                          {b.balance}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </TableWrap>
                <Pagination
                  total={data.rows.length}
                  page={stockPage.page}
                  pageSize={stockPage.pageSize}
                  onPage={stockPage.setPage}
                />
              </>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
