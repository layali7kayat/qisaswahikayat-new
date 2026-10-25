-- Enable multiple categories per story while preserving each story's existing category.
-- Run this once on the existing Cloudflare D1 database before deploying the updated Worker.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS story_categories (
  story_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (story_id, category_id),
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO story_categories (story_id, category_id)
SELECT id, category_id FROM stories WHERE category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_story_categories_category
ON story_categories(category_id, story_id);
