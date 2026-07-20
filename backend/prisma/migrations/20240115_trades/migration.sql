-- A buy or sell of a holding. The holding's quantity and average cost are
-- derived by replaying these in date order, so a mistaken entry can be removed
-- and the position recomputes cleanly.
CREATE TABLE "Trade" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "holdingId" TEXT NOT NULL,
  "date"      DATETIME NOT NULL,
  "kind"      TEXT NOT NULL,           -- BUY | SELL
  "quantity"  DECIMAL NOT NULL,
  "price"     DECIMAL,                 -- per share, in the holding's currency
  "opening"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Trade_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Trade_holdingId_idx" ON "Trade"("holdingId");
