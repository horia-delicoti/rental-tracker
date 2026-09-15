# Rentals

A **rental** is a property you record income and expenses against. They are yours to add, rename
and remove — nothing about them is built into the app, and a fresh install has none at all. It asks
for the first one rather than shipping someone else's property names for you to clear out.

## Adding one

**+ Rental** in the header (or **Add your first rental** on an empty install) opens the form:

| Field | Notes |
| --- | --- |
| Name | how it appears in the nav, the comparison and every chart |
| Colour | its identity wherever it sits beside another rental |
| Airbnb listing | optional |
| Dashboard | optional — wherever you manage bookings for this one |
| Internet | optional — a local address like `http://192.168.1.1` is fine |
| Note | free text: the Wi-Fi code, the cleaner's number, which boiler valve sticks |

A new rental is given the first colour nothing else is using, so two are never the same colour by
accident — which would defeat the point of having one. The palette's eight colours are spaced far
enough apart to stay distinguishable as bars, in both light and dark.

## Links

The links are **stored and displayed, never followed**. The app fetches nothing from them — it
still makes exactly one outbound request in its life, and that is the [rate refresh](settings.md).
They open in a new tab when you click them.

Only `http://` and `https://` links are accepted. That is not fussiness about formatting: a
`javascript:` URL in a link runs when clicked, so the scheme is refused rather than stored.

## The rental's page

Its links, its note and **✎ Edit** sit at the far end of the year row — space that is otherwise
empty, so opening a rental costs no vertical room.

Below that is the **Ledger** — income and expenses in one list, in date order — with the category
breakdown and this rental's monthly cash flow beside it, and its history across every year
underneath. See [Income and expenses](income-and-expenses.md) for how a line is added, edited and
removed.

## Deleting one

Deleting a rental **deletes the income and expenses filed under it**. This is deliberate: rows left
behind would belong to a rental no view can name, so the money would sit in the totals with nothing
to attribute it to.

The dialog tells you how many records will go, and the guard is typing the rental's name — a
confirmation box gets dismissed by reflex, a name does not. As with every change, a snapshot is
written first, so [Restore](backups.md) is the way back.

## What a rental is *not*

It is not an owner. The shares and the per-person tax rates are about the people who own the
properties, not about how many properties there are — see [Tax split](tax.md). Adding a third rental
changes what is being divided, not who divides it.
