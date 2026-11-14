"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Pagination, usePaging } from "@/components/Pagination";
import type { ImportReportResponse } from "@/server/import-report";
import {
  Alert,
  Card,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  Stat,
  TableWrap,
  cn,
  linkClass,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";

const sections = [
  "gaps",
  "expired",
  "noExpiry",
  "stoppedRecording",
  "lateOpenings",
  "mismatches",
] as const;

type SectionKey = (typeof sections)[number];

const HEADINGS: { key: SectionKey; title: string; blurb: string; tone: "warn" | "danger" | "plain" }[] = [
  {
    key: "mismatches",
    title: "Totales mensuales que no cuadran",
    blurb: "Un total de cierre mensual que la aplicación no puede reconstruir desde las entradas. Requiere revisión manual.",
    tone: "danger",
  },
  {
    key: "gaps",
    title: "Saldos iniciales que no coincidieron con el cierre anterior",
    blurb: "Cada uno se convirtió en un movimiento de Ajuste para cuadrar las cifras. Abre el artículo para verlo en su historial y corrígelo si la planilla tenía un error.",
    tone: "warn",
  },
  {
    key: "expired",
    title: "Stock en existencia ya vencido",
    blurb: "Importado tal como se encontró, marcado en lugar de oculto. Regístralo como descartado desde «Fechas de vencimiento» cuando se retire del estante.",
    tone: "danger",
  },
  {
    key: "noExpiry",
    title: "Stock en existencia sin fecha de vencimiento registrada",
    blurb: "La planilla anterior nunca tuvo vencimiento para estos lotes. Al registrar nuevas entradas se solicita vencimiento, por lo que esta lista irá disminuyendo.",
    tone: "warn",
  },
  {
    key: "stoppedRecording",
    title: "Artículos que dejaron de registrarse",
    blurb: "Sus filas se detienen antes del mes más reciente, dejando el saldo congelado. Confirma si el artículo sigue en uso.",
    tone: "plain",
  },
  {
    key: "lateOpenings",
    title: "Artículos incorporados más tarde ya con stock",
    blurb: "Agregados a la planilla después del primer día con unidades ya en estante; su saldo inicial lleva la fecha en que aparecieron.",
    tone: "plain",
  },
];

function countOf(report: ImportReportResponse, key: SectionKey): number {
  if (key === "mismatches") return report.reconciliation?.mismatches.length ?? 0;
  if (key === "gaps") return report.gaps.length;
  if (key === "expired") return report.expired.length;
  if (key === "noExpiry") return report.noExpiry.length;
  if (key === "stoppedRecording") return report.stoppedRecording.length;
  return report.lateOpenings.length;
}

function ItemLink({ id }: { id: string }) {
  return (
    <Link href={`/items/${encodeURIComponent(id)}`} className={linkClass}>
      {id}
    </Link>
  );
}

export default function ImportPage() {
  const { data, error, loading } = useApi(() => api.importReport(), []);

  // The months list is a table like any other, so it gets the same pager.
  const monthsPage = usePaging(data?.months ?? [], 10);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  if (!data.imported || !data.summary || !data.reconciliation) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Planilla anterior"
          description="Lo que se importó desde la hoja de cálculo histórica y lo que aún requiere revisión."
        />
        <EmptyState
          title="Aún no se ha importado ninguna planilla anterior."
          hint={
            <>
              Ejecuta <code className="font-mono">npm run import:workbook -- --report</code> para previsualizar el
              resultado y luego <code className="font-mono">-- --apply</code> para cargarlo. Esta pantalla mostrará el informe.
            </>
          }
        />
      </div>
    );
  }

  const { summary, reconciliation } = data;
  const matched = reconciliation.monthEndsChecked - reconciliation.mismatches.length;
  const units = (n: number) => `${n.toLocaleString()} ${n === 1 ? "unidad" : "unidades"}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Planilla anterior"
        description="Lo que ingresó desde la planilla histórica y lo que requiere revisión. Nada aquí cambia por sí solo; los registros ya están en MediCheck."
      />

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Totales mensuales" value={`${matched}/${reconciliation.monthEndsChecked}`} tone={reconciliation.mismatches.length ? "danger" : "ok"} />
        <Stat label="Movimientos" value={Object.values(summary.counts).reduce((s, n) => s + n, 0).toLocaleString()} />
        <Stat label="Unidades en existencia" value={summary.unitsOnHand.toLocaleString()} />
        <Stat label="Requieren atención" value={sections.reduce<number>((s, k) => s + countOf(data, k), 0)} tone="warn" />
      </dl>

      <Card className="p-4 text-sm">
        <p>
          Cargado desde <span className="font-mono text-xs">{data.workbook ?? "la planilla anterior"}</span>
          {data.importedBy ? ` por ${data.importedBy}` : ""}
          {data.appliedAt ? ` el ${data.appliedAt.slice(0, 10)}` : ""}.
        </p>
        <p className="mt-1 text-muted">
          {summary.months} meses, del {summary.firstDate} al {summary.lastDate}, para {summary.items} artículos.
          Se recibieron {units(summary.receivedUnits)} y se dispensaron {units(summary.dispensedUnits)}, coincidiendo con los totales originales.
        </p>
        {data.rejectedGaps.length ? (
          <p className="mt-1 text-warn">
            {data.rejectedGaps.length} diferencia(s) se omitieron intencionalmente: {data.rejectedGaps.join(", ")}.
          </p>
        ) : null}
      </Card>

      {HEADINGS.map(({ key, title, blurb, tone }) => {
        const count = countOf(data, key);
        return (
          <Panel
            key={key}
            title={title}
            description={blurb}
            actions={
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-sm font-medium",
                  count === 0
                    ? "bg-ok-soft text-ok"
                    : tone === "danger"
                      ? "bg-danger-soft text-danger"
                      : tone === "warn"
                        ? "bg-warn-soft text-warn"
                        : "bg-surface-2 text-muted",
                )}
              >
                {count === 0 ? "Todo en orden" : count}
              </span>
            }
          >
            {count === 0 ? null : key === "mismatches" ? (
              <MismatchTable rows={reconciliation.mismatches} />
            ) : key === "gaps" ? (
              <GapTable rows={data.gaps} />
            ) : key === "expired" || key === "noExpiry" ? (
              <BatchTable rows={key === "expired" ? data.expired : data.noExpiry} showExpiry={key === "expired"} />
            ) : key === "stoppedRecording" ? (
              <StoppedTable rows={data.stoppedRecording} />
            ) : (
              <LateOpeningTable rows={data.lateOpenings} />
            )}
          </Panel>
        );
      })}

      <Panel title={`Meses encontrados (${data.months.length})`} description="Una pestaña por cada mes en la hoja de cálculo original.">
        <TableWrap>
          <thead>
            <tr>
              <th scope="col" className={thClass}>Pestaña</th>
              <th scope="col" className={thRightClass}>Filas</th>
              <th scope="col" className={thClass}>Periodo</th>
            </tr>
          </thead>
          <tbody>
            {monthsPage.rows.map((m) => (
              <tr key={m.month} className={rowClass}>
                <td className="px-3 py-2 text-xs">{m.sheet}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{m.rows.toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">
                  {m.firstDate} a {m.lastDate}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <Pagination total={data.months.length} page={monthsPage.page} pageSize={monthsPage.pageSize} onPage={monthsPage.setPage} />
      </Panel>

      {data.sources.length ? (
        <Alert tone="info">
          Las entregas provinieron de {[...new Set(data.sources.map((s) => s.source))].join(", ")} a lo largo de{" "}
          {data.sources.length} meses.
        </Alert>
      ) : null}

      {data.unmatchedWideRows.length ? (
        <Alert tone="warn">
          {data.unmatchedWideRows.length} fila(s) en la hoja ancha no coincidieron con ningún artículo y no se importaron:{" "}
          {data.unmatchedWideRows.map((u) => `${u.sheet} fila ${u.row} "${u.name}"`).join(", ")}.
        </Alert>
      ) : null}
    </div>
  );
}

function MismatchTable({ rows }: { rows: { month: string; itemId: string; expected: number; rebuilt: number }[] }) {
  const page = usePaging(rows, 10);
  return (
    <>
      <TableWrap className="border-danger/40">
        <thead>
          <tr>
            <th scope="col" className={thClass}>Mes</th>
            <th scope="col" className={thClass}>Artículo</th>
            <th scope="col" className={thRightClass}>Planilla anterior</th>
            <th scope="col" className={thRightClass}>Reconstruido</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r) => (
            <tr key={`${r.month}-${r.itemId}`} className={rowClass}>
              <td className="px-3 py-2 font-mono text-xs">{r.month}</td>
              <td className="px-3 py-2"><ItemLink id={r.itemId} /></td>
              <td className="px-3 py-2 text-right font-mono text-xs">{r.expected}</td>
              <td className="px-3 py-2 text-right font-mono text-xs font-medium text-danger">{r.rebuilt}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination total={rows.length} page={page.page} pageSize={page.pageSize} onPage={page.setPage} />
    </>
  );
}

function GapTable({ rows }: { rows: ImportReportResponse["gaps"] }) {
  const page = usePaging(rows, 10);
  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th scope="col" className={thClass}>Artículo</th>
            <th scope="col" className={thClass}>Fecha</th>
            <th scope="col" className={thRightClass}>Antes</th>
            <th scope="col" className={thRightClass}>Después</th>
            <th scope="col" className={thRightClass}>Ajuste</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((g) => (
            <tr key={`${g.itemId}-${g.date}`} className={rowClass}>
              <td className="px-3 py-2"><ItemLink id={g.itemId} /></td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{g.date}</td>
              <td className="px-3 py-2 text-right font-mono text-xs text-muted">{g.from}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{g.to}</td>
              <td className="px-3 py-2 text-right font-mono text-xs font-medium text-warn">
                {g.difference > 0 ? `+${g.difference}` : g.difference}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination total={rows.length} page={page.page} pageSize={page.pageSize} onPage={page.setPage} />
    </>
  );
}

function BatchTable({ rows, showExpiry }: { rows: ImportReportResponse["expired"]; showExpiry: boolean }) {
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const page = usePaging(rows, 10);
  return (
    <>
      <p className="mb-2 text-sm text-muted">
        {total.toLocaleString()} unidades en {rows.length} lotes.
      </p>
      <TableWrap>
        <thead>
          <tr>
            <th scope="col" className={thClass}>Artículo</th>
            {showExpiry ? <th scope="col" className={thClass}>Vencimiento</th> : null}
            <th scope="col" className={thRightClass}>Unidades</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r) => (
            <tr key={`${r.itemId}-${r.expiry ?? "none"}`} className={rowClass}>
              <td className="px-3 py-2"><ItemLink id={r.itemId} /></td>
              {showExpiry ? <td className="px-3 py-2 font-mono text-xs">{r.expiry}</td> : null}
              <td className="px-3 py-2 text-right font-mono text-xs">{r.balance}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination total={rows.length} page={page.page} pageSize={page.pageSize} onPage={page.setPage} />
    </>
  );
}

function StoppedTable({ rows }: { rows: ImportReportResponse["stoppedRecording"] }) {
  const page = usePaging(rows, 10);
  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th scope="col" className={thClass}>Artículo</th>
            <th scope="col" className={thClass}>Último registro</th>
            <th scope="col" className={thRightClass}>Saldo congelado</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r) => (
            <tr key={r.itemId} className={rowClass}>
              <td className="px-3 py-2"><ItemLink id={r.itemId} /></td>
              <td className="px-3 py-2 font-mono text-xs">{r.lastDate}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{r.balance}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination total={rows.length} page={page.page} pageSize={page.pageSize} onPage={page.setPage} />
    </>
  );
}

function LateOpeningTable({ rows }: { rows: ImportReportResponse["lateOpenings"] }) {
  const page = usePaging(rows, 10);
  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th scope="col" className={thClass}>Artículo</th>
            <th scope="col" className={thClass}>Primera aparición</th>
            <th scope="col" className={thRightClass}>Unidades</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r) => (
            <tr key={r.itemId} className={rowClass}>
              <td className="px-3 py-2"><ItemLink id={r.itemId} /></td>
              <td className="px-3 py-2 font-mono text-xs">{r.date}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{r.qty}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination total={rows.length} page={page.page} pageSize={page.pageSize} onPage={page.setPage} />
    </>
  );
}