"use client";

import Link from "next/link";
import { usePermissions } from "@/components/SessionProvider";
import {
  IconReceive,
  IconStock,
  PageHeader,
  Panel,
  linkClass,
} from "@/components/ui";

/**
 * A plain-language guide for the person who runs the office, not for whoever built the app.
 * Deliberately static and jargon-free: it never touches data, so it is always safe to open.
 */
export default function HelpPage() {
  const { isAdmin } = usePermissions();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Guía de uso de MediCheck"
        description="Una guía breve y sencilla. Nada en esta página modifica el inventario, así que puedes consultarla con total tranquilidad."
      />

      <Panel title="Las dos tareas más frecuentes" description="Casi todo tu día se resume en una de estas dos opciones.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HowCard
            href="/receive"
            Icon={IconReceive}
            title="Registrar movimiento"
            body="Aquí anotas lo que ocurrió: llegó mercadería, entregaste un medicamento o insumo, descartaste algo vencido o roto, o necesitas ajustar el conteo. Elige la pestaña que corresponda."
          />
          <HowCard
            href="/stock"
            Icon={IconStock}
            title="Consultar existencias"
            body="Úsalo para ver cuánto queda de cada artículo. Escribe en el buscador para encontrarlo rápido o descarga la lista en Excel."
          />
        </div>
      </Panel>

      <Panel title="¿Qué necesitas hacer?" description="Ubica tu situación y toca la pantalla de la derecha.">
        <ul className="flex flex-col gap-2">
          <TaskRow to="Registrar movimiento → Entrada / Recibido" href="/receive" when="Llegaron medicamentos o suministros" />
          <TaskRow to="Registrar movimiento → Salida / Dispensado" href="/receive?tab=dispense" when="Entregaste algo a un paciente o área" />
          <TaskRow to="Registrar movimiento → Descarte / Merma" href="/receive?tab=dispose" when="Algo venció, se rompió o fue retirado" />
          <TaskRow to="Registrar movimiento → Ajuste de conteo" href="/receive?tab=adjust" when="El conteo físico no coincide con el sistema" />
          <TaskRow to="Existencias" href="/stock" when="Quieres saber cuánto queda disponible" />
          <TaskRow to="Fechas de vencimiento" href="/expiry" when="Quieres revisar qué está próximo a vencer" />
          <TaskRow to="Cierre mensual" href="/month-end" when="Llegó el fin de mes" />
          <TaskRow to="Catálogo de artículos" href="/items" when="Quieres ver la ficha e historial completo de un artículo" />
        </ul>
      </Panel>

      <Panel title="Cada pantalla en una línea" description="El menú lateral izquierdo explicado.">
        <ul className="flex flex-col gap-2.5">
          <ScreenLink href="/" name="Inicio" what="Lo que requiere atención hoy y los movimientos más recientes." />
          <ScreenLink href="/receive" name="Registrar movimiento" what="Ingresos, salidas, descartes o ajustes de inventario." />
          <ScreenLink href="/stock" name="Existencias" what="Cuánto queda de cada artículo y en qué lotes se encuentra." />
          <ScreenLink href="/expiry" name="Fechas de vencimiento" what="Artículos vencidos o próximos a vencer." />
          <ScreenLink href="/month-end" name="Cierre mensual" what="Conteo físico de estantería, reporte Excel y cierre de mes." />
          <ScreenLink href="/items" name="Catálogo de artículos" what="Todos los medicamentos, insumos y equipos registrados." />
          {isAdmin ? (
            <>
              <ScreenLink href="/admin/import" name="Planilla anterior" what="Datos importados desde el archivo histórico de Excel." />
              <ScreenLink href="/admin/audit" name="Bitácora de actividad" what="Registro inalterable de cada cambio y quién lo realizó." />
            </>
          ) : null}
        </ul>
      </Panel>

      <Panel title="Glosario de términos" description="Si algún término en pantalla no te resulta familiar, aquí lo tienes.">
        <dl className="flex flex-col gap-3">
          <Term term="Artículo">Cada producto que maneja enfermería, como un medicamento, insumo o equipo. Cada uno tiene su propio código, como MED-001.</Term>
          <Term term="Lote">
            Una entrega o caja de un artículo que comparte la misma fecha de vencimiento. Al registrar una entrada, el vencimiento que
            indiques define a qué lote se suma.
          </Term>
          <Term term="En existencia">La cantidad actual de un artículo disponible en el estante.</Term>
          <Term term="Recibido">Stock que ingresó a enfermería y se suma a las existencias.</Term>
          <Term term="Dispensado">Stock entregado a un paciente o servicio; se descuenta de las existencias.</Term>
          <Term term="Descartado">Stock retirado del estante por vencimiento, rotura o deterioro.</Term>
          <Term term="Ajuste de conteo">
            Cambio aplicado a un lote para que el sistema coincida con lo contado físicamente. Un número positivo suma y uno negativo resta.
          </Term>
          <Term term="Nivel de reorden">
            Cantidad mínima configurada para un artículo. Cuando el stock llega a ese número o baja de él, se marca como Stock bajo para reponerlo.
          </Term>
          <Term term="Anular">
            Revertir un movimiento registrado por error. El registro permanece visible en el historial con una nota de anulación; nada se borra en silencio.
          </Term>
          <Term term="Cierre mensual">
            Contar todo, guardar los conteos y cerrar el mes para congelar sus cifras. Puede reabrirse más adelante dejando constancia del motivo.
          </Term>
        </dl>
      </Panel>

      <Panel title="Si algo no cuadra">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-rule">
          <li>
            ¿Registraste algo por equivocación? Busca el movimiento en el artículo o en{" "}
            <Link href="/admin/audit" className={linkClass}>Bitácora de actividad</Link> y anúlalo indicando el motivo; luego regístralo
            correctamente.
          </li>
          <li>
            ¿Un mes está cerrado y necesitas corregir algo dentro de él? Abre{" "}
            <Link href="/month-end" className={linkClass}>Cierre mensual</Link>, elige el mes y reábrelo indicando el motivo.
          </li>
          <li>¿No puedes iniciar sesión? Revisa tu correo y contraseña. Si persiste, solicita al administrador restablecer tu acceso.</li>
          <li>¿Dudas entre «Entrada / Recibido» y «Ajuste de conteo»? Si llegó mercadería nueva, usa Entrada. Si el estante y el sistema no coinciden, usa Ajuste.</li>
        </ul>
      </Panel>
    </div>
  );
}

function HowCard({
  href,
  title,
  body,
  Icon,
}: {
  href: string;
  title: string;
  body: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-2xl border border-rule bg-surface p-4 shadow-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-raised"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-sm text-muted">{body}</span>
    </Link>
  );
}

function TaskRow({ when, to, href }: { when: string; to: string; href: string }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-xl border border-rule bg-surface-2/60 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="text-sm">{when}</span>
      <Link href={href} className={linkClass}>
        {to}
      </Link>
    </li>
  );
}

function ScreenLink({ href, name, what }: { href: string; name: string; what: string }) {
  return (
    <li className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <Link href={href} className={linkClass}>
        {name}
      </Link>
      <span className="text-sm text-muted">{what}</span>
    </li>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-rule bg-surface-2/60 px-3.5 py-2.5">
      <dt className="text-sm font-semibold">{term}</dt>
      <dd className="mt-0.5 text-sm text-muted">{children}</dd>
    </div>
  );
}
