-- Homepage tabs, latest update portrait thumbnails, and planned story parts.
-- Run this migration once in the existing Cloudflare D1 database.
-- Existing stories and parts are preserved; new columns are nullable/defaulted.
ALTER TABLE stories ADD COLUMN update_image_url TEXT;
ALTER TABLE stories ADD COLUMN planned_parts_count INTEGER;
ALTER TABLE stories ADD COLUMN story_status TEXT NOT NULL DEFAULT 'ongoing';
ALTER TABLE story_parts ADD COLUMN update_image_url TEXT;
CREATE INDEX IF NOT EXISTS idx_story_parts_created ON story_parts(is_published, created_at DESC);
