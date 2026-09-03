# Deploying to Cloudflare

The site is static files plus Pages Functions, so one project serves the AR page,
the admin dashboard, the API, model storage and analytics on a single origin.
No CORS setup, one deploy.

You will run every command yourself — the password and session secret are typed
straight into Cloudflare and are never stored in this repository.

## 1. Install Wrangler and sign in

```bash
npm install -g wrangler
wrangler login
```

## 2. Create the analytics database

```bash
wrangler d1 create ar-demo-analytics
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`. Then create the tables:

```bash
wrangler d1 execute ar-demo-analytics --remote --file=./schema.sql
```

## 3. Create the model bucket

```bash
wrangler r2 bucket create ar-demo-models
```

## 4. Create the Pages project

```bash
wrangler pages project create ar-demo
```

## 5. Set the two secrets

Pick a strong admin password and an unrelated random session secret. Each command
prompts you to paste the value; it is stored encrypted at Cloudflare.

```bash
wrangler pages secret put ADMIN_PASSWORD --project-name ar-demo
```

```bash
wrangler pages secret put SESSION_SECRET --project-name ar-demo
```

For the session secret, any long random string works — for example the output of:

```bash
openssl rand -base64 32
```

`ADMIN_PASSWORD` is what you type on the admin page. `SESSION_SECRET` signs the
login cookie; changing it later just logs you out.

## 6. Deploy

```bash
wrangler pages deploy .
```

Wrangler prints the live URL, normally `https://ar-demo.pages.dev`.

## 7. Check it works

- `https://ar-demo.pages.dev/` — the landing page
- `https://ar-demo.pages.dev/ar.html` — the AR camera
- `https://ar-demo.pages.dev/admin.html` — sign in with `ADMIN_PASSWORD`
- `https://ar-demo.pages.dev/api/active-model` — should return JSON

## Redeploying

```bash
wrangler pages deploy .
```

**Bump `CACHE_VERSION` in `sw.js` whenever you change `ar.html`, `index.html` or
the bundled model.** The service worker serves cached assets, so without a new
version returning visitors keep the old files. This is the single most common
cause of "I deployed but nothing changed".

## Uploading models from Meshy

Meshy exports are usually far too heavy for phones. Shrink one before uploading:

```bash
python3 tools/optimize-glb.py meshy-export.glb ready-for-ar.glb --max-mb 3
```

The script quantizes vertex data and recompresses textures without removing a
single triangle. Upload the result on the admin page and tick "Make this the live
model"; the AR page measures each uploaded model and scales it to the marker
automatically, so Meshy's arbitrary export scale does not matter.

If a model is still too large afterwards, it has too many triangles for a phone —
reduce the polygon count in Meshy's export settings and run the script again.

## What the analytics record

Sessions, camera starts, marker locks, model loads, model errors, photos taken and
photos saved, plus a coarse device class (mobile/tablet/desktop) and the
Cloudflare country code.

No IP addresses, no user agent strings, no cookies, no cross-site identifiers. The
session id is random, generated in the browser, and discarded when the tab closes.

## Notes

- GitHub Pages cannot host any of this. It serves static files only — no uploads,
  no database. The repo can stay as your source of truth, but the running site
  needs to be Cloudflare.
- `.assetsignore` keeps `wrangler.toml`, `schema.sql` and the tooling out of the
  public deploy. Neither file contains a credential (a D1 `database_id` is an
  identifier, not a secret), but there is no reason to serve them.
- The admin page is protected by one shared password with an 8-hour signed cookie.
  If you later want per-person logins, that means adding user accounts.
