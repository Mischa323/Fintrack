-- Attachment tags (AI-generated, JSON-encoded array)
ALTER TABLE "Attachment" ADD COLUMN "tags" TEXT;

-- AI tagging configuration on the Settings singleton
ALTER TABLE "Settings" ADD COLUMN "aiTaggingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "aiProvider" TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE "Settings" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "Settings" ADD COLUMN "anthropicApiKey" TEXT;
ALTER TABLE "Settings" ADD COLUMN "odysseusBaseUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN "odysseusApiKey" TEXT;
