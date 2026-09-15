# Development

```bash
npm install          # dev tooling only — the app ships zero runtime dependencies
npm run hooks        # point git at .githooks/ (once per clone)
npm run verify       # syntax + lint + self check + tests

cd app.web && node server.js    # → http://localhost:8099
```

There is no build step. Edit `app.web/server.js` or `app.web/public/index.html`, restart or refresh.

## The four layers, and what each one catches

| Layer | Catches |
| --- | --- |
| `npm run syntax` | `node --check` — a typo, instantly, before anything slower runs |
| `npm run lint` | real bugs in `server.js` **and** in the inline `<script>` inside `index.html` |
| `npm run selfcheck` | invariants read out of the *source* — the wrong-number failures |
| `npm test` | the app actually **boots**, and the API rejects what it must |

The two middle layers matter most and are the least obvious:

**`selfcheck.js` never starts the app.** It reads both source files and asserts the things that
fail *silently* — producing a wrong number rather than an error. The property list existing twice
and agreeing. The owner ids agreeing across the panel that renders them, the call that saves them
and the API that validates them. Profit split in half and the percentage divided by 100 exactly
once. March belonging to the previous fiscal year. No view summing raw rows without scoping them to
a year and a property. It also lifts the page's calculation functions out and runs them against a
fixture, so the arithmetic itself is checked, not just its shape.

**`app.web/test/` knows nothing about the source.** It boots the real server against a throwaway
data directory and drives it over HTTP: that a comma in an amount is a `400`, that an edit cannot
sneak junk past the parser, that a snapshot name cannot escape the backup directory, that a restore
is undoable, that malformed JSON does not take the process down.

Both must pass. The pre-commit hook runs all four; CI runs them again on every push.

## Nothing personal is hard-coded

Rentals, currencies and the people the profit is divided between were all written into `server.js`
and `index.html` at one time or another. All three are now stored, editable data, and a fresh
install ships with none of them.

The agreement checks in `selfcheck.js` that used to protect those lists have become the opposite
rule: `selfcheck.js` fails if a previous owner's name appears anywhere in the tree, so the names
cannot come back by accident in a fixture, a comment or a placeholder.

The only thing a store written before the people list existed can be migrated from is the ids its
own `taxRates` were filed under — so that is where the names come from, capitalised, with equal
shares. Inventing two here would put strangers in every ledger.

The self check asserts every one of those places agrees with the others, which is what makes
changing them a safe edit rather than a search-and-hope. Turning them into stored settings is the
next planned change.

## How the app knows its own version

`APP_VERSION` is a build arg in the Dockerfile, set by CI from the git tag. The server reads it,
substitutes `__APP_VERSION__` into `index.html` as it serves it, and answers `/api/version` with it.
The page compares the two — see [Settings](settings.md). A local run says `dev`.

Every link in that chain is load-bearing and none of it is visible in a browser that has never
cached anything, so the self check asserts all of it.

## Releasing

1. edit in `app.web/`, test with `node server.js`
2. `npm run verify`
3. commit and push — CI runs the same checks and builds the image without publishing it
4. `git tag vX.Y.Z && git push --tags` → a multi-arch image is published to GHCR
5. pin the new version wherever it is deployed

Deploying is a deliberate version bump, never a side effect of editing a file.
