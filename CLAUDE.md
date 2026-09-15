# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A self-hosted rental income/expense/tax ledger. One Node process, **no runtime dependencies**, data
stored as plain JSON. It is a personal financial ledger — correctness of the numbers matters more
than features, and a wrong number is worse than an error, because the user would act on it.

## Repo layout

| Path | What it is |
| --- | --- |
| `app.web/server.js` | the entire backend (~350 lines, Node built-ins only) |
| `app.web/public/index.html` | the entire frontend (~1200 lines, vanilla JS, no bundler) |
| `app.web/selfcheck.js` | invariant checks — **not** deployed, run before every commit |
| `app.web/Dockerfile` | the image; build context is `app.web/` |
| `app.web/test/` | smoke tests — boot the real server, drive it over HTTP |
| `website/docs/` | user documentation |
| `assets/` | screenshots |
| `plans/` | migration and design plans — read before structural work (git-ignored, local only) |
| `eslint.config.mjs`, `package.json` | dev tooling at the root; `app.web/package.json` stays the clean app manifest that ships in the image |

Deployment lives in a **separate private Ansible repo**, not here. This repo publishes a versioned
image; the infra repo pins a version and runs it.

## Commands

```bash
npm install           # dev tooling only — devDependencies never reach the image
npm run hooks         # point git at .githooks/ (once per clone)

npm run verify        # syntax + lint + selfcheck + tests — and what the hook runs
npm run selfcheck     # invariant checks — no network, does not touch data
npm test              # boots the real server on a temp data dir, drives it over HTTP

cd app.web && node server.js    # run locally → http://localhost:8099
```

There is no build step and no test framework beyond Node's built-in runner.

Two layers of checking, covering different things:

- `selfcheck.js` reads the *source* and asserts invariants. It never starts the app.
- `app.web/test/` starts the app and drives the API. It knows nothing about the source.

## Invariants — do not break these

`selfcheck.js` guards the failures that are **silent**: they produce a wrong number rather than an
error. Run it after any edit to `server.js` or `index.html`.

1. **Rentals are data, not code.** The store starts empty and the page has no list of its own —
   `apts()` reads `DATA.apartments`. A record must name a rental that exists (the server refuses
   anything else), deleting a rental deletes its records, and the UI guard is typing its name.
2. **The people are data, and no name lives in the source.** `DATA.people` is the list; a selfcheck
   forbids any previous owner name appearing anywhere in the tree. A store written before the list
   existed derives it from the ids its own `taxRates` used — the only honest source for a name.
3. **One function divides the profit: `splitOf`.** `profit = income − expenses`,
   `share = profit × person.share / 100`, `tax = share × rate / 100`. The percentage is divided by
   100 exactly once, and there is no division by the number of owners anywhere. Shares are allowed
   not to total 100; the panel reports the total and nobody's share is scaled to fill the gap.
3b. **A tax rate is per person per fiscal year**, and `POST /api/taxrate` merges the row, so saving
   one rate cannot blank another. Deleting a person deletes their rates; a rate whose id is not a
   person is refused on write and dropped on read.
4. **The fiscal year runs April–March.** `monthToFY` is the only place that decides which year a
   month belongs to. January–March belong to the year that started the previous April. A record's
   `month` is derived from its `date` on the server and never accepted from the client, so the two
   cannot disagree.
4b. **A line stores money three ways and totals read only one.** `amount` + `currency` are what was
   paid, `fx` is frozen onto the line when it is saved, `amountBase = amount / fx` is what every
   total, chart and tax figure sums. Refreshing rates changes what the *next* line records, never
   what an old one cost. On screen as-paid wins: a line paid in MXN shows its own MX$ figure when
   the display currency is MXN, never a round-trip through the base.
4c. **The expense categories are a closed list, shared by both files.** `CATEGORIES` in
   `server.js` and `CATS` in `index.html` must name the same eight in the same order; the server
   refuses anything else. A category with no label, icon or colour is spend that shows in a total
   and nowhere else.
4d0. **Colour that carries meaning must be readable.** `--income` / `--expense` are chart fills; a
   solid bar can be pale, 13px of text cannot. Figures use `--in-ink` / `--out-ink`, the same hues
   at ~6:1 on paper. Anything new that colours text picks from the -ink pair.
4d1. **A new line opens on `settings.defaultCurrency[kind]`**, which ships as the base for both
   kinds and is validated against the currency list on write and again on read. Never inferred from
   the last line entered — an inferred default changes under the person using it.
4d2. **Every title carries a drawn icon from `KICON`.** Headings JS rewrites go through
   `setTitle` (which re-applies the icon); headings it never rewrites carry `data-icon` and are
   stamped once by `paintStaticTitles`. A bare `.textContent =` on a title drops its icon.
4d. **The ledger is one list; the chips are a reading mode.** Income and expenses render from one
   array in date order, told apart by sign, colour and icon. `LFILTER` only ever narrows what
   `renderPropertyCard` draws — it never reaches the server, and no KPI, chart or tax figure may
   move when a chip is pressed. The add button carries the kind, so the line window never asks.
5. **Nothing sums raw rows without scoping them.** Only the calculation layer plus the two grouping
   charts (`renderCatChart`, `renderMonthlyChart`) read `DATA.income` / `DATA.expenses` directly,
   and those two must filter by both the selected fiscal year and the selected property.
6. **The combined view and the per-property views must agree.** The totals on Overview are the sum
   of the per-property totals; they are computed by different functions.
7. **Strict money parsing.** `"1,200"` is a 400, never a silent `0` — on create *and* on edit.
8. **A snapshot is written before the store is overwritten**, the write is atomic, snapshots are
   bounded at 30, and a snapshot name is whitelisted so it cannot escape the backup directory.
9. **Rentals travel with an import or a restore; settings do not.** Records are meaningless
   without the list they are filed under. Settings are configuration and stay as they are.
10. **Settings are configuration, not ledger.** `settings` (base currency + the currency list) is
    kept as-is across an import and a restore, exactly like the apartments. Rates have **one**
    source — the store — and the estimator displays the GBP one rather than keeping a second copy.
    The base currency's rate is pinned at 1: every stored figure is already in it. `readData()`
    backfills `settings` field by field, because a top-level spread would drop a whole object and
    the dialog would render an empty list rather than fail.
11. **Amounts are stored in the base currency, and only ever in it.** The header dropdown is a
    **view**: `money0`/`money2` are the single place that converts, `DISPLAY` never reaches the
    server, and the conversion strip must appear whenever what is on screen is not what is on disk.
    The base currency is locked as soon as any record exists — relabelling stored figures without
    converting them is the worst silent failure available to this app.
12. **Every colour comes from a token, and the dark palette restates all of them.** A token defined
    only in `:root` silently keeps its light value in dark mode — one white card in a dark app. The
    explicit `[data-theme="dark"]` block and the `prefers-color-scheme` block must stay identical,
    the theme is resolved in an inline `<head>` script before first paint, and `applyTheme` re-runs
    `render()` because Chart.js reads the palette only at draw time.
13. **The version chain is whole.** `ARG APP_VERSION` → `process.env.APP_VERSION` →
    `__APP_VERSION__` substituted into `index.html` → `/api/version` (`no-store`) → the meta tag the
    page reads. `index.html` is served `no-cache`. Break any link and the app confidently reports
    the wrong build.

## Conventions

- **No npm runtime dependencies.** `server.js` uses Node built-ins only. Chart.js is vendored in
  `public/` deliberately — no CDN, so the app renders with the internet down. Do not introduce a
  bundler, a framework, or a package that ships to production.
- **One expense-category list.** `EXP_CATS` drives both the add-row and the edit-row select, and
  `"Other"` must stay in it — the server writes it for a blank category.
- **One outbound request exists** — the rate refresh, on button press only, never on a timer and
  never on boot. It writes `settings.fxUsdGbp` and nothing else, and writes nothing on failure. Do
  not add background network calls.

## Known hard-coding (the next piece of work)

Property names, owner names and the currency are hard-coded across `server.js` and `index.html`.
Making them configurable is a deliberate, separate change — the self check already asserts the
places that must stay in agreement, which is what makes that change safe to attempt.

## Data

- Running `node server.js` locally creates `app.web/data/`. It is git-ignored. **Never commit it.**
- It is a real personal ledger. Screenshots for `assets/` or the docs must use invented figures.

## This is a public repo

- **No infrastructure details.** No hostnames, domains, ports, reverse-proxy or auth config, backup
  tooling, firewall posture or monitoring config. That belongs in the private infra repo. The app
  docs describe the app; they do not describe where it runs.
- **No real ledger data** in commits, docs, issues or screenshots.

## Releasing

1. edit in `app.web/`, test with `node server.js`
2. `npm run verify`
3. commit and push — CI runs the same checks
4. `git tag vX.Y.Z && git push --tags` → image published to
   `ghcr.io/horia-delicoti/rental-tracker`
5. bump the version pin in the private infra repo and run the playbook

Deploying is a **deliberate version bump**, never a side effect of editing a file.

## Working style here

- Migrate before you improve. Do not mix a behaviour change and a structural change in one commit —
  if the totals move, it must be obvious which change did it.
- Prefer editing `server.js` / `index.html` in place over restructuring them.
- When behaviour changes, update `website/docs/` in the same commit.
