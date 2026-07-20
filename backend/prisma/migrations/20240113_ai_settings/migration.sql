-- Local LLM used to suggest categories and tidy up transaction descriptions.
-- Nothing leaves the machine: the backend talks to an Ollama instance the user runs.
ALTER TABLE "Settings" ADD COLUMN "aiUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN "aiModel" TEXT;
