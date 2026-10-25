-- Migration: Story parts index
-- Compatible with the existing story_parts table.
-- Uses part_number, not sort_order.
-- Safe to run more than once.

CREATE INDEX IF NOT EXISTS idx_story_parts_story_number
ON story_parts(story_id, part_number);
