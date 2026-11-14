# MediCheck

Sistema de Gestión de Inventario de Suministros Médicos y Enfermería.

Desarrollado con Next.js (App Router) + TypeScript + Prisma + PostgreSQL. Toda la lógica de negocio reside en una API REST bajo `src/app/api`, y las pantallas bajo `src/app/(app)` actúan como un cliente en TSX con soporte sin conexión (PWA + IndexedDB). Las existencias nunca se almacenan como un número fijo: cada cambio es una fila de movimiento y los saldos son siempre la suma de las filas.

## Pantallas del Sistema

| Pantalla | Ruta | Función principal |
| --- | --- | --- |
| Panel principal | `/` | Bajo stock, lotes próximos a vencer, lotes vencidos aún en estante, últimos movimientos y gráficos de uso |
| Registrar | `/receive` | Una sola pantalla con cuatro pestañas: Recibido, Entregado, Corrección y Desechado. El vencimiento elige el lote; la entrega usa primero el vencimiento más próximo (FEFO), con opción de división manual. Saldos iniciales solo para administradores |
| Inventario | `/stock` | Saldos disponibles con desglose por lotes, filtrados por búsqueda, categoría o bajo stock. Descarga en formato `.xlsx` |
| Vencimientos | `/expiry` | Lotes con existencias agrupados según qué tan pronto vencen: vencidos, 30, 60 y 90 días |
| Cierre de mes | `/month-end` | Conteo físico de estante, guardado de conteos, cierre de mes y descarga del libro mensual en `.xlsx`. El administrador puede reabrir meses cerrados |
| Artículos | `/items` | Catálogo general de medicamentos e insumos (187 artículos). El administrador edita unidad, nivel de reposición, estado activo y crea o elimina artículos |
| Historial de artículo | `/items/:id` | Lotes, movimientos registrados y gráfico mensual de uso y existencias del artículo |
| Importación de libro | `/admin/import` | Informe de migración desde `NURSE.xlsx` y brechas pendientes de revisión |
| Registro de auditoría | `/admin/audit` | Historial inmutable de cada acción en la plataforma, indicando quién la realizó y cuándo (solo administradores) |

## API REST

Todas las rutas requieren una sesión activa y responden en formato JSON. Los errores devuelven `{ "error": string, "code": string }` con códigos de estado HTTP semánticos: `400` para solicitudes inválidas, `401`/`403` para permisos, `404` cuando no existe el recurso, `409` cuando las reglas de inventario rechazan la operación y `422` cuando falla la validación de campos.

| Método | Ruta |
| --- | --- |
| `GET` | `/api/session` — usuario conectado, fecha actual y meses cerrados |
| `GET` | `/api/sync` — instantánea completa para modo sin conexión: artículos, lotes, movimientos y meses cerrados |
| `GET` | `/api/dashboard` — indicadores, alertas y series de uso del panel principal |
| `GET` `POST` | `/api/items` — listar catálogo o agregar artículo (admin) |
| `GET` `PATCH` `DELETE` | `/api/items/:id` — detalle con lotes y movimientos; editar o eliminar (admin) |
| `GET` | `/api/stock` — saldos actuales por artículo y por lote |
| `GET` | `/api/expiry` — reporte de lotes vencidos y próximos a vencer |
| `GET` `POST` | `/api/transactions` — historial o registro de un movimiento de inventario |
| `POST` | `/api/transactions/allocate` — simulación de asignación FEFO de solo lectura |
| `POST` | `/api/transactions/:id/void` — anular un movimiento con motivo obligatorio (admin) |
| `GET` | `/api/months` — meses cerrados y mes sugerido para próximo cierre |
| `GET` `POST` | `/api/month-end` — hoja de conteo físico o guardado de conteos |
| `POST` | `/api/month-end/close` · `/api/month-end/reopen` — cerrar o reabrir un mes (admin) |
| `GET` | `/api/import` — reporte de migración del libro de Excel (admin) |
| `GET` | `/api/export/ledger?month=2026-09` o `?from=&to=` — libro mensual en `.xlsx` |
| `GET` | `/api/export/stock` — saldos y lotes en `.xlsx`, respetando los filtros activos |
| `GET` | `/api/audit` — consulta del registro de auditoría (admin) |

## Exportación a Excel (`.xlsx`)

Ambas descargas generan archivos `.xlsx` estándar compatibles con Microsoft Excel, LibreOffice Calc o Google Sheets:

1. **Libro mensual (`/api/export/ledger`)**: Incluye una hoja `ITEMS` con el catálogo y hojas mensuales con el desglose diario (`DATE`, `ITEM ID`, `BEGINNING BALANCE`, `RECEIVED`, `DISPENSED`, `ENDING BALANCE`, `EXPIRATION DATE`) más la vista ancha compatible con el formato histórico de enfermería.
2. **Inventario actual (`/api/export/stock`)**: Incluye dos hojas: `INVENTARIO` (resumen por artículo con saldo actual, nivel de reposición y vencimiento más próximo) y `LOTES` (desglose por lote individual).

## Funcionamiento Sin Conexión (Offline-First)

MediCheck es una Aplicación Web Progresiva (PWA) diseñada para seguir operando cuando la clínica pierde la conexión a internet:

- **Espejo local en IndexedDB (`medicheck-inventory`)**: Tras iniciar sesión, el navegador descarga una instantánea completa (`GET /api/sync`) y calcula los saldos localmente aplicando exactamente las mismas reglas de `src/lib/stock.ts` que usa el servidor.
- **Cola de salida (`outbox`)**: Los movimientos registrados sin red se guardan localmente con un identificador único (`clientId` UUID) y se reflejan de inmediato en pantalla como pendientes. Al volver la conexión, se sincronizan de forma idempotente.
- **Manejo de conflictos**: Si el servidor rechaza un movimiento al sincronizar (por ejemplo, si otro usuario agotó el lote mientras tanto), no se pierde silenciosamente: queda marcado en la barra de estado para revisarlo, reintentarlo o descartarlo manualmente.

## Estructura del Código

| Módulo | Ubicación |
| --- | --- |
| Reglas de inventario (saldos, FEFO, no negativos, fechas) | `src/lib/stock.ts`, pruebas en `src/lib/stock.test.ts` |
| Lectura de libros Excel (`NURSE.xlsx`) | `src/lib/workbook.ts`, pruebas en `src/lib/workbook.test.ts` |
| Conversión de filas de Excel a lotes y movimientos | `src/lib/import-ledger.ts`, pruebas en `src/lib/import-ledger.test.ts` |
| Reconstrucción del libro diario mensual para exportación | `src/lib/export-ledger.ts`, pruebas en `src/lib/export-ledger.test.ts` |
| Generación de archivos `.xlsx` | `src/server/export.ts` |
| Scripts CLI de importación y verificación | `scripts/import-workbook.ts`, `scripts/verify-import.ts` |
| Utilidades de fechas (`YYYY-MM-DD`) | `src/lib/dates.ts`, pruebas en `src/lib/dates.test.ts` |
| Tipos compartidos de cliente y servidor | `src/lib/api-types.ts` |
| Servicios de dominio (inventario, artículos, meses, auditoría) | `src/server/` |
| Controladores de rutas API | `src/app/api/**/route.ts` |
| Motor sin conexión (IndexedDB, cola de sincronización, sesión offline) | `src/lib/offline/` |
| Service Worker y manifiesto PWA | `public/sw.js`, `public/manifest.webmanifest` |
| Componentes de interfaz y gráficos | `src/components/` |
| Esquema de base de datos y restricciones SQL | `prisma/schema.prisma`, `prisma/constraints.sql` |
| Semilla inicial (187 artículos en español y cuenta admin) | `prisma/seed.ts`, `prisma/items.seed.json` |
| Autenticación (NextAuth / Auth.js, roles `NURSE` y `ADMIN`) | `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts` |
| Gestión de cuentas por línea de comandos | `scripts/create-user.ts` |

## Instalación y Puesta en Marcha

```bash
npm install
cp .env.example .env        # Configurar DATABASE_URL, DIRECT_URL, AUTH_SECRET y SEED_ADMIN_*
npm run db:deploy           # Aplicar migraciones de Prisma y restricciones SQL
npm run db:seed             # Cargar los 187 artículos del catálogo y el usuario administrador
npm run dev                 # Iniciar en http://localhost:3000
```

### Comandos Útiles

```bash
npm run dev                 # Servidor de desarrollo en http://localhost:3000
npm test                    # Ejecutar las 82 pruebas unitarias (stock, import, export y fechas)
npm run typecheck           # Verificación estática de tipos con TypeScript
npm run user:create -- -h   # Crear, activar, desactivar usuarios o restablecer contraseñas
npm run db:studio           # Explorador visual de la base de datos con Prisma Studio
```
