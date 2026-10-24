-- Run once in the Cloudflare D1 SQL console for the site's database.
ALTER TABLE stories ADD COLUMN update_title TEXT;
