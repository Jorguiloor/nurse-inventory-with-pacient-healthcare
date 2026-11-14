"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import type { ExpiryRow } from "@/lib/api-types";
import { useApi } from "@/lib/use-api";
import { usePermissions } from "@/components/SessionProvider";
import { Pagination, usePaging } from "@/components/Pagination";
import {
  Button,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  Loading,
  PageHeader,
  Panel,
  Stat,
  TableWrap,
  linkClass,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

const BUCKETS = [
  { key: "DAYS_30", title: "En 30 días o menos", hint: "Utiliza estos lotes primero o sepáralos." },
  { key: "DAYS_60", title: "De 31 a 60 días", hint: "Conviene colocarlos al frente del anaquel." },
  { key: "DAYS_90", title: "De 61 a 90 días", hint: "Planifica la rotación o reposición." },
] as const;

export default function ExpiryPage() {
  const { today } = usePermissions();
  const { data, error, loading, reload, refreshing } = useApi(() => api.expiry(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  const soon = data.buckets.DAYS_30.length + data.buckets.DAYS_60.length + data.buckets.DAYS_90.length;
  const soonUnits =
    data.buckets.DAYS_30.reduce((s, r) => s + r.balance, 0) +
    data.buckets.DAYS_60.reduce((s, r) => s + r.balance, 0) +
    data.buckets.DAYS_90.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reporte de vencimientos"
        description={`Todos los lotes con existencias, agrupados según qué tan pronto vencen. Los días se cuentan desde ${data.today}.`}
        actions={
          <Button variant="plain" size="md" onClick={reload} disabled={refreshing}>
            {refreshing ? "Actualizando…" : "Actualizar"}
          </Button>
        }
      />

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Ya vencidos"
          value={data.expired.length}
          tone={data.expired.length ? "danger" : "plain"}
          hint="En anaquel, fuera de fecha"
        />
        <Stat label="Vencen en ≤90 días" value={soon} tone={soon ? "warn" : "plain"} hint="Lotes para priorizar" />
        <Stat label="Unidades afectadas" value={soonUnits} tone={soon ? "warn" : "plain"} hint="Suma de esos lotes" />
      </dl>

      <Panel
        title="Vencidos, aún en anaquel"
        description="No deben dispensarse. Al retirarlos físicamente, regístralos como “Descarte / Merma”."
      >
        {data.expired.length === 0 ? (
          <EmptyState
            title="No hay ningún lote vencido."
            hint={`Todos los lotes con existencias vencen después de ${today} o no tienen fecha de vencimiento registrada.`}
          />
        ) : (
          <BatchTable rows={data.expired} />
        )}
      </Panel>

      {BUCKETS.map(({ key, title, hint }) => (
        <Panel
          key={key}
          title={title}
          description={hint}
          actions={
            <span className="text-sm text-muted">
              {data.buckets[key].length} {data.buckets[key].length === 1 ? "lote" : "lotes"}
            </span>
          }
        >
          {data.buckets[key].length === 0 ? (
            <EmptyState title="Ningún lote en este rango." />
          ) : (
            <BatchTable rows={data.buckets[key]} />
          )}
        </Panel>
      ))}

      <Panel title="Cómo funcionan las fechas" description="Información útil sobre el cálculo de vencimientos.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
          <li>Solo se registra el mes de vencimiento, por lo que se almacena como el último día de ese mes.</li>
          <li>Un lote puede utilizarse hasta su fecha de vencimiento inclusive y se marca como vencido al día siguiente.</li>
          <li>Los lotes sin fecha de vencimiento no aparecen en este reporte y se sugieren al final al dispensar stock.</li>
        </ul>
      </Panel>
    </div>
  );
}

function BatchTable({ rows }: { rows: ExpiryRow[] }) {
  const page = usePaging(rows, 10);
  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th scope="col" className={thClass}>Artículo y lote</th>
            <th scope="col" className={thClass}>Vencimiento</th>
            <th scope="col" className={thRightClass}>Días restantes</th>
            <th scope="col" className={thClass}>Estado</th>
            <th scope="col" className={thRightClass}>En existencia</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r) => (
            <tr key={r.batchId} className={rowClass}>
              <td className="px-3 py-2.5">
                <Link href={`/items/${encodeURIComponent(r.itemId)}`} className={linkClass}>
                  {r.itemName}
                </Link>
                {r.variant ? <span className="text-muted"> · {r.variant}</span> : null}
                <span className="ml-2 font-mono text-xs text-muted">
                  #{r.batchId}
                  {r.batchLabel ? ` ${r.batchLabel}` : ""}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono text-sm whitespace-nowrap">{r.expiry}</td>
              <td className="px-3 py-2.5 text-right font-mono">{r.daysToExpiry}</td>
              <td className="px-3 py-2.5"><ExpiryBadge status={r.status} /></td>
              <td className="px-3 py-2.5 text-right font-mono font-medium">
                {r.balance}
                {r.unit ? <span className="text-muted"> {r.unit}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination total={rows.length} page={page.page} pageSize={page.pageSize} onPage={page.setPage} />
    </>
  );
}