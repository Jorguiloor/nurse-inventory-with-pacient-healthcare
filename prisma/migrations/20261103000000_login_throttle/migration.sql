-- Shared, persistent sign-in throttling (replaces the in-memory counter).
CREATE TABLE "login_throttle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_throttle_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "login_throttle_updatedAt_idx" ON "login_throttle"("updatedAt");
