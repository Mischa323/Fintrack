CREATE TABLE "Attachment" (
  "id"            TEXT     NOT NULL PRIMARY KEY,
  "transactionId" TEXT     NOT NULL,
  "filename"      TEXT     NOT NULL,
  "mimeType"      TEXT     NOT NULL,
  "size"          INTEGER  NOT NULL,
  "storagePath"   TEXT     NOT NULL,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attachment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Attachment_transactionId_idx" ON "Attachment"("transactionId");
