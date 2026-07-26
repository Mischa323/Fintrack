-- Optional loss alert: when a holding's unrealised loss versus its average cost
-- reaches this many percent, it is flagged. The user sets the percentage.
ALTER TABLE "Holding" ADD COLUMN "lossAlertPercent" DECIMAL;
