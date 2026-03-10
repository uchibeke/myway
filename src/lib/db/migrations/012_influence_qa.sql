-- QA scoring columns for influence posts
ALTER TABLE influence_posts ADD COLUMN qa_score INTEGER;
ALTER TABLE influence_posts ADD COLUMN qa_report TEXT;
ALTER TABLE influence_posts ADD COLUMN qa_version INTEGER DEFAULT 0;
ALTER TABLE influence_posts ADD COLUMN original_content TEXT;
