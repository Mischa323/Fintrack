-- Temporary, revocable, read-only key for the /diagnostics API. Only the
-- SHA-256 hash is stored; the plaintext is shown once when it is created.
ALTER TABLE "Settings" ADD COLUMN "diagnosticsKeyHash" TEXT;
ALTER TABLE "Settings" ADD COLUMN "diagnosticsKeyExpiresAt" DATETIME;
