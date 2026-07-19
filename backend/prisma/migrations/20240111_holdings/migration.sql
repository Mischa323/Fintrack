-- Investment positions. An investment account's balance is derived from these
-- (quantity x last price, converted to the account currency) instead of typed in.
CREATE TABLE "Holding" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "accountId"   TEXT NOT NULL,
  "symbol"      TEXT NOT NULL,
  "name"        TEXT,
  "quantity"    DECIMAL NOT NULL,
  "avgCost"     DECIMAL,
  "currency"    TEXT NOT NULL DEFAULT 'USD',
  "lastPrice"   DECIMAL,
  "lastPriceAt" DATETIME,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   DATETIME NOT NULL,
  CONSTRAINT "Holding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Holding_accountId_symbol_key" ON "Holding"("accountId", "symbol");
