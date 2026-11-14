import { ApiError } from "./http";

// A small per-user limiter for expensive endpoints (Excel exports build the whole file in
// memory). In-process is enough here: the caller is already signed in, so this only guards
// against one account hammering the server, not against anonymous floods.
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    const wait = Math.ceil((windowMs - (now - recent[0])) / 1000);
    throw new ApiError(`Demasiadas exportaciones seguidas. Inténtalo de nuevo en ${wait} s.`, 429, "RATE_LIMITED");
  }
  recent.push(now);
  hits.set(key, recent);
}

/** Exports: 10 per minute per user. */
export const limitExport = (userId: number) => rateLimit(`export:${userId}`, 10, 60_000);
