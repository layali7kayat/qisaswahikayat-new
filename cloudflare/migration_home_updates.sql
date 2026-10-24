-- Homepage tabs and latest updates migration
-- Adds support for portrait update images, planned story parts,
-- story status, and sorting newly published parts.
-- Existing stories and parts are preserved.

ALTER TABLE stories ADD COLUMN update_image_url TEXT;

ALTER TABLE stories ADD COLUMN planned_parts_count INTEGER;

ALTER TABLE stories ADD COLUMN story_status TEXT NOT NULL DEFAULT 'ongoing';

ALTER TABLE story_parts ADD COLUMN update_image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_story_parts_created
ON story_parts (is_published, created_at DESC);
