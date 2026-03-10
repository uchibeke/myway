-- Add source metadata to pipeline_runs so the executor knows which URL to scrape.
ALTER TABLE pipeline_runs ADD COLUMN source_url TEXT;
ALTER TABLE pipeline_runs ADD COLUMN discovery_query TEXT;
ALTER TABLE pipeline_runs ADD COLUMN source_name TEXT;
