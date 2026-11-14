"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Pagination } from "@/components/Pagination";
import {
  Alert,
  Button,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Stat,
  TableWrap,
  cn,
  rowClass,
  thClass,
} from "@/components/ui";

const ACTIONS = [
  "ALL",
  "transaction.receive",
  "transaction.dispense",
  "transaction.adjust",
  "transaction.dispose",
  "transaction.opening",
  "transaction.void",
  "item.create",
  "item.update",
  "month.count",
  "month.close",
  "month.reopen",
] as const;

/** The raw action codes read like machine names; on screen they read like plain English. */
const ACTION_LABEL: Record<string, string> = {
  ALL: "Todas las acciones",
  "transaction.receive": "Entrada de stock",
  "transaction.dispense": "Salida / Dispensado",
  "transaction.adjust": "Ajuste de conteo",
  "transaction.dispose": "Descarte de stock",
  "transaction.opening": "Saldo inicial",
  "transaction.void": "Movimiento anulado",
  "item.create": "Artículo agregado",
  "item.update": "Artículo modificado",
  "item.delete": "Artículo eliminado",
  "month.count": "Conteos guardados",
  "month.close": "Mes cerrado",
  "month.reopen": "Mes reabierto",
};

const actionLabel = (action: string): string => ACTION_LABEL[action] ?? action;

const PAGE = 100;

/** Formats the JSON detail blob into something readable, since audit details are free-form. */
function summarise(detail: unknown): string {
  if (detail === null || detail === undefined) return "";
  if (typeof detail !== "object") return String(detail);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length) parts.push(`${key}: ${value.map((v) => JSON.stringify(v)).join(", ")}`);
    } else if (typeof value === "object") {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.join(" · ");
}

export default function AuditLogPage() {
  const [action, setAction] = useState<string>("ALL");
  const [entityId, setEntityId] = useState("");
  const [applied, setApplied] = useState<{ action: string; entityId: string }>({ action: "ALL", entityId: "" });
  const [offset, setOffset] = useState(0);

  const { data, error, loading, refreshing } = useApi(
    () => api.audit({ action: applied.action, entityId: applied.entityId, limit: PAGE, offset }),
    [applied, offset],
  );

  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bitácora de actividad"
        description="Cada cambio en existencias, artículos y cierres mensuales, con quién lo hizo y cuándo. Nada aquí se edita ni se borra."
      />

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setApplied({ action, entityId: entityId.trim() });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-action" className="text-sm font-medium">Qué ocurrió</label>
          <Select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} className="w-52">
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audit-entity" className="text-sm font-medium">Artículo o mes</label>
          <SearchInput
            id="audit-entity"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="MED-001 o un mes"
            className="w-48"
          />
        </div>
        <Button type="submit" size="md" className="h-[38px]">
          Filtrar
        </Button>
      </form>

      {loading ? <Loading /> : null}
      {error ? <ErrorNote error={new Error(error)} /> : null}

      {data ? (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Registros coincidentes" value={data.total} />
          <Stat label="Mostrados en esta página" value={entries.length} hint={`${PAGE} por página`} />
          <Stat
            label="Página"
            value={data.total === 0 ? 1 : Math.floor(offset / PAGE) + 1}
            hint={`Desde el registro ${offset + 1}`}
          />
        </dl>
      ) : null}

      {refreshing ? <p className="text-xs text-muted">Cargando…</p> : null}

      {data && entries.length === 0 ? (
        <EmptyState title="No hay coincidencias." hint="Amplía el filtro o limpia la referencia de artículo." />
      ) : null}

      {entries.length > 0 ? (
        <>
          <Panel title="Historial" description="Más recientes primero. Las filas en rojo corresponden a anulaciones o reaperturas.">
            <TableWrap className={cn(refreshing && "opacity-60")}>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Cuándo</th>
                  <th scope="col" className={thClass}>Quién</th>
                  <th scope="col" className={thClass}>Qué ocurrió</th>
                  <th scope="col" className={thClass}>Artículo o mes</th>
                  <th scope="col" className={thClass}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const dangerous = e.action === "transaction.void" || e.action === "month.reopen";
                  return (
                    <tr key={e.id} className={rowClass}>
                      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                        {e.at.slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">{e.userName ?? "—"}</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-xs whitespace-nowrap",
                          dangerous && "font-medium text-danger",
                        )}
                      >
                        {actionLabel(e.action)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {e.entity}
                        <span className="ml-1 text-muted">{e.entityId}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted">{summarise(e.detail)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Panel>

          <Pagination
            total={data?.total ?? 0}
            page={Math.floor(offset / PAGE)}
            pageSize={PAGE}
            onPage={(p) => setOffset(p * PAGE)}
          />
        </>
      ) : null}

      {data && data.total > entries.length && entries.length === 0 ? (
        <Alert tone="info">No hay registros en esta página. Retrocede una página.</Alert>
      ) : null}
    </div>
  );
}
