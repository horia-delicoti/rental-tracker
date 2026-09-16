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
- **Not multi-currency bookkeeping.** A line remembers the currency it was paid in and the rate it
  was entered at, and it shows you that as-paid figure — but every total is worked in the one base
  currency. Changing a rate later never restates a payment that already happened. See
  [Settings](settings.md).

## On a phone

Under 700px the header's controls and the year row do not fit beside the page, so they move to a bar
at the bottom of the screen — one thumb's reach from where you are reading, rather than at the top of
a page you have scrolled away from. Four buttons:

| Button | What it does |
| --- | --- |
| Overview | the combined view, every rental at once |
| the year | says which fiscal year is open; opens the list of years, and **+ Year** |
| the rental | says which rental is open, or **Rentals** on the Overview; opens the list, and **+ Rental** |
| Settings | the display currency, appearance, rates, backups, **+ Rental**, and the open rental's links, note and **Edit** |

The two middle buttons are labelled with what is currently open, so the bar answers "where am I"
without looking back up the page. The row of year pills at the top of the page goes with them —
the same choice offered twice, and the copy at the top is the one you have to scroll back up to
reach. On a wide screen it is still there.

The [ledger](income-and-expenses.md) is folded to its first few lines there, with **N more** to open
it — a year of rent is fifty lines, and on a single column that puts the charts a long scroll away.
Nothing is removed: the rows are still on the page, the fold is a phone measure only, and it lands on
a date heading so a day is never shown half.

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
