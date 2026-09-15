# Rental Tracker

A self-hosted ledger for rental property income. It records what each property earned and
what it cost to hold, works out profit per fiscal year, divides that profit between the people you add and
estimates each one's tax at their own percentage.

It is one Node process with no runtime dependencies, storing everything as plain JSON files on a
mounted volume. There is no account and no signup. The app makes exactly one outbound request, and
only when you press the button that makes it: **Rates**, which fills the USD→GBP rate used by the
tax estimator from the European Central Bank's published figures. Never on a timer, never on boot,
and never with anything about you attached. Type the rate by hand and the app talks to nothing.

## The model in one paragraph

Every **income** and **expense** line belongs to one **rental** and one **date**. Rentals are yours
to add, rename and delete; a fresh install has none and asks for the first. A line records what you
actually paid, in the currency you paid it, with the rate frozen onto it — and a base-currency
figure that every total reads. The line's date decides its **fiscal year**, which runs April to
March. For a fiscal year:

```
profit  = income − expenses
share   = profit × that person's share %     (however many rentals)
tax     = share × that person's percentage for that year
```

Everything on screen is derived from those three lines. There is no other arithmetic to know.

## What it is not

- **Not multi-user.** No login, no accounts, no permissions. It expects to sit behind a reverse
  proxy and an auth layer.
- **Not a tax return.** The tax figure is an estimate from a percentage you set. The optional
  estimator fills UK marginal bands to suggest that percentage; it does not know about your other
  income unless you tell it, and it is not advice.
- **Not multi-currency bookkeeping.** Every amount is recorded in one base currency. You can *view*
  the figures in any other currency from the header dropdown, at one current rate — but nothing is
  stored per-currency and no payment remembers the rate on the day it happened. See
  [Settings](settings.md).
- **Not fully configurable yet.** Rentals and currencies are yours; the two owner names are still
  hard-coded — see [Development](development.md).

## Where to go next

- [Install](install.md) — running it with Docker or straight from a checkout
- [Rentals](rentals.md) — adding properties, their links and notes, and deleting one
- [Income and expenses](income-and-expenses.md) — recording, editing and deleting rows
- [Fiscal years](fiscal-years.md) — why March is last year
- [Tax split](tax.md) — the people, their shares, and the band estimator
- [Settings](settings.md) — the currency rate, and which build you are running
- [Backups](backups.md) — snapshots, export, import and restore
- [API](api.md) — every endpoint
- [Development](development.md) — the checks, and what each one protects
