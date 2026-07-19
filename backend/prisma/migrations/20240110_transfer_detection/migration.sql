-- Store the counterparty IBAN so transfers between known accounts can be detected
ALTER TABLE "Transaction" ADD COLUMN "counterpartyIban" TEXT;

-- How imports handle transfers between two known accounts: off | auto | confirm
ALTER TABLE "Settings" ADD COLUMN "transferDetection" TEXT NOT NULL DEFAULT 'confirm';

-- Normalise IBANs already stored with spaces or lowercase so they compare cleanly
UPDATE "Account" SET "iban" = UPPER(REPLACE(REPLACE("iban", ' ', ''), '-', '')) WHERE "iban" IS NOT NULL;
