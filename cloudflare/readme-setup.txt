Cloudflare Worker bindings:
- D1 binding variable: DB -> qisas-night-db
- R2 binding variable: MEDIA -> qisas-night-media
- Worker secrets: ADMIN_EMAIL -> your administrator email; ADMIN_PASSWORD -> your strong administrator password. Add both in Cloudflare Worker Settings > Variables and Secrets. Use the same email/password in the admin login form.

The Worker code in worker.js is adapted to the D1 schema in schema.sql. The current database was already created with the matching categories/stories columns. Running schema.sql again is safe: it creates missing tables/indexes and inserts the six categories if they are absent. It does not create sample stories.

After pasting worker.js into the qisas-night-api editor, click Deploy. The website config.js is already set to this Worker URL:
https://qisas-night-api.layali-7kayat-719.workers.dev

Before admin sign-in works, add both ADMIN_EMAIL and ADMIN_PASSWORD as Cloudflare Worker secrets. Never put these values in config.js or frontend files. Admin requests use these credentials for authorization.
