-- Anonymous comments, replies and likes for Qisas Wa Hikayat.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 story_id INTEGER NOT NULL,
 parent_id INTEGER,
 visitor_token TEXT NOT NULL,
 display_name TEXT NOT NULL DEFAULT 'زائر',
 avatar TEXT NOT NULL DEFAULT 'avatar-girl-1',
 content TEXT NOT NULL,
 likes_count INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE,
 FOREIGN KEY(parent_id) REFERENCES comments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_story_created ON comments(story_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE TABLE IF NOT EXISTS comment_likes (
 comment_id INTEGER NOT NULL,
 visitor_token TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(comment_id,visitor_token),
 FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);
