# Tax split

The people the profit is divided between are **yours to add and remove** — nothing about them is
built into the app, and a fresh install has none. A template that shipped two names would be one
household's owners published for everyone who runs it.

```
profit = income − expenses
share  = profit × that person's share %
tax    = share × that person's percentage for that fiscal year
net    = share − tax
```

## People

**+ Person** in the Profit split heading opens the form:

| Field | Notes |
| --- | --- |
| Name | how they appear in the panel and in the tax-by-person chart |
| Colour | their initials sit on it, and it is their series in the chart |
| Share of profit | their % of the profit from every rental combined |
| Tax % | for the fiscal year on screen only — see below |

A new person is offered whatever is left of 100%, so adding the second of two equal owners needs no
arithmetic. Each gets the first colour nobody is using, and the initials are drawn in white or
near-black depending on which reads better on that colour.

These are the **owners, not the app's users**. Nobody needs an account to appear here, and nothing
in the ledger is attributed to a person — an income line records what came in, not who banked it.

## Shares need not total 100

While you are re-dividing a split between three people there is no moment at which the shares add
up, so the app does not refuse the save. It reports the total instead, under the panel:

- under 100%, it names in money what nobody holds — `shares total 80% · $1,398 unassigned`, because
  "80%" is easy to read past and a figure is not;
- over 100%, it says `over by 20%` rather than a negative amount unassigned, which is a different
  fault: the shares are claiming more profit than exists.

Nobody's share is ever quietly scaled to fill the gap.

## Rates are per person, per year

Each person has **one flat percentage per fiscal year**, typed beside their name. It is stored per
year, so changing this year's rate never restates a previous one, and a person added later simply
has no figure in the years before them.

Saving one person's rate leaves everyone else's alone — the year's row is merged, not replaced.

A rental's page shows the same shares and the same rates applied to *that rental's* profit alone,
which answers "what does this one contribute" without pretending the rentals are taxed separately.

## Removing someone

Removing a person removes their tax percentages for **every year** that had one, and the dialog says
how many. A rate filed under someone the store cannot name is a figure no view can label, and it
would go on adding to the tax total from nowhere. The guard is typing their name; a snapshot is
written first, so [Restore](backups.md) is the way back.

Their share stops being assigned to anyone, so the panel will report a total under 100% until you
re-divide it.

## The band estimator

The **Estimate % from UK bands** button opens an optional helper, per person. It fills the UK
marginal bands bottom-up — personal allowance, basic, higher, additional, including the allowance
taper above £100,000 — and reports the **effective** percentage that results. You can then drop that
number into the flat-percentage field.

It stacks **that person's own share** of the year's profit on the other income you give it, so the
share % matters to the band the estimate lands in.

The dialog works in £, so it converts the share at the GBP rate from [Settings](settings.md). That
rate is shown in the dialog but not editable there — one rate, in one place, stored on the server,
so two devices cannot estimate at two different ones.

Nothing about the estimator changes how data is stored: the saved value is still a single flat
percentage per person per year. The band thresholds and rates are editable in the dialog and default
to England/Wales/NI; your other-income figure and the bands are remembered in the browser, not on
the server.

This is an estimate for planning, not tax advice, and it does not know about income the app has
never seen unless you enter it.
