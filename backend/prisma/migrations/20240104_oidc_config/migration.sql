ALTER TABLE "Settings" ADD COLUMN "oidcEnabled" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "oidcTenantId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "oidcClientId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "oidcClientSecret" TEXT;
