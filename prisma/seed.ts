// Loads the catalogue items and creates/updates the first admin account.
// Replaces old catalogue items with the official 57 MediCheck items and seeds their initial stock.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Category } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));

interface SeedItem {
  id: string;
  name: string;
  variant: string | null;
  category: Category;
  initialQty?: number;
  section?: string;
  exactDisplayQty?: number;
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrador";
  if (!email) {
    console.log("Admin: omitido (configura SEED_ADMIN_EMAIL para crear uno).");
    const firstUser = await prisma.user.findFirst({ orderBy: { id: "asc" } });
    return firstUser;
  }

  let adminPassword = password;
  let generated = false;
  if (!adminPassword) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SEED_ADMIN_PASSWORD es obligatorio en entornos de producción.");
    }
    const { randomBytes } = await import("node:crypto");
    adminPassword = randomBytes(12).toString("base64url");
    generated = true;
  }
  if (adminPassword.length < 10) throw new Error("SEED_ADMIN_PASSWORD debe tener al menos 10 caracteres.");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.name !== name) {
      await prisma.user.update({ where: { id: existing.id }, data: { name } });
    }
    console.log(`Admin: ${email} ya existe.`);
    return existing;
  }

  const created = await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(adminPassword, 12), role: "ADMIN" },
  });
  if (generated) {
    console.log(`Admin: creado ${email} con contraseña segura generada: ${adminPassword}`);
  } else {
    console.log(`Admin: creado ${email}.`);
  }
  return created;
}

async function seedItems(adminUserId: number) {
  const items: SeedItem[] = JSON.parse(readFileSync(join(here, "items.seed.json"), "utf8"));
  const validIds = items.map((i) => i.id);

  // Remove any old catalogue items not in the official 57-item list
  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { itemId: { notIn: validIds } } });
    await tx.batch.deleteMany({ where: { itemId: { notIn: validIds } } });
    await tx.monthClosing.deleteMany({ where: { itemId: { notIn: validIds } } });
    const removed = await tx.item.deleteMany({ where: { id: { notIn: validIds } } });
    if (removed.count > 0) {
      console.log(`Artículos antiguos eliminados: ${removed.count}.`);
    }
  });

  const openingDate = new Date("2026-10-30T00:00:00.000Z");

  for (const it of items) {
    await prisma.item.upsert({
      where: { id: it.id },
      update: { name: it.name, variant: it.variant, category: it.category, active: true },
      create: { id: it.id, name: it.name, variant: it.variant, category: it.category, active: true },
    });

    const initialQty = it.initialQty ?? 0;
    const existingTxCount = await prisma.transaction.count({ where: { itemId: it.id } });
    if (existingTxCount === 0 && initialQty > 0) {
      const batch = await prisma.batch.create({
        data: {
          itemId: it.id,
          expiry: null,
          label: "Stock Inicial",
          source: "Control de Gastos 30-10-2026",
          receivedOn: openingDate,
          qtyReceived: initialQty,
        },
      });

      await prisma.transaction.create({
        data: {
          itemId: it.id,
          batchId: batch.id,
          type: "OPENING",
          date: openingDate,
          qty: initialQty,
          source: "Control de Gastos 30-10-2026",
          remarks: it.exactDisplayQty !== undefined ? `Cantidad exacta: ${it.exactDisplayQty}` : null,
          userId: adminUserId,
        },
      });
    }
  }
  console.log(`Artículos oficiales MediCheck asegurados: ${items.length}.`);
}

async function main() {
  const admin = await seedAdmin();
  const fallbackUser = admin ?? (await prisma.user.findFirst({ orderBy: { id: "asc" } }));
  if (!fallbackUser) {
    throw new Error("No existe ningún usuario en la base de datos para asignar el stock inicial.");
  }
  await seedItems(fallbackUser.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
