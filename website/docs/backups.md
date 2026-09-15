# Backups

All three actions live behind the ⚙ button in the header — see [Settings](settings.md).

## Rolling snapshots

The server writes a snapshot of the current store **before** every change — every add, edit,
delete, import and restore. The newest 30 are kept in `backups/` inside the data directory, named
`data-<ISO timestamp>.json`.

The write itself is atomic: the new store is written to a temporary file and renamed into place, so
an interrupted write can never leave a half-written `data.json`.

## Restoring

**Restore** lists the snapshots newest first, with its **Close** button in the title row — the list
runs to 30 entries, and the way out should not be at the far end of it. Restoring replaces the current store with that
snapshot — and because a snapshot of the current state is written first, a restore is itself
undoable: it simply becomes the newest snapshot in the list.

A restore brings the **rentals** back with the records — they are the list those records are filed
under, and rows without it would be money nothing can show. It does **not** change your
[settings](settings.md): the rate you estimate at is configuration, not ledger.

## Export and import

**Save** downloads the whole store as `rental-data.json`. **Load** replaces the store from such a
file, after checking it has the right shape — a stray JSON file cannot silently empty the ledger.
The previous store is snapshotted first, as with every other change.

## Backing up the directory

The data directory is the only state. Everything in the app is in `data.json`, with `backups/`
beside it. Copy that directory and you have copied the ledger; there is no database to quiesce and
nothing else to capture.

Treat an exported `rental-data.json` the way you would treat a bank statement.
