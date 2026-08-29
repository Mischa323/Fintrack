-- Manual value for investment accounts holding fund/pension products with no
-- tradeable ticker (Brand New Day, a pension pot). recalculateAccountValue adds
-- it to any priced holdings, so a holding-less account is worth this number.
ALTER TABLE "Account" ADD COLUMN "manualValue" DECIMAL;

-- Forward-only value history for those accounts (prices can't reconstruct it):
-- one snapshot per account per day, updated as the value is entered.
CREATE TABLE "AccountValueSnapshot" (
  "id"        TEXT     NOT NULL PRIMARY KEY,
  "accountId" TEXT     NOT NULL,
  "date"      DATETIME NOT NULL,
  "value"     DECIMAL  NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountValueSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AccountValueSnapshot_accountId_date_key" ON "AccountValueSnapshot"("accountId", "date");
CREATE INDEX "AccountValueSnapshot_accountId_idx" ON "AccountValueSnapshot"("accountId");
