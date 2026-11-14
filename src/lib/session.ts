import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "./db";
import type { Role } from "./stock";

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

/**
 * For server components and server actions: the signed-in user, or a redirect to /login.
 *
 * API routes should not use this. They want a 401 in JSON, which is what
 * `context()` in src/server/context.ts gives them.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) redirect("/login");

  const dbUser = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!dbUser || !dbUser.active) redirect("/login");

  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role as Role,
  };
}
