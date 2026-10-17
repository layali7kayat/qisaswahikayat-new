-- Schema compatible with the qisas-night-db database created for this project.
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
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category_id);
CREATE INDEX IF NOT EXISTS idx_stories_published ON stories(is_published, created_at);
CREATE INDEX IF NOT EXISTS idx_stories_views ON stories(views DESC);

INSERT OR IGNORE INTO categories (name, slug, sort_order, is_active) VALUES
 ('قصص فانتازيا', 'fantasy', 1, 1),
 ('الزواج الإجباري', 'forced-marriage', 2, 1),
 ('قصص تاريخية', 'history', 3, 1),
 ('قصص أطفال', 'children', 4, 1),
 ('قصص رومانسية', 'romance', 5, 1),
 ('قصص رعب', 'horror', 6, 1),
 ('ألف ليلة وليلة', 'alf-layla', 7, 1);
