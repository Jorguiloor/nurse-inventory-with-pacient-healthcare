// Sign-in throttling stored in the database, so it survives restarts and is shared by every
// server instance.
//
// Two counters per attempt:
//   pair:<ip>|<email>  5 free failures, then an exponential wait (30 s, 1 min, 2 min … max 15 min).
//                      Keyed on the address too, so a stranger elsewhere cannot lock a real user
//                      (or the admin) out of their own account.
//   ip:<ip>            20 free failures across any accounts, then the same backoff. Stops one
//                      address from trying a common password against many accounts.
import { db } from "./db";

const PAIR_FREE = 5;
const IP_FREE = 20;
const BASE_MS = 30_000;
const MAX_MS = 15 * 60_000;
/** Counters untouched for this long are forgotten. */
const STALE_MS = 24 * 60 * 60_000;

function keys(ip: string, email: string) {
  return { pair: `pair:${ip}|${email}`, ip: `ip:${ip}` };
}

function waitFor(failures: number, free: number): number {
  if (failures < free) return 0;
  return Math.min(BASE_MS * 2 ** (failures - free), MAX_MS);
}

/** The client address as seen through the proxy, or "local" when there is none. */
export function clientIp(headers: Headers | undefined): string {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers?.get("x-real-ip")?.trim();
  return (forwarded || real || "local").slice(0, 64);
}

/** Milliseconds the caller still has to wait, or 0 when an attempt is allowed now. */
export async function throttleWait(ip: string, email: string): Promise<number> {
  const k = keys(ip, email);
  const rows = await db.loginThrottle.findMany({ where: { key: { in: [k.pair, k.ip] } } });
  const now = Date.now();
  let wait = 0;
  for (const row of rows) {
    const until = row.lockedUntil?.getTime() ?? 0;
    if (until > now) wait = Math.max(wait, until - now);
  }
  return wait;
}

export async function recordFailure(ip: string, email: string): Promise<void> {
  const k = keys(ip, email);
  const now = Date.now();
  for (const [key, free] of [
    [k.pair, PAIR_FREE],
    [k.ip, IP_FREE],
  ] as const) {
    const row = await db.loginThrottle.upsert({
      where: { key },
      create: { key, failures: 1 },
      update: { failures: { increment: 1 } },
    });
    const wait = waitFor(row.failures, free);
    if (wait > 0) {
      await db.loginThrottle.update({ where: { key }, data: { lockedUntil: new Date(now + wait) } });
    }
  }
  // Occasional housekeeping so the table never grows without bound.
  if (Math.random() < 0.05) {
    await db.loginThrottle.deleteMany({ where: { updatedAt: { lt: new Date(now - STALE_MS) } } });
  }
}

/** A successful sign-in clears that person's counter from that address. */
export async function clearFailures(ip: string, email: string): Promise<void> {
  await db.loginThrottle.deleteMany({ where: { key: keys(ip, email).pair } });
}
