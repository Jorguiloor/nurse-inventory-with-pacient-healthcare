// Crea una cuenta de usuario, o actualiza su rol, contraseña o estado activo.
//
// Uso:
//   npm run user:create -- --email enfermero@clinica.local --name "Enfermero"
//   npm run user:create -- --email supervisor@clinica.local --name "Supervisor" --role ADMIN
//   npm run user:create -- --email enfermero@clinica.local --password "..." --reset-password
//   npm run user:create -- --email enfermero@clinica.local --deactivate
//   npm run user:create -- --email enfermero@clinica.local --activate

import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const USAGE = `Uso:
  npm run user:create -- --email <correo> [--name <nombre>] [--role NURSE|ADMIN]
                         [--password <contraseña>] [--reset-password]
                         [--deactivate | --activate]

Si la cuenta aún no existe, se crea. Cuando se omite --password, se genera
una contraseña aleatoria y se imprime una sola vez.

Si la cuenta ya existe, no se modifica nada a menos que pases --role, --name,
--reset-password, --deactivate o --activate.`;

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    password: { type: "string" },
    "reset-password": { type: "boolean", default: false },
    deactivate: { type: "boolean", default: false },
    activate: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !values.email) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

if (values.deactivate && values.activate) {
  console.error("Pasa --deactivate o --activate, no ambos.");
  process.exit(1);
}

const email = values.email.trim().toLowerCase();
let role: Role | undefined;
if (values.role !== undefined) {
  if (values.role !== "NURSE" && values.role !== "ADMIN") {
    console.error(`--role debe ser NURSE o ADMIN (se recibió "${values.role}").`);
    process.exit(1);
  }
  role = values.role;
}

function choosePassword(): { plain: string; generated: boolean } {
  if (values.password) {
    if (values.password.length < 10) {
      console.error("--password debe tener al menos 10 caracteres.");
      process.exit(1);
    }
    return { plain: values.password, generated: false };
  }
  // 12 bytes aleatorios en base64url equivalen a 16 caracteres sin símbolos confusos de shell.
  return { plain: randomBytes(12).toString("base64url"), generated: true };
}

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    if (values.deactivate) {
      console.error(`No existe ninguna cuenta para ${email}.`);
      process.exit(1);
    }
    const { plain, generated } = choosePassword();
    const passwordHash = await bcrypt.hash(plain, 12);
    const name = values.name?.trim() || email.split("@")[0];
    const created = await prisma.user.create({
      data: {
        email,
        name,
        role: role ?? Role.NURSE,
        passwordHash,
        active: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        action: "user.create",
        entity: "User",
        entityId: String(created.id),
        detail: { email: created.email, role: created.role, by: "cli" },
      },
    });
    console.log(`Creado ${created.email} (${created.role}, id=${created.id}).`);
    if (generated) console.log(`Contraseña temporal: ${plain}`);
    return;
  }

  const data: { name?: string; role?: Role; passwordHash?: string; active?: boolean } = {};
  const changes: string[] = [];

  if (values.name && values.name.trim() !== existing.name) {
    data.name = values.name.trim();
    changes.push(`nombre="${data.name}"`);
  }
  if (role && role !== existing.role) {
    data.role = role;
    changes.push(`rol=${role}`);
  }
  if (values.deactivate && existing.active) {
    data.active = false;
    changes.push("activo=false");
  }
  if (values.activate && !existing.active) {
    data.active = true;
    changes.push("activo=true");
  }

  let generatedPlain: string | undefined;
  if (values["reset-password"] || values.password) {
    const { plain, generated } = choosePassword();
    data.passwordHash = await bcrypt.hash(plain, 12);
    changes.push("contraseña restablecida");
    if (generated) generatedPlain = plain;
  }

  if (changes.length === 0) {
    console.log(
      `${existing.email} ya existe (rol=${existing.role}, activo=${existing.active}). ` +
        `Pasa --role, --name, --reset-password, --deactivate o --activate para modificarlo.`,
    );
    return;
  }

  await prisma.user.update({ where: { id: existing.id }, data });
  await prisma.auditLog.create({
    data: {
      action: "user.update",
      entity: "User",
      entityId: String(existing.id),
      detail: { email: existing.email, changes, by: "cli" },
    },
  });
  console.log(`Actualizado ${existing.email}: ${changes.join(", ")}.`);
  if (generatedPlain) console.log(`Nueva contraseña temporal: ${generatedPlain}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
