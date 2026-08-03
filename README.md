# the-maestro

The website of an author — novels, novelettes, plays, poems and songs, free to read.

Live at **https://www.themaestro.co.in/**

## Pages

| | |
|---|---|
| Blogs | https://www.themaestro.co.in/ |
| Novels | https://www.themaestro.co.in/novels |
| Novelettes | https://www.themaestro.co.in/novelettes |
| Plays | https://www.themaestro.co.in/plays |
| Poems | https://www.themaestro.co.in/poems |
| Songs | https://www.themaestro.co.in/songs |
| About the Author | https://www.themaestro.co.in/about |

Each section page lists its works; opening one appends its slug to the section path —
`/novels/uranium-235-gates-of-infinity`, `/poems/the-first-second`, and so on. Novels,
novelettes and plays open in the PDF reader; poems and songs open as documents.

Everything above is public and read-only. Editing lives behind an admin route that is
never linked from the site and does not appear in this file.

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

## Local

```bash
npm install
npm run dev     # site on :4200, API on :4000
```

With no configuration the server starts an in-process MongoDB and discards it on exit.

## Hosting

The client builds to a static bundle on any static host; the API is an ordinary Node
server, with Atlas and R2 behind it. The two deploy independently — `vercel.json` and
`render.yaml` describe each side, and their settings are configured on the host rather
than in this repository.
