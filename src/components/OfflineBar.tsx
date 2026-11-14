"use client";

import { useEffect, useState } from "react";
import type { OutboxMovement } from "@/lib/api-types";
import { discardFailed, retryFailed, store, syncNow } from "@/lib/offline";
import { Button, cn } from "./ui";
import { useOffline } from "./OfflineProvider";

/**
 * The one place a person learns whether what they recorded has reached the office database.
 * It stays out of the way when everything is synced, and becomes a panel when it is not.
 */
export function OfflineBar() {
  const state = useOffline();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<OutboxMovement[]>([]);

  useEffect(() => {
    if (!open && state.failed === 0) return;
    let live = true;
    void store.listOutbox().then((entries) => {
      if (live) setFailed(entries.filter((e) => e.status === "failed"));
    });
    return () => {
      live = false;
    };
  }, [open, state.failed, state.pending]);

  const waiting = state.pending;
  const problems = state.failed;

  // Nothing to say when online with an empty queue.
  if (state.online && waiting === 0 && problems === 0 && !state.syncing) return null;

  const tone = problems > 0 ? "danger" : state.online ? "info" : "warn";
  const message = problems > 0
    ? `${problems} ${problems === 1 ? "registro guardado no pudo" : "registros guardados no pudieron"} enviarse al servidor.`
    : state.online
      ? state.syncing
        ? `Sincronizando${waiting > 0 ? ` ${waiting} ${waiting === 1 ? "registro" : "registros"}` : ""}…`
        : `${waiting} ${waiting === 1 ? "registro en espera" : "registros en espera"} de sincronización.`
      : `Sin conexión${waiting > 0 ? ` — ${waiting} ${waiting === 1 ? "registro en cola" : "registros en cola"}` : ""}`;

  return (
    <div
      className={cn(
        "mb-4 rounded-2xl border px-4 py-3 text-sm shadow-card",
        tone === "danger" && "border-danger/30 bg-danger-soft/50 text-danger",
        tone === "warn" && "border-warn/30 bg-warn-soft/60 text-fg",
        tone === "info" && "border-accent/30 bg-accent-soft/50 text-fg",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={cn("size-2 rounded-full", state.online ? "bg-accent" : "bg-warn", tone === "danger" && "bg-danger")} />
        <span className="font-medium">{message}</span>
        {!state.online && waiting > 0 ? (
          <span className="text-muted">Se enviarán automáticamente cuando vuelvas a tener conexión.</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {problems > 0 ? (
            <Button size="sm" variant="plain" onClick={() => setOpen((v) => !v)}>
              {open ? "Ocultar" : "Revisar"}
            </Button>
          ) : null}
          <Button size="sm" variant="plain" disabled={!state.online || state.syncing} onClick={() => void syncNow()}>
            {state.syncing ? "Sincronizando…" : "Sincronizar ahora"}
          </Button>
        </span>
      </div>

      {open && failed.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {failed.map((entry) => (
            <li key={entry.clientId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-danger/20 bg-surface px-3 py-2">
              <span className="font-mono text-xs">{entry.body.type}</span>
              <span className="text-xs text-muted">
                {entry.body.itemId} · cant. {entry.body.qty} · {entry.createdAt.slice(0, 10)}
              </span>
              <span className="w-full text-xs text-danger sm:w-auto sm:flex-1">{entry.error}</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="plain" disabled={!state.online} onClick={() => void retryFailed(entry.clientId)}>
                  Reintentar
                </Button>
                <Button size="sm" variant="danger" onClick={() => void discardFailed(entry.clientId)}>
                  Descartar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
