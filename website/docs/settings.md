# Settings

Everything that is not a ledger entry lives behind the ⚙ button in the header:
the currency rate, the backup actions, and which build of the app you are looking at.

## Currencies & rates

The window lists every currency the app knows about, with the rate for each. The **(i)** button
beside the title explains what a rate means here and what it does — worth reading once, and out of
the way after that.

Rate means *how many units of that currency one unit of the base is worth* — `GBP 0.79` means
$1 = £0.79. It ships with USD, GBP, MXN and EUR.

**Add currency** offers every currency your browser knows about, grouped by whether its rate can
fill itself: the European Central Bank publishes about thirty, and anything outside that set needs a
rate typed by hand — the row says which you are looking at. A currency is added with a rate of `0`
rather than a guess, so it is obvious that it still needs one. **✕** removes a row; the base
currency's ✕ is disabled.

Each row says what its rate is for:

| Hint | Meaning |
| --- | --- |
| *base currency — every stored figure is in this* | pinned at 1 and not editable |
| *↻ fills itself · also used by the tax estimator* | GBP: the rate the [estimator](tax.md) converts with |
| *↻ fills itself · available in the header dropdown* | usable as a display currency |
| *typed by hand — the ECB does not publish this one* | ↻ will never touch it |

## Base currency

The base is what every figure in the ledger is **recorded in** — the currency you type amounts in,
and the one they are stored as. It defaults to USD.

It can be changed **only while the ledger is empty**. Once records exist the selector is locked and
says so, because changing it would relabel every stored figure without converting a single one:
$1,450 would become MX$1,450 in one click. Viewing in another currency is what the header dropdown
is for, and that changes nothing on disk.

## What a new line starts in

**New income defaults to** and **New expense defaults to** decide which currency the
[line window](income-and-expenses.md) opens on — nothing more. Both ship as the base currency,
because a template cannot know where you are; set them once and they stay put.

They earn their place when the two kinds are usually paid differently — rent arriving in the base
currency while the bills are paid locally, say. The alternative, remembering the last currency you
used, changes under you: one expense in another currency and every expense after it starts there
too.

A default can only name a currency in the list above. Delete that currency and the default falls
back to the base rather than leaving the window pointing at a rate that no longer exists. Editing an
existing line always keeps the currency it was entered in — a default only ever applies to a new one.

## Showing amounts in another currency

The dropdown in the header, beside the ⚙ button, redraws every figure on screen — cards, tables,
charts and axes — in any currency from the list, at that currency's stored rate.

It is a **view**. Nothing is written, nothing is converted on disk, and a strip under the header
says so for as long as you are looking at something other than the base:

> Showing MXN at the stored rate of 18 per 1 USD. Every figure is **recorded** in USD and unchanged
> — this converts what you see, not what is saved.

Switch back to the base currency for the figures exactly as entered. Because the conversion uses one
current rate rather than the rate on the day of each payment, treat a converted view as a sense of
scale, not as an accounting record.

## Where rates live

Rates are stored **on the server**, not in the browser. The GBP rate used to live in the estimator
dialog, per device — which meant two devices could quietly estimate at two different rates, and
neither said so.

Type a rate in, or press **↻ Update rates online** (in the dialog, or **↻ Rates** in the header) to
fill them from the European Central Bank's published daily figures.

What the rates do **not** do: they convert nothing that is stored, and restate nothing you have
already recorded. Every figure in the ledger stays exactly the dollars you entered. Changing a rate
— by hand or from the ECB — changes one thing: what the estimator suggests as a percentage.

A rate of `0`, a blank, or anything that is not a plain number is refused, and so is a list that
drops the base currency, repeats a code, or invents one that is not three letters.

## The one outbound request

**↻ Rates** is the only request this app ever makes off the machine, and it happens only on that
press. It goes to Frankfurter, which serves the ECB's daily reference rates: no API key, no account,
nothing identifying you, one published figure per currency per day.

The button's own label reports what happened, so there is nothing to miss:

| Label | Meaning |
| --- | --- |
| `Updating…` | the request is in flight (it gives up after 10 seconds) |
| `Updated · 2026-09-14` | new rates were stored (to two decimals), dated as the ECB published them |
| `Already current` | the ECB's figures match the ones you already had |
| `Rates update failed` | offline, blocked egress, or the service was unhappy |

A failed refresh **writes nothing**. The rates you had stay the rates you have — a stale figure that
looks freshly fetched is worse than an error. If your host blocks outbound traffic, this button will
always fail, and typing rates by hand keeps working. A currency the ECB does not publish is named in
the dialog and keeps whatever you typed.

## Backups

**Save a backup**, **Load a backup** and **Restore a snapshot** are described in
[Backups](backups.md). They are rare, deliberate actions, which is why they sit in a menu rather
than in the header row.

**Settings are configuration, not ledger.** Loading a backup or restoring a snapshot replaces the
records; the rate you are estimating at stays the one you set. Reverting it silently would move
every tax figure on screen with nothing to say why.

## Appearance

The button in the header cycles **☀ Light → ☾ Dark → ◐ Auto**, showing whichever is current.

- **Light** and **Dark** are explicit choices, remembered in that browser.
- **Auto** stores nothing and follows the device's own setting, so the app turns dark when your
  system does.

Dark is the same app lit differently: the ledger-paper hues are lifted rather than replaced, so a
figure that is teal by day is the same teal by night, and the charts redraw from the same palette.
The choice is resolved before the page paints, so a dark device never flashes white on the way in.

It is a per-device preference, not a stored setting — the same ledger can reasonably be read on a
bright desk and a dark phone.

## Version and updates

The bottom row of the menu names the build you are looking at — for example `Version 1.4.0`. The
version is stamped into the page by the server as it is sent, from the git tag that produced the
image, so it describes the copy you actually have rather than whatever is deployed now.

**Check for updates** asks the server what it would serve today:

| What you see | What it means |
| --- | --- |
| `Up to date` | the page you have is the build the server is running |
| the page reloads | a newer build is available; you were on a cached copy |
| `No connection` | the server could not be reached — what is on screen is all there is |

This matters because a cached app is the only kind that can be confidently wrong about itself: it
renders, it looks finished, and nothing on screen says it is three releases behind.

A local `node server.js` reports `Version dev`, which is the truth — there is no tag behind it.
