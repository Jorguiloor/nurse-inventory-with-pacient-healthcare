"use client";

import Image from "next/image";
import { COLORS, MODES, useTheme } from "@/components/ThemeProvider";
import { Card, IconCheck, PageHeader, Panel, cn } from "@/components/ui";

/**
 * Appearance settings. Nothing here touches stock: it only chooses light/dark and the colour
 * theme, and both take effect the moment they are tapped.
 */
export default function SettingsPage() {
  const { mode, color, setMode, setColor } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configuración"
        description="Ajusta la apariencia visual según tu preferencia. Los cambios se guardan localmente en este dispositivo."
      />

      <Panel title="Modo Claro u Oscuro" description="El modo Auto sigue la preferencia de tu sistema operativo.">
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
              className={cn(
                "cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition-colors",
                mode === option.value
                  ? "border-accent bg-accent-soft font-semibold text-accent"
                  : "border-rule bg-surface text-muted hover:text-fg",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title="Paleta de Colores"
        description="El color seleccionado se aplica a botones, enlaces, tarjetas y resaltados en toda la aplicación."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {COLORS.map((option) => {
            const selected = color === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setColor(option.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-3 text-sm transition-colors",
                  selected
                    ? "border-accent bg-accent-soft font-semibold text-fg"
                    : "border-rule bg-surface text-muted hover:text-fg",
                )}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full shadow-card ring-1 ring-black/10"
                  style={{ backgroundColor: option.swatch }}
                >
                  {selected ? <IconCheck className="size-4 text-white" /> : null}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      </Panel>

      <Card className="p-4 text-sm text-muted">
        Estas preferencias se guardan únicamente en este dispositivo. No afectan la vista de ninguna otra persona que inicie sesión.
      </Card>

      <Panel title="Identidad del Sistema" description="Información de la plataforma MediCheck.">
        <div className="flex items-center gap-4 rounded-2xl border border-rule bg-surface p-4 shadow-card">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-rule/70 bg-white p-2 shadow-card">
            <Image src="/logo.png" alt="Logo MediCheck" width={56} height={56} className="size-full object-contain" />
          </span>
          <div>
            <h3 className="font-semibold text-fg">MediCheck v0.1.0</h3>
            <p className="text-xs text-muted">Sistema de Gestión de Inventario Médico y Enfermería</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
