-- Migration: Add story parts to existing D1 database
-- Safe to run on an existing database

CREATE TABLE IF NOT EXISTS story_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    audio_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (story_id)
        REFERENCES stories(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_story_parts_story_order
ON story_parts(story_id, sort_order, id);
