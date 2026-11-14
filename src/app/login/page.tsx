import Image from "next/image";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    // A single card on the soft page background: nothing to click until you have an account.
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-20 place-items-center rounded-3xl border border-rule/70 bg-white p-2.5 shadow-raised">
            <Image src="/logo.png" alt="MediCheck" width={80} height={80} priority className="size-full object-contain" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">MediCheck</h1>
            <p className="mt-1 text-sm text-muted">Sistema de Gestión de Inventario Médico e Insumos de Enfermería.</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-rule bg-surface p-6 shadow-card">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}