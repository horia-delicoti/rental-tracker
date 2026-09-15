# API

All endpoints take and return JSON. There is no authentication — see [Install](install.md).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/data` | — | the whole store |
| `POST` | `/api/apartments` | `{name, color, links, note}` | the created rental |
| `PUT` | `/api/apartments/:id` | any of the above | the updated rental |
| `DELETE` | `/api/apartments/:id` | — | `{ok, removed:{income, expenses}}` |
| `GET` | `/api/version` | — | `{version}` — the build this server is running |
| `POST` | `/api/settings` | `{baseCurrency, currencies:[{code,symbol,rate}], defaultCurrency:{income,expenses}}` | the stored settings |
| `POST` | `/api/rates/refresh` | — | `{ok, date, updated[], skipped[]}` — or `502` |
| `POST` | `/api/income` | `{apartment, date, amount, currency, fx, note}` | the created record |
| `POST` | `/api/expenses` | `{apartment, date, category, amount, currency, fx, note}` | the created record |
| `POST` | `/api/people` | `{name, color, share}` | the created person |
| `PUT` | `/api/people/:id` | any of the above | the updated person |
| `DELETE` | `/api/people/:id` | — | `{ok, removed:{years}}` |
| `POST` | `/api/taxrate` | `{fy, rates:{<person id>: %}}` | `{fy, rates}` for that year |
| `PUT` | `/api/income/:id` | any of `{date, amount, currency, fx, note}` | the updated record |
| `PUT` | `/api/expenses/:id` | any of `{date, amount, currency, fx, note, category}` | the updated record |
| `DELETE` | `/api/income/:id` | — | `{removed: n}` |
| `DELETE` | `/api/expenses/:id` | — | `{removed: n}` |
| `GET` | `/api/backups` | — | snapshots, newest first |
| `POST` | `/api/restore` | `{name}` | `{ok, restored}` |
| `GET` | `/api/export` | — | the store, as a download |
| `POST` | `/api/import` | a previously exported store | `{ok, income, expenses}` |

## Rules the server enforces

- **`amount` must be a plain number.** `"1,200"`, `"12a"` and `""` are all `400`. Blank is rejected
  for amounts; blank is `0` for tax percentages, by design.
- **`date` must be a real `YYYY-MM-DD` day.** `2026-02-31` is a `400`, not a silent roll into
  March. `month` is derived from it server-side and never accepted from the client, so a record's
  fiscal year cannot disagree with its own date.
- **A record stores the money three ways**: `amount` + `currency` as paid, `fx` frozen at the
  moment it was saved, and `amountBase` = `amount ÷ fx`, which is what every total reads. An edit
  that does not change the currency keeps the row's existing `fx`; sending an explicit `fx`
  corrects the rate a payment was made at.
- **An unknown `currency` is a `400`** — a currency with no rate would be a hole in every total.
- **An expense `category` must be one of the eight.** Anything else is a `400`: a category with no
  label, no icon and no colour is spend that appears in a total and nowhere else. Omitting it gives
  `other`.
- **`apartment` must name a rental that exists.** A row filed under an unknown rental is money no
  view can show and no total can include.
- **A person needs a name**; their `share` is a percentage between 0 and 100. The shares are **not**
  required to total 100 — refusing that would land half-way through re-dividing a split between
  three people — so the UI reports the total instead. A new person with no `share` is given whatever
  is left of 100%.
- **`/api/taxrate` is keyed by person id**, and the year's row is **merged**, so sending one rate
  leaves the others alone. `fy` must be `YYYY-YYYY` with consecutive years; a rate must be a number
  between 0 and 100 (blank is `0` by design); a rate for an id that is not a person is a `400`.
- **Deleting a person deletes their tax percentages** for every year, and reports how many.
- **People come *with* an import or a restore**, for the same reason the rentals do: a rate filed
  under someone the store cannot name is tax no view can label. On read, a rate whose id is not in
  the people list is dropped, and a store written before `people` existed has its list derived from
  the ids its own `taxRates` used — names capitalised from those ids, shares equal.
- **A rental needs a name**; its `color` must be a `#RRGGBB` hex; each link must be `http(s)` or
  blank — a `javascript:` URL would execute when clicked, so it is refused.
- **Deleting a rental deletes its records too**, and reports how many of each went.
- **An edit is validated like a create** — the same parser, so an edit is not a back door.
- **A snapshot name must match `data-<stamp>.json`** exactly, which is what stops a restore reading
  a file outside the backups directory.
- **An import must have `income`, `expenses` and `taxRates` of the right types** before it is
  allowed to replace anything.
- **Rentals come *with* an import or a restore.** Records are meaningless without the list they are
  filed under, so the two travel together and a payload without `apartments` is refused.
- **Settings are never taken from an import or a restore** either — they are configuration, not
  ledger. Every rate must be a positive number (`0` is a `400`), codes are three letters and unique,
  the base currency must be in the list, and its own rate is pinned to `1` whatever is sent.
- **`defaultCurrency` only names a currency that exists.** Each kind is set on its own — sending
  one leaves the other alone — and an unknown code is a `400`. It is validated against the list
  *after* any `currencies` in the same request, so deleting a currency and re-pointing a default is
  one save; a currency deleted without re-pointing leaves that default reading as the base.
- **The base currency is locked once records exist.** Changing it would relabel every stored figure
  without converting one, so a `baseCurrency` that differs from the stored one is a `400` whenever
  any income or expense is recorded.
- **`/api/version` is sent `no-store`**, and `index.html` `no-cache`: a cached answer about
  staleness is worthless, and a cached page can otherwise read a newer API.
- **`/api/rates/refresh` is the only route that reaches the internet** (api.frankfurter.app, 10s
  timeout). It writes `settings.currencies[].rate` and nothing else; a currency the ECB does not
  publish is returned in `skipped` with its rate untouched, and on any failure it answers `502` and
  writes nothing at all.
- Request bodies are capped at 1 MB. Unknown `/api/` paths are `404`.

Every write snapshots the previous store first — see [Backups](backups.md).
