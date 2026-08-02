# the-maestro

The author's living archive — novels, poems, songs, plays, and novelettes. Free to
read, always. One person writes; everyone else reads and reacts.

---

## Running it locally

Requires Node 20 or newer. Nothing else — no database to install, no account to create.

```bash
npm install
npm run dev
```

- **Site** → <http://localhost:4200>
- **API** → <http://localhost:4000>

That is enough to browse the site. With no configuration the server starts its own
in-process MongoDB and discards everything on exit — nothing to install, nothing to
sign up for.

### Configuration

Create `server/.env` for anything you want to keep. Every value is optional in
development; the ones marked are required before deploying.

```bash
MONGODB_URI=                 # MongoDB connection string. Omit for the throwaway in-process DB
MONGODB_DB_NAME=the_maestro

JWT_ACCESS_SECRET=           # required in production — 48+ random bytes, different from below
JWT_REFRESH_SECRET=          # required in production
JWT_ACCESS_TTL=3h
JWT_REFRESH_TTL=7d

ADMIN_PORTAL_PATH=           # required in production — the private URL segment the login sits under

CLIENT_ORIGIN=http://localhost:4200
MAX_PDF_BYTES=15728640       # must stay under MongoDB's 16 MB document limit
MAX_IMAGE_BYTES=8388608
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`ADMIN_PORTAL_PATH` must match `adminPortalPath` in
`client/src/environments/environment.production.ts`. The server refuses to start in
production if a secret is missing or the portal path is still a placeholder.

### Signing in as the author

There is **no default account**. Create one:

```bash
npm run admin:create
```

It prompts for a username, password and auth key with the terminal echo disabled, and
stores only scrypt hashes — the plaintext never reaches the database, a file, or a log.
All three are required to sign in.

The login page lives at whatever you set `ADMIN_PORTAL_PATH` to, and is deliberately
unlinked from the rest of the site:

```
http://localhost:4200/<ADMIN_PORTAL_PATH>
```

Signing in lands you in **Preview**: the site exactly as a visitor sees it. A bar
appears at the top with an **Edit** button; clicking it turns on in-place writing
everywhere — the feed composer, per-post edit and pin, the poem and song pages, the
About page, image upload, PDF upload, and publish controls. **Save** and **Discard**
appear beside whatever you are editing.

---

## The sections

| Section | Contents | How it works |
|---|---|---|
| **Blogs** | Status posts from the author | Emote reactions only. No comments, anywhere |
| **Novels** | *Uranium-235* — sixteen books | PDF, read in a paged Kindle-style reader |
| **Poems** | Rains of Love · Others | Editable documents, read on the page |
| **Songs** | KK · Others | Editable documents |
| **Plays** | Three plays | PDF reader |
| **Novelettes** | Five, with *Last Words of a Lost Man* pinned first | PDF reader |
| **About** | The life behind the writing | A single editable page |

---

## Layout

```
├── client/              Angular 22 — the site
├── server/              Express 5 + MongoDB — the API
├── claude.md            The brief. Source of truth for requirements   (local only)
└── .claude/                                                           (local only)
    ├── API_KEYS.md      Every key and env var, and how to get each one
    ├── MEMORY.md        Architecture decisions, reasoning, change log
    ├── TOOLING.md       Dependencies, tooling, maintenance
    └── SESSION_PROMPTS.md   Running list of review notes
```

`claude.md` and everything under `.claude/` are **gitignored on purpose** — they are
working notes for whoever builds the project, not part of what ships. They are not in
this repository; look for them in the working copy.

Read `.claude/MEMORY.md` before changing anything structural. It records *why* each
decision was made, which is the part that is expensive to rediscover.

---

## Commands

```bash
npm run dev            # both servers together
npm run dev:server     # API only
npm run dev:client     # site only
npm run build          # production bundle
npm run seed           # upsert the catalogue into a configured database
npm run admin:create   # provision the author, interactively (production)
```

---

## Status

v1.3.0 — fourth review round applied, running against MongoDB Atlas, not yet deployed.
Review notes are tracked in `.claude/SESSION_PROMPTS.md`; known gaps are listed at the
end of `.claude/MEMORY.md`. Both are local-only — see Layout above.
