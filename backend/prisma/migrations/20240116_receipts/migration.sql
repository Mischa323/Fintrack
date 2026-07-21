-- A photographed receipt, invoice or payslip. The image is read by a local
-- vision model; what it extracted is stored so a match can be reviewed and
-- re-checked later without asking the model again.
CREATE TABLE "Receipt" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "filename"      TEXT NOT NULL,          -- original name, for display
  "storedName"    TEXT NOT NULL,          -- name on disk under uploads/receipts
  "mimeType"      TEXT NOT NULL,
  "size"          INTEGER NOT NULL,
  -- What the model read off the image; all optional since a blurry photo may
  -- yield only some of it.
  "merchant"      TEXT,
  "date"          DATETIME,
  "amount"        DECIMAL,
  "currency"      TEXT,
  "kind"          TEXT,                   -- RECEIPT | INVOICE | PAYSLIP | UNKNOWN
  "rawText"       TEXT,                   -- model's own summary, kept for review
  -- Where it ended up
  "transactionId" TEXT,
  "status"        TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | MATCHED | CREATED | UNMATCHED
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL,
  CONSTRAINT "Receipt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Receipt_transactionId_idx" ON "Receipt"("transactionId");
CREATE INDEX "Receipt_status_idx" ON "Receipt"("status");
