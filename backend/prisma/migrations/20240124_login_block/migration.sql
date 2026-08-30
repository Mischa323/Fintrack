-- Brute-force protection: block an IP after too many failed logins. Configurable
-- in Settings; the per-IP counters live in LoginAttempt.
ALTER TABLE "Settings" ADD COLUMN "loginBlockEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ADD COLUMN "loginMaxAttempts" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Settings" ADD COLUMN "loginBlockMinutes" INTEGER NOT NULL DEFAULT 15;

CREATE TABLE "LoginAttempt" (
  "ip"           TEXT     NOT NULL PRIMARY KEY,
  "failedCount"  INTEGER  NOT NULL DEFAULT 0,
  "windowStart"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" DATETIME,
  "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
