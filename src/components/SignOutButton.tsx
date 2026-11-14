"use client";

import { useState } from "react";
import { store } from "@/lib/offline/store";
import { signOutAction } from "./signout-action";

export function SignOutButton() {
  const [loading, setLoading] = useState(false);

  const handleSignOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    try {
      const outbox = await store.listOutbox();
      const pending = outbox.filter((o) => o.status === "pending").length;
      if (pending > 0) {
        const proceed = confirm(
          `Tienes ${pending} movimiento(s) pendiente(s) de sincronizar en este dispositivo. ` +
            `Si cierras sesión ahora sin internet, podrían perderse o sincronizarse bajo otra cuenta. ` +
            `¿Deseas cerrar sesión de todas formas?`,
        );
        if (!proceed) return;
      }

      setLoading(true);

      // Limpia la base de datos local IndexedDB (artículos, lotes, transacciones, sesión y credencial PBKDF2)
      await store.reset();

      // Limpia la caché del Service Worker en el navegador
      if (typeof window !== "undefined" && "caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.filter((name) => name.startsWith("medicheck-")).map((name) => caches.delete(name)),
        );
      }

      // Si no hay red, redirige directamente a /login; si hay red, ejecuta la acción de NextAuth
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        window.location.replace("/login");
        return;
      }

      await signOutAction();
    } catch {
      window.location.replace("/login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSignOut} className="flex-1">
      <button
        type="submit"
        disabled={loading}
        className="w-full cursor-pointer rounded-xl border border-rule bg-surface px-2.5 py-1 text-xs text-muted shadow-card transition-[transform,box-shadow,color] duration-150 hover:-translate-y-px hover:text-fg hover:shadow-raised active:translate-y-0 active:shadow-none disabled:opacity-50"
      >
        {loading ? "Cerrando…" : "Cerrar sesión"}
      </button>
    </form>
  );
}