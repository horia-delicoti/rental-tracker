# Rental Tracker

[![App](https://github.com/horia-delicoti/rental-tracker/actions/workflows/app.yml/badge.svg)](https://github.com/horia-delicoti/rental-tracker/actions/workflows/app.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

🏠 **A self-hosted ledger for rental property income** — rent received, expenses by category,
profit per property and per year, and a tax estimate per owner. One Node process, no runtime
dependencies, data as plain JSON.

## Why?

Rental income arrives monthly, expenses arrive whenever they feel like it, and the only time anyone
adds it up is the week the tax return is due — from a bank statement that does not know which flat
a payment was for. This keeps one honest ledger per property and answers the three questions that
matter: *what came in this year*, *what did it cost to hold*, and *what will each owner owe*.

It is built for one household, self-hosted, with no account, no signup and no third-party service
holding the numbers.

## Features

- **As many rentals as you have** — add, rename and delete properties, each with its own colour,
  Airbnb/dashboard/internet links and a note; a combined view plus a page per rental
- **One dated ledger per rental** — income and expenses in a single list, grouped by day, told
  apart by sign, colour and icon, with chips to read one side and a window to edit or delete a line
- **Lines paid in another currency** — record what actually left your account, in the currency it
  left in, with the rate frozen onto the line; totals read the base figure, the screen shows what
  you paid
- **April–March fiscal years** — a payment's date decides its year, so a March payment lands in the
  year that started the previous April, where the tax return expects it
- **As many owners as you have** — add, rename and remove the people the profit is divided between,
  each with their own share, colour and tax percentage per year; a fresh install has none and asks
  for the first, so no household's names are baked into the source
- **A tax-percentage estimator** — optional helper that fills the UK marginal bands bottom-up and
  offers the resulting effective rate; the stored value is still a single flat percentage
- **Expense categories** — one closed list drives every dropdown, icon and colour, with a
  breakdown bar per category
- **Run-rate projection** — what the current year lands at if the rest of it looks like the part
  already recorded
- **Per-year and lifetime analytics** — monthly cash flow with a running-profit line, a property
  comparison, income/expense/profit per year, tax per year, and lifetime totals
- **Strict money parsing** — `1,200` typed with a comma is refused, never silently read as `0`
- **Currencies & rates** — add any currency your browser knows, with rates stored server-side and
  filled from the ECB's published figures on a button press; the app's only outbound request
- **View in any currency** — a header dropdown redraws every figure, chart and axis at the stored
  rate, while the ledger stays recorded in its base currency and says so on screen
- **Light, dark or auto** — one button cycles them; dark lifts the same ledger-paper hues rather
  than replacing them, and is resolved before the page paints
- **Backups built in** — a rolling snapshot before every change, in-app export and import, and a
  restore that is itself undoable
- **Knows which build it is** — the version is stamped into the page as it is served, so a cached
  copy can tell you it is out of date instead of quietly being three releases behind

## Tech stack

Deliberately small. No framework, no build step, no runtime dependencies.

- **Backend** — Node 24, built-in modules only (`node:http`, `node:fs`). One file, `server.js`.
- **Frontend** — one `index.html`: vanilla JS, no bundler. Chart.js is vendored, not loaded from a
  CDN, so the app renders with the internet down.
- **Storage** — plain JSON files on a mounted volume. No database.
- **Packaging** — a `node:24-alpine` image published to GHCR.

## Quick start

```bash
cd app.web
node server.js        # → http://localhost:8099
```

Needs Node 18+. Creates a local `data/` store, which is git-ignored.

With Docker:

```bash
docker run -d --name rental-tracker \
  -p 127.0.0.1:8099:8099 \
  -v /path/to/data:/data \
  -e TZ=Europe/London \
  ghcr.io/horia-delicoti/rental-tracker:1
```

The app has **no authentication of its own**. It is designed to sit behind a reverse proxy and an
auth layer, bound to loopback. See the documentation before exposing it.

> **Nothing personal is baked in.** Rentals, currencies and the people the profit is divided
> between are all set up in the app; a fresh install ships with none of them and asks for the first.

## Development

```bash
npm install          # dev tooling only — the app ships zero runtime dependencies
npm run hooks        # enable the pre-commit gate (once per clone)
npm run verify       # syntax + lint + self check + tests, about a second
```

| Command | What it does |
| --- | --- |
| `npm run syntax` | `node --check` on the server and the self check |
| `npm run lint` | ESLint, including the inline `<script>` blocks inside `index.html` |
| `npm run selfcheck` | the invariant checks — the ones that guard against a wrong *number* |
| `npm test` | boots the real server on a throwaway data dir and drives it over HTTP |

`npm run hooks` points git at `.githooks/`, so `npm run verify` runs before every commit. Bypass it
deliberately with `git commit --no-verify` on a WIP branch.

## Builds and releases

| | |
| --- | --- |
| Build status | [App workflow](https://github.com/horia-delicoti/rental-tracker/actions/workflows/app.yml) |
| Published images | [ghcr.io/horia-delicoti/rental-tracker](https://github.com/horia-delicoti/rental-tracker/pkgs/container/rental-tracker) |
| Releases | [Tags](https://github.com/horia-delicoti/rental-tracker/tags) |

Every push runs the checks and builds the image without publishing it. Pushing a `v*` tag publishes
a multi-arch image (`linux/amd64`, `linux/arm64`) to GHCR, tagged `1.2.3`, `1.2` and `1`. There is
deliberately no `latest`: deployments pin an exact version, so an update is a decision and a
rollback is the same decision in reverse.

## Documentation

Full docs live in [`website/docs/`](website/docs/) — recording income and expenses, how fiscal
years work, the tax split, the API, and backups.

## Repo layout

| | |
| --- | --- |
| `app.web/` | the application — this is what becomes the container image |
| `website/` | documentation and project site |
| `assets/` | screenshots |

## Privacy

The store is a precise record of what two properties earn and what their owners pay in tax. Keep it
behind an auth layer, keep the data directory out of any public repo, and treat an exported
`rental-data.json` the way you would treat a bank statement. Screenshots for the docs must use
invented figures.

## License

MIT — see [LICENSE](LICENSE).
