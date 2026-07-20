-- Optional hint about the language(s) the transactions are usually in. Empty
-- means the model treats every batch as possibly multilingual.
ALTER TABLE "Settings" ADD COLUMN "aiLanguage" TEXT;
