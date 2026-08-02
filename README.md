# the-maestro

## Stack

| | |
|---|---|
| Frontend | Angular 22 — standalone components, signals, zoneless |
| Backend | Express 5 on Node 20+ |
| Database | MongoDB (Atlas) via Mongoose 9 |
| Object storage | Cloudflare R2 — uploaded PDFs and images |
| Editor | TipTap 3 |
| PDF reader | ngx-extended-pdf-viewer (pdf.js) |
| Styling | SCSS with CSS custom properties |

```
client/    Angular — the site
server/    Express + MongoDB — the API
```

## Hosting

The client builds to a static bundle; the API is an ordinary Node server. They deploy
independently, with Atlas and R2 behind them.

**Client** — any static host. Build from `client/`:

```bash
API_BASE=https://api.example.com/api \
ADMIN_PORTAL_PATH=your-private-segment \
npm run build          # output: dist/client/browser
```

Those two values are injected at build time by `client/scripts/write-env.mjs`; unset,
the build falls back to placeholders the server will not accept. The host must also
rewrite unknown paths to `index.html` — `client/public/_redirects` does this on
Netlify and Cloudflare Pages, and `vercel.json` does it on Vercel.

On Vercel the repository root is the project root: `vercel.json` pins the build command
and the output directory (`client/dist/client/browser` — note the `browser/` level the
Angular application builder adds, which is not Vercel's `dist` default). `API_BASE` and
`ADMIN_PORTAL_PATH` go in the project's environment variables; without them the bundle
ships the placeholder admin path and the portal route will not open.

**API** — any Node host. Environment:

```bash
NODE_ENV=production
MONGODB_URI=                 # required
MONGODB_DB_NAME=the_maestro
JWT_ACCESS_SECRET=           # required, 48+ random bytes
JWT_REFRESH_SECRET=          # required, different from the above
JWT_ACCESS_TTL=3h
JWT_REFRESH_TTL=7d
ADMIN_PORTAL_PATH=           # required, must match the client build
CLIENT_ORIGIN=               # the site's origins, comma-separated, for CORS
COOKIE_SAMESITE=lax          # 'none' when the API is on a different site than the client
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=          # optional; without it files are served via signed URLs
MAX_PDF_BYTES=15728640
MAX_IMAGE_BYTES=8388608
```

The server refuses to start in production if a secret is missing, if `MONGODB_URI` is
absent, or if `ADMIN_PORTAL_PATH` is still the development default.

`render.yaml` deploys it to Render's free plan: point a new Blueprint at this
repository and fill in the values it prompts for. That plan sleeps after about fifteen
minutes idle, so the first request after a quiet spell waits ~50s for a cold start.

The refresh cookie is the one thing the split hosting complicates. `SameSite=lax` is
sent only between same-site origins, and `www.themaestro.co.in` → `*.onrender.com` is
not one: without `COOKIE_SAMESITE=none` the admin login succeeds and the session is
gone on the next request. Attaching a custom domain such as `api.themaestro.co.in` to
the Render service makes the two same-site again, at which point `lax` is both
sufficient and stricter — prefer it once the domain is in place.

Uploads go to R2 when it is configured and to MongoDB when it is not, so the project
runs with no storage account at all.

**Bucket CORS** — the browser fetches files from R2 directly, so the bucket needs:

```json
[{
  "AllowedOrigins": ["https://your-domain.example"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
  "MaxAgeSeconds": 3600
}]
```

Without `Content-Range` and `Accept-Ranges` exposed, the browser cannot use byte
ranges and PDFs download in full instead of streaming.

## Local

```bash
npm install
npm run dev     # site on :4200, API on :4000
```

With no configuration the server starts an in-process MongoDB and discards it on exit.
