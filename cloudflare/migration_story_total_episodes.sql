-- Add the planned total episode count to each story.
-- Run this migration ONCE on the existing Cloudflare D1 database before deploying the updated Worker.
-- Existing stories stay at 0 until their planned total is entered in the admin panel; this avoids
-- incorrectly marking the currently newest published episode as the final episode.
ALTER TABLE stories ADD COLUMN total_episodes INTEGER NOT NULL DEFAULT 0;
