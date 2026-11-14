"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TxTable } from "@/components/TxTable";
import { Pagination, usePaging } from "@/components/Pagination";
import { TopUsedChart, UsageTrendChart } from "@/components/Charts";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  ExpiryBadge,
  IconAlert,
  IconChevron,
  IconDispense,
  IconReceive,
  Loading,
  LowBadge,
  PageHeader,
  Panel,
  Stat,
  TableWrap,
  cn,
  linkClass,
  panelLink,
  rowClass,
  thClass,
  thRightClass,
} from "@/components/ui";
import { usePermissions } from "@/components/SessionProvider";

/** The two things a nurse does most, one tap from the front page. */
function QuickAction({ href, label, hint, Icon }: { href: string; label: string; hint: string; Icon: (p: { className?: string }) => React.JSX.Element }) {
  return (
    <Link
      href={href}
      className="group flex flex-1 items-center gap-3 rounded-2xl border border-rule bg-surface p-4 shadow-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-raised"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <IconChevron className="text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}

export default function DashboardPage() {
  const { isAdmin } = usePermissions();
  const { data, error, loading, reload, refreshing } = useApi(() => api.dashboard(), []);

  // The low-stock panel is a table like any other, so it gets the same pager.
  const lowPage = usePaging(data?.lowStock ?? [], 10);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={new Error(error)} />;
  if (!data) return null;

  // The month in progress is the last of the twelve, so the trend reads left to right.
  const totals = data.monthTotals[data.monthTotals.length - 1];
  const attention = data.lowStock.length + data.expiringSoon.length + data.expired.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Inicio"
        description="Atención requerida para hoy y movimientos recientes de inventario."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/help" className={panelLink}>
              Cómo usar el sistema
            </Link>
            <Button variant="plain" size="md" onClick={reload} disabled={refreshing}>
              {refreshing ? "Actualizando…" : "Actualizar"}
            </Button>
          </div>
        }
      />

      {/* What needs doing comes before anything else on the page. */}
      {attention === 0 ? (
        <Alert tone="success" className="text-base">
          <span className="font-medium">Todo está al día.</span> No hay stock crítico, ni artículos por vencer en los próximos 90 días, ni stock vencido en anaquel.
        </Alert>
      ) : (
        <Alert tone="warn" className="text-base">
          <span className="font-medium">
            {attention} {attention === 1 ? "alerta requiere" : "alertas requieren"} atención
          </span>{" "}
          {[
            data.lowStock.length > 0 ? `${data.lowStock.length} bajo en stock` : null,
            data.expiringSoon.length > 0 ? `${data.expiringSoon.length} próximos a vencer` : null,
            data.expired.length > 0 ? `${data.expired.length} vencidos en anaquel` : null,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </Alert>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Artículos activos" value={data.itemCount} hint="En el catálogo" />
        <Stat
          label="Stock bajo"
          value={data.lowStock.length}
          tone={data.lowStock.length ? "warn" : "plain"}
          hint="En o bajo el nivel mínimo"
        />
        <Stat
          label="Por vencer (≤90d)"
          value={data.expiringSoon.length}
          tone={data.expiringSoon.length ? "warn" : "plain"}
          hint="Lotes con existencias"
        />
        <Stat
          label="Vencidos en stock"
          value={data.expired.length}
          tone={data.expired.length ? "danger" : "plain"}
          hint="Registrar como descarte"
        />
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row">
        <QuickAction href="/receive" label="Entrada de stock" hint="Registrar como recibido" Icon={IconReceive} />
        <QuickAction href="/receive?tab=dispense" label="Salida de stock" hint="Registrar como dispensado" Icon={IconDispense} />
      </div>

      <Panel
        title="Requiere atención"
        description={totals ? `${totals.month}: ${totals.received} recibidos, ${totals.dispensed} entregados hasta ahora.` : undefined}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Stock bajo">
            {data.lowStock.length === 0 ? (
              <EmptyState title="No hay artículos bajo el nivel mínimo." hint="Los artículos aparecen aquí cuando configuras un nivel de reorden y el inventario llega a ese límite." />
            ) : (
              <>
                <TableWrap>
                  <thead>
                    <tr>
                      <th scope="col" className={thClass}>Artículo</th>
                      <th scope="col" className={thRightClass}>En existencia</th>
                      <th scope="col" className={thRightClass}>Reordenar en</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowPage.rows.map((item) => (
                      <tr key={item.id} className={rowClass}>
                        <td className="px-3 py-2">
                          <Link href={`/items/${encodeURIComponent(item.id)}`} className={linkClass}>
                            {item.name}
                            {item.variant ? <span className="text-muted"> · {item.variant}</span> : null}
                          </Link>
                          <span className="ml-2 font-mono text-xs text-muted">{item.id}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-warn">
                          {item.balance}
                          {item.unit ? <span className="text-muted"> {item.unit}</span> : null}
                          <LowBadge />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{item.reorderLevel ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
                <Pagination total={data.lowStock.length} page={lowPage.page} pageSize={lowPage.pageSize} onPage={lowPage.setPage} />
                <Link href="/stock?lowOnly=1" className={panelLink}>
                  Ver inventario completo
                </Link>
              </>
            )}
          </Panel>

          <Panel title="Próximos a vencer" actions={<Link href="/expiry" className={panelLink}>Reporte de vencimientos</Link>}>
            {data.expiringSoon.length === 0 ? (
              <EmptyState title="Ningún lote vence en los próximos 90 días." />
            ) : (
              <ul className="flex flex-col gap-2">
                {data.expiringSoon.map((b) => (
                  <li
                    key={`${b.itemId}-${b.expiry}`}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-card",
                      b.daysLeft <= 30 ? "border-danger/25 bg-danger-soft/50" : "border-warn/25 bg-warn-soft/50",
                    )}
                  >
                    <span className="min-w-0">
                      <Link href={`/items/${encodeURIComponent(b.itemId)}`} className={linkClass}>
                        {b.itemName}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted">
                        {b.expiry} · {b.daysLeft} día{b.daysLeft === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono font-medium">{b.balance}</span>
                      <ExpiryBadge status={b.daysLeft <= 30 ? "DAYS_30" : "DAYS_90"} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {data.expired.length > 0 ? (
          <Card className="border-danger/25 bg-danger-soft/40 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger">
              <IconAlert />
              Vencidos pero aún en existencia ({data.expired.length})
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {data.expired.map((e) => (
                <li key={e.itemId}>
                  <Link
                    href={`/items/${encodeURIComponent(e.itemId)}`}
                    className="flex items-center gap-2 rounded-full border border-danger/25 bg-surface px-3 py-1 text-sm shadow-card"
                  >
                    <span className="underline-offset-2 hover:underline">{e.itemName}</span>
                    <span className="font-mono font-medium text-danger">{e.balance}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">
              El stock vencido no debe dispensarse. Regístralo como “Descartado” para darlo de baja del inventario.
            </p>
          </Card>
        ) : null}
      </Panel>

      <Panel
        title="Consumo en los últimos 12 meses"
        description="Comparación mensual de entradas vs salidas."
      >
        <Card className="p-4">
          <UsageTrendChart data={data.monthTotals} />
        </Card>
      </Panel>

      {totals ? (
        <Panel
          title={`Más utilizados en ${totals.month}`}
          description={`${totals.dispensed} ${totals.dispensed === 1 ? "unidad entregada" : "unidades entregadas"} en lo que va del mes.`}
        >
          <Card className="p-4">
            <TopUsedChart data={data.topUsed} />
          </Card>
        </Panel>
      ) : null}

      <Panel title="Últimos movimientos" description="Últimos registros guardados en el sistema.">
        <TxTable transactions={data.recent} onChanged={reload} />
      </Panel>

      {!isAdmin ? (
        <p className="text-xs text-muted">
          Los meses cerrados bloquean nuevos registros en sus fechas.
        </p>
      ) : null}
    </div>
  );
}