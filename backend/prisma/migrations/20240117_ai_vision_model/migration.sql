-- Vision models are a poor fit for the text tasks: qwen3-vl reasons until it
-- exhausts its token budget on a long document and never answers, while a plain
-- text model extracts the same payslip correctly in seconds. So images get their
-- own model and everything else keeps using aiModel.
ALTER TABLE "Settings" ADD COLUMN "aiVisionModel" TEXT;
