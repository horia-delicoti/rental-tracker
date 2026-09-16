# Income and expenses

Every line belongs to one [rental](rentals.md) and one **date**. A line can only name a rental that
exists — the app refuses anything else rather than filing money where nothing can show it.

The date is the day the money moved. The fiscal year and the monthly cash-flow chart are both
derived from it, so a line is never in two places at once and the month is never typed twice.

## One ledger

A rental's page has a single **Ledger**: income and expenses in date order, the way the account
they came from reads. They were two cards for a while, which meant looking in two places to see
what a month did.

Lines are grouped under the day they fall on, newest day first — the way a bank statement reads.
Three things tell the two kinds apart, and a line needs all three to be readable at a glance: the
**sign** (`+` or `−`), the **colour** (teal for income, gold for expenses) and the **icon** —
💵 for income, the category's own for an expense.

The list is capped to the height of the charts beside it and scrolls inside its own card — a year
of rent is fifty lines, and letting it grow left a tall column of rows next to a short column of
charts. A short ledger still draws short.

On a phone the charts sit *under* the list rather than beside it, so there is no height to match
and nothing to scroll inside. The list is folded to its first few lines instead, with **N more** at
the foot of the card to open it and **Show less** to fold it back. The button counts what it is
holding, and the fold lands on a date heading — a day is never shown half. Nothing is removed: the
rows are all still on the page, so a browser find turns up a line below the fold, and a new list —
another year, another rental, a different filter — starts folded again.

## Reading one part of it

The control beside the heading narrows what the list shows. It is one button, and it says what is
on — *All lines*, *Income*, *🔧 Maintenance*, *Expenses · 2 categories*. Opening it gives:

- **All / Income / Expenses** — which side of the ledger;
- **Expense categories** — any number of them, each with what it came to this year, so the menu
  also answers "where did the money go" before you pick anything.

Two rules keep the button honest about the list:

- picking a **category** narrows to expenses, because a category is an expense idea — *Income* and
  *only Maintenance* cannot both be true;
- picking a **side** clears the categories.

Categories are greyed out while *Income* is selected, since income has none and offering them would
offer a filter that can only empty the list. The figures in the menu are the whole year, not the
filtered view, so they do not move as you use it.

This is a reading mode and nothing more: the figures above the ledger, the charts beside it and the
tax are the whole year whatever the filter says. And a list filtered down to nothing says the filter
matched nothing, rather than claiming the year is empty.

Beside the ledger sit the two things that summarise it: the category breakdown, and this rental's
monthly cash flow.

## Adding and editing a line

**+ Income** and **+ Expense** sit at the end of the heading row, each tinted with the colour its
lines are shown in. Which button you press settles the kind, so the window never has to ask.

Both open the same window, and so does clicking any existing line. There is one form, so a line
reads and edits the same way it was written:

| Field | Notes |
| --- | --- |
| Note | optional label, up to 200 characters |
| Category | expenses only, from the category list below |
| Date | a date picker — always `YYYY-MM-DD`, and a real day |
| Amount | digits and at most one dot |
| Paid in | which currency the money actually moved in — a new line starts on that kind's default, see [Settings](settings.md) |

**Delete line** lives in that same window, on the left of Cancel and Save. Deleting from the list
itself would put a destructive control under every row in a ledger you scroll; here it is one step
further in, where you have already opened the line and can see what you are about to remove.

Changing a line's date can move it into a different fiscal year. That is intentional — it is how
you correct a payment filed in the wrong one.

Every change, deletes included, writes a snapshot of the previous state first, so it can be undone
from [Backups](backups.md).

## Amounts are parsed strictly

`1,200` typed with a thousands separator is **refused**, both in the browser and again by the
server. It is not read as `1200`, and — this is the part that matters — it is not read as `0`
either.

This is the rule the whole ledger rests on: a wrong number is worse than an error, because you
would go on to act on it. Anything that is not a plain number is rejected on the way in, on create
and on edit alike. The same goes for the date: `2026-02-31` is not a day, so it is not accepted.

## Paying in another currency

Some bills are paid in the local currency even when the ledger's base is not. A line records all
three things:

- `amount` and `currency` — **what you actually paid**, exactly as paid;
- `fx` — the rate at that moment, **frozen onto the line** when you save it;
- `amountBase` — `amount ÷ fx`, which is what every total, chart and tax figure adds up.

Freezing the rate is the point. Refreshing today's rates in [Settings](settings.md) changes what
the next line will be recorded at; it never rewrites what last May's plumber cost.

On screen, **as paid wins**. A line paid MX$9,000 shows `MX$9,000.00` whenever you are looking at
the ledger in MXN, however far today's rate has drifted — never a figure round-tripped through the
base and back. In any other display currency the line shows the converted amount with the original
`MX$9,000.00` beneath it, and a `paid in MXN` label, so the two are never confused.

## Expense categories

One list drives the dropdown, the icons, the colours and the breakdown bars:

`Internet` 🌐 · `HOA fees` 🏢 · `Fideicomiso` 📜 · `Utilities` 💡 · `Maintenance` 🔧 ·
`Property mgmt` 🧑‍💼 · `Insurance` 🛡️ · `Other` •

A line saved with no category becomes `Other`. Anything outside the list is **refused by the
server**: a category with no label, no icon and no colour would be spend that appears in a total
and nowhere else.

The breakdown beside the ledger groups that rental's expenses for the selected year, largest first,
with a bar, an amount and a share of the total for each — and names the biggest one underneath. It
reads the whole year, so it does not move when you press a chip.
