import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "./lib/db";
import { clearFailures, clientIp, recordFailure, throttleWait } from "./lib/login-throttle";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

// Compared against when the email is unknown, so a wrong email and a wrong password take similar time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export class RateLimitError extends CredentialsSignin {
  code = "rate_limit_exceeded";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = clientIp(request?.headers);

        // Checked before bcrypt, so a flood of guesses cannot exhaust the CPU either.
        if ((await throttleWait(ip, email)) > 0) throw new RateLimitError();

        const user = await db.user.findUnique({ where: { email } });
        const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !user.active || !ok) {
          await recordFailure(ip, email);
          return null;
        }

        await clearFailures(ip, email);
        return { id: String(user.id), name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
});
