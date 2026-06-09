CREATE TABLE "Goal" (
  "id"           TEXT     NOT NULL PRIMARY KEY,
  "name"         TEXT     NOT NULL,
  "description"  TEXT,
  "targetAmount" DECIMAL  NOT NULL,
  "savedAmount"  DECIMAL  NOT NULL DEFAULT 0,
  "accountId"    TEXT     REFERENCES "Account"("id") ON DELETE SET NULL,
  "targetDate"   DATETIME,
  "color"        TEXT     NOT NULL DEFAULT '#6366f1',
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
