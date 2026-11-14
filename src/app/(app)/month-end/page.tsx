"use client";

import { useEffect, useMemo, useState } from "react";
import { api, downloadUrls } from "@/lib/api";
import type { CountRow, MonthEndResponse } from "@/lib/api-types";
import { monthOf, previousMonth } from "@/lib/dates";
import { usePermissions } from "@/components/SessionProvider";
import { DownloadButton } from "@/components/DownloadButton";
import { Pagination, usePaging } from "@/components/Pagination";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Select,
  Stat,
  TableWrap,
  Textarea,
  categoryLabel,
  cn,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

/** A rolling window of months to pick from, ending with the month in progress. */
function monthOptions(current: string): string[] {
  return Array.from({ length: 24 }, (_, i) => {
    const [y, m] = current.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default function MonthEndPage() {
  const { isAdmin, today, closedMonths } = usePermissions();
  const current = monthOf(today);

  const [month, setMonth] = useState(previousMonth(current));
  const [sheet, setSheet] = useState<MonthEndResponse>();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reopenFor, setReopenFor] = useState<string>();
  const [reason, setReason] = useState("");

  // Date-range export controls
  const [fromDate, setFromDate] = useState(`${today.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(today);
  const [exportMode, setExportMode] = useState<"stock" | "gasto" | "ambos">("gasto");

  const load = async (target: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.monthEnd(target);
      setSheet(next);
      // Seed the inputs from what is already saved, so a reload does not lose work in view.
      setCounts(
        Object.fromEntries(
          next.counts.filter((c) => c.counted !== null).map((c) => [c.itemId, String(c.counted)]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el mes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(month);
  }, [month]);

  const closed = !!sheet?.closed;

  /** Only rows whose input differs from the saved value, so a save is a small patch. */
  const dirty = useMemo(() => {
    if (!sheet) return [];
    return sheet.counts
      .map((row) => {
        const entered = counts[row.itemId];
        if (entered === undefined || entered.trim() === "") return null;
        const value = Number(entered);
        if (!Number.isInteger(value) || value < 0) return null;
        if (row.counted === value) return null;
        return { itemId: row.itemId, counted: value };
      })
      .filter((x): x is { itemId: string; counted: number } => x !== null);
  }, [sheet, counts]);

  const filled = useMemo(
    () => sheet?.counts.filter((c) => (counts[c.itemId] ?? "").trim() !== "").length ?? 0,
    [sheet, counts],
  );

  const variance = useMemo(
    () =>
      (sheet?.counts ?? []).reduce((sum, row) => {
        const entered = counts[row.itemId];
        if (entered === undefined || entered.trim() === "") return sum;
        const value = Number(entered);
        return Number.isInteger(value) ? sum + (value - row.system) : sum;
      }, 0),
    [sheet, counts],
  );

  const guard = async (fn: () => Promise<MonthEndResponse>, message: string) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setSheet(await fn());
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    guard(async () => {
      const next = await api.saveCounts({ month, counts: dirty });
      setCounts(
        Object.fromEntries(next.counts.filter((c) => c.counted !== null).map((c) => [c.itemId, String(c.counted)])),
      );
      return next;
    }, `Se guardaron ${dirty.length} ${dirty.length === 1 ? "conteo" : "conteos"}.`);

  const close = () =>
    guard(async () => api.closeMonth({ month }), `${month} ha sido cerrado. Ya no se permiten nuevos registros con fecha dentro de ese mes.`);

  const reopen = () =>
    guard(async () => {
      const next = await api.reopenMonth({ month, reason });
      setReopenFor(undefined);
      setReason("");
      return next;
    }, `${month} está abierto nuevamente.`);

  const options = monthOptions(current);

  // A different month restarts the count sheet at the first page.
  const countPage = usePaging(sheet?.counts ?? [], 10, month);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reporte y cierre mensual"
        description="Cuenta las existencias en estante, guarda los conteos y cierra el mes para que sus cifras no cambien. Puedes reabrirlo más adelante si aparece algún error."
      />

      {/* Month picker and the ledger download share one row; the download always matches the month shown. */}
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <Field label="Mes" htmlFor="month" className="w-48">
          <Select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
                {closedMonths.includes(m) ? " · cerrado" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="plain" size="md" onClick={() => void load(month)} disabled={loading}>
          {loading ? "Cargando…" : "Recargar"}
        </Button>
        <div className="ml-auto">
          <DownloadButton url={downloadUrls.ledger({ month })} fallbackName={`medicheck-libro-${month}.xlsx`} size="md">
            Descargar mes en Excel
          </DownloadButton>
        </div>
      </Card>

      {/* Custom date-range Control de Gastos export */}
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-60 flex-1">
          <p className="font-medium">Reporte Control de Gastos por rango de fechas</p>
          <p className="text-sm text-muted">
            Selecciona desde qué día hasta qué día deseas consultar el gasto (consumo) o el stock en el formato oficial de Excel.
          </p>
        </div>
        <Field label="Qué ver en el Excel" htmlFor="me-mode" className="w-56">
          <Select
            id="me-mode"
            value={exportMode}
            onChange={(e) => setExportMode(e.target.value as "stock" | "gasto" | "ambos")}
          >
            <option value="gasto">Ver Gasto (Consumo en fechas)</option>
            <option value="stock">Ver Stock disponible</option>
            <option value="ambos">Ver Stock + Gasto en Observaciones</option>
          </Select>
        </Field>
        <Field label="Desde el día" htmlFor="me-from" className="w-40">
          <Input
            id="me-from"
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </Field>
        <Field label="Hasta el día" htmlFor="me-to" className="w-40">
          <Input
            id="me-to"
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
          />
        </Field>
        <DownloadButton
          url={downloadUrls.stock({
            from: fromDate || undefined,
            to: toDate || undefined,
            mode: exportMode,
          })}
          fallbackName={`Control_de_Gastos_MediCheck_${fromDate}_a_${toDate}.xlsx`}
          variant="primary"
          size="md"
        >
          Descargar Control de Gastos
        </DownloadButton>
      </Card>

      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="max-w-lg">
          <p className="font-medium">Libro completo</p>
          <p className="text-sm text-muted">
            Todos los meses que tienen registros en un solo archivo, organizado como el archivo histórico de enfermería.
            Es la misma hoja que la descarga mensual, pero abarcando todo el historial.
          </p>
        </div>
        <div className="ml-auto">
          <DownloadButton
            url={downloadUrls.ledger({ all: true })}
            fallbackName="medicheck-libro-todos-los-meses.xlsx"
            variant="primary"
            size="md"
          >
            Descargar todos los meses en Excel
          </DownloadButton>
        </div>
      </Card>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}
      {loading ? <Loading /> : null}

      {sheet ? (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Artículos por contar" value={sheet.summary.items} />
            <Stat
              label="Contados"
              value={filled}
              tone={filled === sheet.summary.items ? "ok" : "warn"}
              hint={`${sheet.summary.items - filled} pendientes`}
            />
            <Stat
              label="Diferencia"
              value={variance}
              tone={variance ? "warn" : "plain"}
              hint={variance ? "Lo contado menos el sistema" : "Todo cuadra"}
            />
            <Stat label="Estado" value={closed ? "Cerrado" : "Abierto"} tone={closed ? "ok" : "plain"} hint={month} />
          </dl>

          {closed ? (
            <Alert tone="info">
              {month} fue cerrado{sheet.closedAt ? ` el ${sheet.closedAt.slice(0, 10)}` : ""}. Ningún movimiento con
              fecha dentro de ese mes puede registrarse ni anularse hasta reabrir el mes.
            </Alert>
          ) : null}

          {/* The count sheet is the point of the page, so it gets the panel treatment and a
            caption explaining what the three numbers mean. */}
          <Panel
            title={`Hoja de conteo de ${month}`}
            description="Escribe lo que hay realmente en el estante. La columna de diferencia se actualiza automáticamente."
          >
            {sheet.counts.length === 0 ? (
              <EmptyState
                title="No hay artículos activos para contar."
                hint="Todos los artículos del catálogo están inactivos u ocultos."
              />
            ) : (
              <>
                <TableWrap>
                  <thead>
                    <tr>
                      <th scope="col" className={thClass}>Artículo</th>
                      <th scope="col" className={thClass}>Unidad</th>
                      <th scope="col" className={thClass}>Categoría</th>
                      <th scope="col" className={thRightClass}>Inicial</th>
                      <th scope="col" className={thRightClass}>Recibido</th>
                      <th scope="col" className={thRightClass}>Dispensado</th>
                      <th scope="col" className={thRightClass}>Descartado</th>
                      <th scope="col" className={thRightClass}>Ajustado</th>
                      <th scope="col" className={thRightClass}>Según sistema</th>
                      <th scope="col" className={thRightClass}>Conteo físico</th>
                      <th scope="col" className={thRightClass}>Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countPage.rows.map((row) => (
                      <CountRowView
                        key={row.itemId}
                        row={row}
                        value={counts[row.itemId] ?? ""}
                        disabled={closed || busy}
                        onChange={(v) => setCounts((c) => ({ ...c, [row.itemId]: v }))}
                      />
                    ))}
                  </tbody>
                </TableWrap>
                <Pagination
                  total={sheet.counts.length}
                  page={countPage.page}
                  pageSize={countPage.pageSize}
                  onPage={countPage.setPage}
                />
              </>
            )}
          </Panel>

          <Panel title="El mes en formato hoja de cálculo" description="El respaldo oficial de enfermería.">
            <p className="text-sm text-muted">
              La descarga conserva el formato de planilla original: una fila por artículo, su vencimiento y columnas de
              saldo inicial y dispensado para cada día del mes. Se construye directamente desde tus registros para que
              el archivo y la aplicación coincidan siempre.
            </p>
          </Panel>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="md" onClick={save} disabled={busy || closed || dirty.length === 0}>
              {busy ? "Procesando…" : dirty.length ? `Guardar ${dirty.length} conteos` : "Nada por guardar"}
            </Button>

            {isAdmin && !closed && filled === sheet.summary.items && sheet.summary.items > 0 ? (
              <Button size="md" onClick={close} disabled={busy}>
                Cerrar {month}
              </Button>
            ) : null}

            {isAdmin && closed ? (
              <Button variant="danger" size="md" onClick={() => setReopenFor(month)} disabled={busy}>
                Reabrir {month}
              </Button>
            ) : null}

            {!isAdmin && !closed && filled < sheet.summary.items ? (
              <p className="text-sm text-muted">
                Faltan {sheet.summary.items - filled} por contar antes de poder cerrar el mes.
              </p>
            ) : null}
          </div>

          {sheet.month === current ? (
            <p className="text-sm text-muted">
              {current} es el mes en curso, por lo que aún no puede cerrarse. Ciérralo cuando termine el mes.
            </p>
          ) : null}
        </>
      ) : null}

      {reopenFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="reopen-title">
          <div className="w-full max-w-md rounded-2xl border border-rule bg-surface p-6 shadow-float">
            <h2 id="reopen-title" className="text-lg font-semibold">Reabrir {reopenFor}</h2>
            <div className="mt-3 flex flex-col gap-3">
              <Alert tone="warn">
                Los conteos guardados para este mes se eliminarán y los movimientos con fecha dentro de él volverán a
                ser editables. El motivo quedará registrado en la bitácora de actividad.
              </Alert>
              <Field label="Motivo" htmlFor="reopen-reason" hint="Escribe al menos unas palabras.">
                <Textarea
                  id="reopen-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Error en el conteo, reconteo realizado…"
                  autoFocus
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="plain" size="md" onClick={() => setReopenFor(undefined)} disabled={busy}>
                  Cancelar
                </Button>
                <Button variant="danger" size="md" onClick={reopen} disabled={busy || reason.trim().length < 3}>
                  {busy ? "Reabriendo…" : "Reabrir mes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CountRowView({
  row,
  value,
  onChange,
  disabled,
}: {
  row: CountRow;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const entered = Number(value);
  const difference = value.trim() === "" || !Number.isInteger(entered) ? null : entered - row.system;
  const unmatched = difference !== null && difference !== 0 && row.system === 0;

  return (
    <tr className={rowClass}>
      <td className="px-3 py-1.5">
        <span className="font-medium">{row.itemName}</span>
        {row.variant ? <span className="text-muted"> · {row.variant}</span> : null}
        <span className="ml-2 font-mono text-xs text-muted">{row.itemId}</span>
      </td>
      <td className="px-3 py-1.5 text-left text-sm text-muted">{row.unit || "—"}</td>
      <td className="px-3 py-1.5 text-left text-sm">{categoryLabel(row.category)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted">{row.beginning ?? 0}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted">{row.received ?? 0}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted">{row.dispensed ?? 0}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted">{row.disposed ?? 0}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted">{row.adjusted ?? 0}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted">{row.system}</td>
      <td className="px-3 py-1.5 text-right">
        <Input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          disabled={disabled}
          value={value}
          aria-label={`Cantidad contada para ${row.itemName}`}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 text-right font-mono"
        />
      </td>
      <td
        className={cn(
          "px-3 py-1.5 text-right font-mono",
          difference === null ? "text-muted" : difference === 0 ? "text-muted" : unmatched ? "text-danger" : "text-warn",
        )}
      >
        {difference === null ? "—" : difference > 0 ? `+${difference}` : difference}
      </td>
    </tr>
  );
}
