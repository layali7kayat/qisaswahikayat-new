-- Qisas Wa Hikayat
-- Cloudflare D1 schema
-- Story parts use part_number, not sort_order.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    audio_url TEXT NOT NULL,
    image_url TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    wide_image_url TEXT,
    status TEXT NOT NULL DEFAULT 'ongoing' CHECK(status IN ('ongoing','completed')),
    character_one_name TEXT NOT NULL DEFAULT 'البطلة',
    character_two_name TEXT NOT NULL DEFAULT 'البطل',
    character_three_name TEXT NOT NULL DEFAULT 'شخصية محورية',
    character_one_image_url TEXT,
    character_two_image_url TEXT,
    character_three_image_url TEXT,
    FOREIGN KEY (category_id)
        REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stories_category
ON stories(category_id);

CREATE INDEX IF NOT EXISTS idx_stories_published
ON stories(is_published, created_at);

CREATE INDEX IF NOT EXISTS idx_stories_views
ON stories(views DESC);

CREATE TABLE IF NOT EXISTS story_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL,
    part_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    audio_url TEXT NOT NULL,
    image_url TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (story_id)
        REFERENCES stories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_story_parts_story_number
ON story_parts(story_id, part_number);
