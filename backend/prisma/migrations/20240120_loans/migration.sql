-- Money lent to a person, with a ledger of repayments. The outstanding balance
-- is derived (principal minus the sum of payments), so removing a mistaken
-- repayment recomputes cleanly. Standalone from account balances.
CREATE TABLE "Loan" (
  "id"          TEXT     NOT NULL PRIMARY KEY,
  "person"      TEXT     NOT NULL,
  "description" TEXT,
  "principal"   DECIMAL  NOT NULL,
  "currency"    TEXT     NOT NULL DEFAULT 'EUR',
  "date"        DATETIME NOT NULL,
  "dueDate"     DATETIME,
  "notes"       TEXT,
  "color"       TEXT     NOT NULL DEFAULT '#6366f1',
  "archived"    BOOLEAN  NOT NULL DEFAULT false,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "LoanPayment" (
  "id"        TEXT     NOT NULL PRIMARY KEY,
  "loanId"    TEXT     NOT NULL,
  "amount"    DECIMAL  NOT NULL,
  "date"      DATETIME NOT NULL,
  "notes"     TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LoanPayment_loanId_idx" ON "LoanPayment"("loanId");
