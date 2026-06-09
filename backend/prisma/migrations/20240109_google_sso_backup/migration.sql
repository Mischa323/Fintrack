-- Add googleOidcSubject to User
ALTER TABLE "User" ADD COLUMN "googleOidcSubject" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleOidcSubject_key" ON "User"("googleOidcSubject");

-- Add Google SSO config to Settings
ALTER TABLE "Settings" ADD COLUMN "googleOidcEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "googleClientId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "googleClientSecret" TEXT;

-- Create BackupConfig table
CREATE TABLE "BackupConfig" (
  "id"         TEXT     NOT NULL PRIMARY KEY,
  "label"      TEXT     NOT NULL,
  "type"       TEXT     NOT NULL,
  "enabled"    BOOLEAN  NOT NULL DEFAULT true,
  "configJson" TEXT     NOT NULL DEFAULT '{}',
  "schedule"   TEXT     NOT NULL DEFAULT '0 2 * * *',
  "lastRunAt"  DATETIME,
  "lastStatus" TEXT,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
