-- The balance an account already had before its first recorded transaction.
-- Deriving a balance by summing transactions only works if that history is
-- complete; an imported statement never is, so the remainder lives here.
ALTER TABLE "Account" ADD COLUMN "openingBalance" DECIMAL NOT NULL DEFAULT 0;
