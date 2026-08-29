-- User-controlled ordering and grouping of accounts on the Accounts page.
-- sortOrder is a global display position; groupName gathers accounts under a
-- shared heading (null = ungrouped). Existing rows keep their created order via
-- the 0 default plus the createdAt tiebreak in the query.
ALTER TABLE "Account" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "groupName" TEXT;
