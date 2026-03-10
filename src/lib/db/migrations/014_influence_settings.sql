-- Settings column for platform-specific post config (Reddit subreddit, X thread settings, etc.)
ALTER TABLE influence_posts ADD COLUMN settings TEXT;
