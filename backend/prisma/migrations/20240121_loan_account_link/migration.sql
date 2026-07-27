-- Optional link from a loan to a real account. When set, lending is booked as an
-- EXPENSE and each repayment as an INCOME on that account, so its balance stays
-- in step. The transaction ids let those bookings be reversed when a loan or
-- repayment is edited or removed.
ALTER TABLE "Loan" ADD COLUMN "accountId" TEXT REFERENCES "Account"("id") ON DELETE SET NULL;
ALTER TABLE "Loan" ADD COLUMN "lendTransactionId" TEXT;
ALTER TABLE "LoanPayment" ADD COLUMN "transactionId" TEXT;
