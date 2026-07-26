-- The date the opening balance is true as of. Set balance anchors the figure to
-- this day: transactions on or before it are already included in it, so
-- backfilling older history never moves the current balance; only later
-- transactions adjust it. NULL keeps the old behaviour (count every transaction).
ALTER TABLE "Account" ADD COLUMN "openingBalanceDate" DATETIME;
