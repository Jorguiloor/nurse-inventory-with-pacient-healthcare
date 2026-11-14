// Mantiene prisma/constraints.sql y el final de la migración inicial sincronizados,
// para que `prisma migrate deploy` en una base de datos limpia aplique tanto las tablas como las restricciones.

import { readFileSync, writeFileSync } from "node:fs";

const MARKER = "-- Restricciones adicionales que Prisma no puede expresar en schema.prisma.";
const MIGRATION = "prisma/migrations/20260101000000_init/migration.sql";
const CONSTRAINTS = "prisma/constraints.sql";

const migration = readFileSync(MIGRATION, "utf8");
const constraints = readFileSync(CONSTRAINTS, "utf8").trim();

// Busca el marcador en español o el marcador original en inglés por compatibilidad
const EN_MARKER = "-- Extra guards that Prisma cannot express in schema.prisma.";
let cut = migration.indexOf(MARKER);
if (cut === -1) cut = migration.indexOf(EN_MARKER);
if (cut === -1) {
  console.error(`No se encontró el marcador en ${MIGRATION}.`);
  process.exit(1);
}

const head = migration.slice(0, cut).trimEnd();
writeFileSync(
  MIGRATION,
  `${head}\n\n${MARKER}\n-- Editado en ${CONSTRAINTS}; sincronizar con \`npm run db:constraints\`.\n\n${constraints}\n`,
);
console.log(`Sincronizado ${CONSTRAINTS} -> ${MIGRATION}`);
