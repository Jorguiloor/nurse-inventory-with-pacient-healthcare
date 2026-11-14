"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { TransactionView } from "@/lib/api-types";
import { usePermissions } from "./SessionProvider";
import { Pagination, usePaging } from "./Pagination";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Qty,
  TableWrap,
  Textarea,
  cn,
  rowClass,
  thClass,
  thRightClass,
  txLabel,
} from "./ui";

/**
 * The entry history. Everyone can read it; an admin can cancel an entry, which is the only way
 * to reverse a mistake (nothing is ever deleted). Cancelling asks for a reason.
 */
export function TxTable({
  transactions,
  onChanged,
  emptyTitle = "Sin movimientos registrados todavía.",
  emptyHint,
  showItem = true,
}: {
  transactions: TransactionView[];
  onChanged?: () => void;
  emptyTitle?: string;
  emptyHint?: React.ReactNode;
  showItem?: boolean;
}) {
  const { isAdmin } = usePermissions();
  const [voiding, setVoiding] = useState<TransactionView>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const page = usePaging(transactions, 10);

  const submitVoid = async () => {
    if (!voiding) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.voidEntry(voiding.id, reason);
      setVoiding(undefined);
      setReason("");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular el movimiento.");
    } finally {
      setBusy(false);
    }
  };

  if (transactions.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;

  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th scope="col" className={thClass}>Fecha</th>
            {showItem ? <th scope="col" className={thClass}>Artículo</th> : null}
            <th scope="col" className={thClass}>Tipo</th>
            <th scope="col" className={thRightClass}>Cantidad</th>
            <th scope="col" className={thClass}>Lote / Venc.</th>
            <th scope="col" className={thClass}>Por</th>
            {isAdmin ? <th scope="col" className={thRightClass}><span className="sr-only">Acciones</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((t) => (
            <tr key={t.id} className={cn(rowClass, t.voidedAt && "opacity-60")}>
              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{t.date}</td>
              {showItem ? (
                <td className="px-3 py-2.5">
                  <span className="block truncate font-medium">{t.itemName}</span>
                  {t.remarks || t.source ? (
                    <span className="block truncate text-xs text-muted">
                      {[t.source, t.remarks].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </td>
              ) : null}
              <td className="px-3 py-2.5 whitespace-nowrap">{txLabel(t.type)}</td>
              <td className="px-3 py-2.5 text-right"><Qty value={t.qty} /></td>
              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                {t.batchExpiry ?? "—"}
                {t.batchLabel ? <span className="block text-muted">{t.batchLabel}</span> : null}
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap">{t.userName}</td>
              {isAdmin ? (
                <td className="px-3 py-2.5 text-right">
                  {t.voidedAt ? (
                    <span className="text-xs text-muted" title={t.voidReason ?? ""}>
                      Anulado
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="plain"
                      onClick={() => {
                        setVoiding(t);
                        setReason("");
                        setError(undefined);
                      }}
                    >
                      Anular
                    </Button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <Pagination total={transactions.length} page={page.page} pageSize={page.pageSize} onPage={page.setPage} />

      {voiding ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="void-title">
          <div className="w-full max-w-md rounded-2xl border border-rule bg-surface p-6 shadow-float">
            <h2 id="void-title" className="text-lg font-semibold">¿Anular este movimiento?</h2>
            <p className="mt-1 text-sm text-muted">
              {voiding.itemName} · {txLabel(voiding.type)} {voiding.qty} el {voiding.date}.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <Alert tone="warn">
                El movimiento permanecerá en el historial con una nota de anulación, pero ya no sumará ni restará al stock. Nada se borra.
              </Alert>
              <Field label="Motivo" htmlFor="void-reason" hint="Se guarda en el historial de actividad con tu nombre. Escribe al menos unas palabras.">
                <Textarea
                  id="void-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Se seleccionó el artículo equivocado…"
                  autoFocus
                />
              </Field>
              {error ? <Alert tone="error">{error}</Alert> : null}
              <div className="flex justify-end gap-2">
                <Button variant="plain" size="md" onClick={() => setVoiding(undefined)} disabled={busy}>
                  Conservar movimiento
                </Button>
                <Button variant="danger" size="md" onClick={submitVoid} disabled={busy || reason.trim().length < 3}>
                  {busy ? "Anulando…" : "Anular movimiento"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
