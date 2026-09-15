// =============================================================
//  Rental Tracker — smoke tests
//
//  Boots the real server against a throwaway data directory and drives it over
//  HTTP. Zero dependencies: node:test, node:assert and global fetch.
//
//      node --test app.web/test/        (or `npm test` at the root)
//
//  This covers the gap selfcheck.js cannot: selfcheck reads the source files
//  and checks invariants, but never starts the app. These tests catch "it
//  builds, it lints, and it does not boot" — and they exercise the validation
//  rules the ledger's integrity actually rests on.
// =============================================================

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 8198; // deliberately not 8099, so a dev server can stay running
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let dataDir;
// A fresh store has NO rentals, so the suite makes the two it files everything
// under. Their ids are generated, which is the point: nothing in the app knows
// a rental id ahead of time any more.
let A, B;

const api = (p, opts) => fetch(BASE + p, opts);
const send = (method) => (p, body) =>
  api(p, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const post = send("POST");
const put = send("PUT");

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rental-tracker-test-"));
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, APP_VERSION: "9.9.9-test" },
    stdio: "ignore",
  });

  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/data`);
      if (r.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("server did not start within 15s");
    await new Promise((r) => setTimeout(r, 100));
  }
});

// Runs after the server is up, before the first test that needs a rental.
const seedRentals = async () => {
  A = await (await post("/api/apartments", { name: "Alpha", color: "#2F6F62" })).json();
  B = await (await post("/api/apartments", { name: "Beta", color: "#B5654A" })).json();
};

after(() => {
  if (child) child.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ it boots
test("a fresh store has no rentals at all", async () => {
  const r = await api("/api/data");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.income), "income is an array");
  assert.ok(Array.isArray(d.expenses), "expenses is an array");
  assert.equal(typeof d.taxRates, "object");
  assert.deepEqual(d.apartments, [], "a template ships nobody else's property names");
  await seedRentals();
  const after = await (await api("/api/data")).json();
  assert.equal(after.apartments.length, 2);
});

// ----------------------------------------------------------------- rentals
test("a rental keeps its links and note", async () => {
  const r = await post("/api/apartments", {
    name: "Gamma",
    color: "#8556B3",
    links: { airbnb: "https://www.airbnb.com/rooms/1", dashboard: "", internet: "http://192.168.1.1" },
    note: "Wi-Fi on the router label",
  });
  assert.equal(r.status, 200);
  const rec = await r.json();
  assert.ok(rec.id);
  assert.equal(rec.links.airbnb, "https://www.airbnb.com/rooms/1");
  assert.equal(rec.links.dashboard, "", "a blank link is a valid answer");
  assert.equal(rec.note, "Wi-Fi on the router label");

  const edited = await (await put(`/api/apartments/${rec.id}`, { name: "Gamma House" })).json();
  assert.equal(edited.name, "Gamma House");
  assert.equal(edited.links.internet, "http://192.168.1.1", "an untouched field is left alone");

  assert.equal((await api(`/api/apartments/${rec.id}`, { method: "DELETE" })).status, 200);
});

test("REFUSES a link that would execute when clicked", async () => {
  // These are rendered as hrefs. javascript: and data: URLs run on click, so the
  // scheme is a security boundary rather than a formatting preference.
  for (const airbnb of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "not a url"]) {
    const r = await post("/api/apartments", { name: "Bad", links: { airbnb } });
    assert.equal(r.status, 400, `accepted ${airbnb}`);
  }
});

test("a rental needs a name, and a colour must be a hex", async () => {
  assert.equal((await post("/api/apartments", { name: "  " })).status, 400);
  assert.equal((await post("/api/apartments", { name: "X", color: "red" })).status, 400);
  assert.equal((await put("/api/apartments/nope", { name: "X" })).status, 404);
});

test("serves the app shell", async () => {
  const r = await api("/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/html/);
  const html = await r.text();
  assert.match(html, /<html/i);
  // A stale UI after a redeploy is invisible until a number looks wrong.
  assert.match(r.headers.get("cache-control") || "", /no-cache/);
  // The page is stamped as it is sent, so a cached copy knows what it is.
  assert.match(html, /name="app-version" content="9\.9\.9-test"/);
  assert.ok(!html.includes("__APP_VERSION__"), "the placeholder was substituted");
});

test("reports which build it is, uncached", async () => {
  const r = await api("/api/version");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(await r.json(), { version: "9.9.9-test" });
});

test("serves the vendored chart library", async () => {
  // Without it every chart on the page is a blank box — and it is vendored
  // precisely so no CDN is needed at runtime.
  const r = await api("/chart.umd.min.js");
  assert.equal(r.status, 200);
});

test("cannot be walked out of public/", async () => {
  const r = await api("/../server.js");
  assert.ok(r.status === 403 || r.status === 404, `got ${r.status}`);
});

// ------------------------------------------------------------------ income
test("records an income payment, in the base currency by default", async () => {
  const r = await post("/api/income", { apartment: A.id, date: "2025-04-01", amount: 1200, note: "April rent" });
  assert.equal(r.status, 200);
  const rec = await r.json();
  assert.ok(rec.id);
  assert.equal(rec.amount, 1200);
  assert.equal(rec.currency, "USD");
  assert.equal(rec.fx, 1);
  assert.equal(rec.amountBase, 1200, "what was paid IS the base figure here");
  assert.equal(rec.date, "2025-04-01");
  assert.equal(rec.month, "2025-04", "derived from the date, never typed beside it");
});

test("records what was paid, in the currency it was paid in", async () => {
  // The rate is frozen onto the line: editing it in Settings later must never
  // restate a payment that already happened.
  const r = await post("/api/expenses", {
    apartment: A.id, date: "2025-04-11", category: "maintenance",
    amount: 4700, currency: "MXN", fx: 18.5,
  });
  assert.equal(r.status, 200);
  const rec = await r.json();
  assert.equal(rec.amount, 4700, "as paid");
  assert.equal(rec.currency, "MXN");
  assert.equal(rec.fx, 18.5);
  assert.equal(rec.amountBase, 254.05, "4700 / 18.5, to the cent");

  // Move the stored MXN rate; the line must not budge.
  const cur = (await (await api("/api/data")).json()).settings.currencies;
  await post("/api/settings", { currencies: cur.map((c) => (c.code === "MXN" ? { ...c, rate: 25 } : c)) });
  const after = (await (await api("/api/data")).json()).expenses.find((x) => x.id === rec.id);
  assert.equal(after.fx, 18.5, "the rate it was entered at");
  assert.equal(after.amountBase, 254.05, "and therefore the same base figure");
});

test("refuses a currency it has no rate for", async () => {
  const r = await post("/api/income", { apartment: A.id, date: "2025-04-01", amount: 10, currency: "ZZZ" });
  assert.equal(r.status, 400);
  const noRate = await post("/api/income", { apartment: A.id, date: "2025-04-01", amount: 10, currency: "MXN", fx: 0 });
  assert.equal(noRate.status, 400, "a rate of zero would divide a payment into infinity");
});

test("REJECTS a thousands separator rather than silently recording 0", async () => {
  // The single most important parsing rule in the app: a ledger you cannot
  // trust is worse than no ledger, because you would still act on it.
  const r = await post("/api/income", { apartment: A.id, date: "2025-04-01", amount: "1,200" });
  assert.equal(r.status, 400);
});

test("rejects a blank amount", async () => {
  const r = await post("/api/income", { apartment: A.id, date: "2025-04-01", amount: "" });
  assert.equal(r.status, 400);
});

test("rejects junk in an amount", async () => {
  const r = await post("/api/income", { apartment: A.id, date: "2025-04-01", amount: "12a" });
  assert.equal(r.status, 400);
});

test("REFUSES a record filed under a rental that does not exist", async () => {
  // Money filed under an unknown rental is money no view can show and no total
  // can include — invisible, and silently so.
  for (const apartment of ["nope", "", undefined]) {
    const r = await post("/api/income", { apartment, date: "2025-04-01", amount: 100 });
    assert.equal(r.status, 400, `accepted ${JSON.stringify(apartment)}`);
  }
  const e = await post("/api/expenses", { apartment: "nope", date: "2025-04-01", amount: 100 });
  assert.equal(e.status, 400);
});

test("rejects a date that is not a real YYYY-MM-DD", async () => {
  // A date the app cannot read drops the row out of every fiscal year at once,
  // and 2025-02-31 would roll over into March without saying so.
  for (const date of ["2025-13-01", "2025-02-31", "04/05/2025", "2025-4-1", "2025-04", ""]) {
    const r = await post("/api/income", { apartment: A.id, date, amount: 100 });
    assert.equal(r.status, 400, `accepted ${JSON.stringify(date)}`);
  }
});

// ---------------------------------------------------------------- expenses
test("records an expense and defaults a blank category", async () => {
  const r = await post("/api/expenses", { apartment: B.id, date: "2025-05-09", amount: 80.5 });
  assert.equal(r.status, 200);
  const rec = await r.json();
  assert.equal(rec.amount, 80.5);
  assert.equal(rec.category, "other", "a blank category lands in a bucket the UI can draw");
});

test("keeps the category it was given, and refuses one it cannot draw", async () => {
  const rec = await (await post("/api/expenses", {
    apartment: A.id, date: "2025-06-02", amount: 30, category: "internet",
  })).json();
  assert.equal(rec.category, "internet");
  // A category with no label, icon or colour would be spend that appears in a
  // total and nowhere else.
  assert.equal((await post("/api/expenses", {
    apartment: A.id, date: "2025-06-02", amount: 30, category: "yacht",
  })).status, 400);
});

// ---------------------------------------------------------------- settings
const rateOf = (settings, code) => settings.currencies.find((c) => c.code === code).rate;

test("seeds a currency list with the base pinned at 1", async () => {
  const d = await (await api("/api/data")).json();
  assert.equal(d.settings.baseCurrency, "USD");
  assert.equal(rateOf(d.settings, "USD"), 1);
  for (const code of ["GBP", "MXN", "EUR"]) assert.ok(rateOf(d.settings, code) > 0, `${code} has a rate`);
});

test("stores edited rates", async () => {
  const d0 = (await (await api("/api/data")).json()).settings;
  const next = d0.currencies.map((c) => (c.code === "GBP" ? { ...c, rate: 0.81 } : c));
  const r = await post("/api/settings", { currencies: next });
  assert.equal(r.status, 200);
  assert.equal(rateOf(await r.json(), "GBP"), 0.81);
  assert.equal(rateOf((await (await api("/api/data")).json()).settings, "GBP"), 0.81);
});

test("refuses a rate that would silently zero every estimate", async () => {
  const base = (await (await api("/api/data")).json()).settings.currencies;
  for (const rate of [0, -1, "", "0,81", "abc"]) {
    const bad = base.map((c) => (c.code === "GBP" ? { ...c, rate } : c));
    const r = await post("/api/settings", { currencies: bad });
    assert.equal(r.status, 400, `accepted ${JSON.stringify(rate)}`);
  }
  const after = (await (await api("/api/data")).json()).settings;
  assert.equal(rateOf(after, "GBP"), 0.81, "the stored rates are untouched by a refused write");
});

test("refuses a list that would break the ledger's own currency", async () => {
  const base = (await (await api("/api/data")).json()).settings.currencies;
  const cases = [
    [[], "an empty list"],
    [base.filter((c) => c.code !== "USD"), "dropping the base currency"],
    [[...base, { code: "GBP", symbol: "£", rate: 0.8 }], "a duplicate code"],
    [[...base, { code: "POUNDS", symbol: "£", rate: 0.8 }], "a code that is not three letters"],
  ];
  for (const [currencies, what] of cases) {
    const r = await post("/api/settings", { currencies });
    assert.equal(r.status, 400, `accepted ${what}`);
  }
});

test("adds and removes a currency", async () => {
  const base = (await (await api("/api/data")).json()).settings.currencies;
  const added = await post("/api/settings", { currencies: [...base, { code: "ron", symbol: "lei", rate: 4.6 }] });
  assert.equal(added.status, 200);
  const withRon = await added.json();
  assert.equal(rateOf(withRon, "RON"), 4.6, "a lowercase code is normalised");
  assert.equal(withRon.currencies.find((c) => c.code === "RON").symbol, "lei");

  const removed = await post("/api/settings", { currencies: withRon.currencies.filter((c) => c.code !== "RON") });
  assert.equal(removed.status, 200);
  assert.ok(!(await removed.json()).currencies.some((c) => c.code === "RON"));
});

test("the base currency is locked once records are stored in it", async () => {
  // Relabelling stored figures without converting them turns $1,450 into
  // MX$1,450 in one click. There are records by now, so this must be refused.
  const d = (await (await api("/api/data")).json());
  assert.ok(d.income.length + d.expenses.length > 0, "there are records to protect");
  const r = await post("/api/settings", { currencies: d.settings.currencies, baseCurrency: "MXN" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /locked/);
  assert.equal((await (await api("/api/data")).json()).settings.baseCurrency, "USD");
});

test("the base currency can be changed while the ledger is empty", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rental-tracker-base-"));
  const port = PORT + 2;
  const kid = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir }, stdio: "ignore",
  });
  const at = (p, body) => fetch(`http://127.0.0.1:${port}${p}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if ((await at("/api/data")).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error("server did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
    const cur = (await (await at("/api/data")).json()).settings.currencies;
    const r = await at("/api/settings", { currencies: cur, baseCurrency: "MXN" });
    assert.equal(r.status, 200);
    const settings = await r.json();
    assert.equal(settings.baseCurrency, "MXN");
    assert.equal(rateOf(settings, "MXN"), 1, "the new base is pinned at 1");

    // And the base must be a currency that exists.
    const gone = await at("/api/settings", { currencies: cur.filter((c) => c.code !== "EUR"), baseCurrency: "EUR" });
    assert.equal(gone.status, 400);
  } finally {
    kid.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pins the base rate at 1 whatever it is sent", async () => {
  // Every stored figure is already in the base, so any other rate would make
  // every conversion in the app disagree with the ledger.
  const base = (await (await api("/api/data")).json()).settings.currencies;
  const r = await post("/api/settings", { currencies: base.map((c) => (c.code === "USD" ? { ...c, rate: 42 } : c)) });
  assert.equal(r.status, 200);
  assert.equal(rateOf(await r.json(), "USD"), 1);
});

// --------------------------------------------------------------- tax rates
// ------------------------------------------------------------------ people
// The owners are a list in the store. Nothing in the source names one.
let P1, P2;

test("a person is created with a name, a colour and a share", async () => {
  P1 = await (await post("/api/people", { name: "Owner One", share: 60 })).json();
  assert.equal(P1.name, "Owner One");
  assert.equal(P1.share, 60);
  assert.match(P1.color, /^#[0-9A-Fa-f]{6}$/, "a colour is given, not left undefined");
  assert.equal((await post("/api/people", { name: "" })).status, 400, "a person needs a name");
});

test("a new person is offered what is left of 100%", async () => {
  P2 = await (await post("/api/people", { name: "Owner Two" })).json();
  assert.equal(P2.share, 40, "60 taken, so 40 offered");
});

test("a share must be a percentage", async () => {
  for (const share of ["sixty", -1, 101]) {
    assert.equal((await post("/api/people", { name: "Nope", share })).status, 400, String(share));
  }
});

test("a person gets a different colour from the one before", async () => {
  assert.notEqual(P1.color, P2.color, "colour is how two owners are told apart");
});

test("stores a tax rate per fiscal year, keyed by person", async () => {
  const r = await post("/api/taxrate", { fy: "2025-2026", rates: { [P1.id]: 40, [P2.id]: 20 } });
  assert.equal(r.status, 200);
  const d = await (await api("/api/data")).json();
  assert.deepEqual(d.taxRates["2025-2026"], { [P1.id]: 40, [P2.id]: 20 });
});

test("saving one person's rate leaves the others alone", async () => {
  await post("/api/taxrate", { fy: "2025-2026", rates: { [P1.id]: 33 } });
  const d = await (await api("/api/data")).json();
  assert.deepEqual(d.taxRates["2025-2026"], { [P1.id]: 33, [P2.id]: 20 },
    "the row is merged, not replaced — the estimator sends one rate at a time");
});

test("a blank rate means zero, junk is refused", async () => {
  const blank = await post("/api/taxrate", { fy: "2026-2027", rates: { [P1.id]: "", [P2.id]: "" } });
  assert.equal(blank.status, 200);
  const d = await (await api("/api/data")).json();
  assert.deepEqual(d.taxRates["2026-2027"], { [P1.id]: 0, [P2.id]: 0 });

  assert.equal((await post("/api/taxrate", { fy: "2026-2027", rates: { [P1.id]: "forty" } })).status, 400);
  assert.equal((await post("/api/taxrate", { fy: "2026-2027", rates: { [P1.id]: 101 } })).status, 400);
});

test("a rate for someone who does not exist is refused", async () => {
  const r = await post("/api/taxrate", { fy: "2026-2027", rates: { nobody: 20 } });
  assert.equal(r.status, 400, "a rate no view can label would add to the tax total from nowhere");
});

test("a fiscal year must look like one", async () => {
  for (const fy of ["2026", "2026-2028", "twenty", ""]) {
    assert.equal((await post("/api/taxrate", { fy, rates: {} })).status, 400, String(fy));
  }
});

test("removing a person removes their rates for every year", async () => {
  const gone = await (await api(`/api/people/${P2.id}`, { method: "DELETE" })).json();
  assert.equal(gone.ok, true);
  assert.equal(gone.removed.years, 2, "2025-26 and 2026-27");
  const d = await (await api("/api/data")).json();
  assert.ok(!d.people.some((p) => p.id === P2.id));
  for (const row of Object.values(d.taxRates)) assert.equal(row[P2.id], undefined);
  assert.equal((await api(`/api/people/${P2.id}`, { method: "DELETE" })).status, 404);
});

// ------------------------------------------------------------ edit, delete
test("edits a record in place, under the same rules as a create", async (t) => {
  const rec = await (await post("/api/income", {
    apartment: A.id, date: "2025-07-03", amount: 900, note: "before",
  })).json();

  await t.test("updates the fields it is given", async () => {
    const r = await put(`/api/income/${rec.id}`, { amount: 950, note: "after" });
    assert.equal(r.status, 200);
    const updated = await r.json();
    assert.equal(updated.amount, 950);
    assert.equal(updated.note, "after");
    assert.equal(updated.date, "2025-07-03", "an untouched field is left alone");
  });

  await t.test("an edit cannot sneak junk past the parser", async () => {
    const r = await put(`/api/income/${rec.id}`, { amount: "1,000" });
    assert.equal(r.status, 400);
  });

  await t.test("an edit cannot sneak a bad date past either", async () => {
    const r = await put(`/api/income/${rec.id}`, { date: "2025-99-01" });
    assert.equal(r.status, 400);
  });

  await t.test("moving a line moves the month with it", async () => {
    const moved = await (await put(`/api/income/${rec.id}`, { date: "2026-01-20" })).json();
    assert.equal(moved.month, "2026-01", "derived, so the two can never disagree");
  });

  await t.test("a missing record is a 404, not a silent no-op", async () => {
    const r = await put("/api/income/deadbeef", { amount: 10 });
    assert.equal(r.status, 404);
  });

  await t.test("deletes it", async () => {
    const r = await api(`/api/income/${rec.id}`, { method: "DELETE" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).removed, 1);
    const d = await (await api("/api/data")).json();
    assert.ok(!d.income.some((x) => x.id === rec.id));
  });
});

test("deleting a rental takes its records with it", async () => {
  const doomed = await (await post("/api/apartments", { name: "Doomed" })).json();
  await post("/api/income", { apartment: doomed.id, date: "2025-04-01", amount: 500 });
  await post("/api/expenses", { apartment: doomed.id, date: "2025-04-01", amount: 60 });

  const before = await (await api("/api/data")).json();
  const r = await api(`/api/apartments/${doomed.id}`, { method: "DELETE" });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).removed, { income: 1, expenses: 1 });

  const after = await (await api("/api/data")).json();
  assert.ok(!after.apartments.some((a) => a.id === doomed.id));
  assert.ok(!after.income.some((x) => x.apartment === doomed.id), "no orphaned income left behind");
  assert.ok(!after.expenses.some((x) => x.apartment === doomed.id));
  assert.equal(after.income.length, before.income.length - 1, "and nothing else was touched");
});

// ------------------------------------------------------- backups, restore
test("snapshots before a change, so a mistake is undoable", async () => {
  const before = await (await api("/api/backups")).json();
  await post("/api/income", { apartment: A.id, date: "2025-08-04", amount: 111, note: "snapshot me" });
  const after = await (await api("/api/backups")).json();
  assert.ok(after.length > before.length, "a snapshot was written");
  assert.match(after[0].name, /^data-[0-9TZ-]+\.json$/);
});

test("restores a snapshot, and the restore is itself undoable", async () => {
  const mistake = await (await post("/api/income", {
    apartment: A.id, date: "2025-09-05", amount: 4242, note: "mistake",
  })).json();

  const snaps = await (await api("/api/backups")).json();
  const r = await post("/api/restore", { name: snaps[0].name }); // newest = the state before the mistake
  assert.equal(r.status, 200);

  const d = await (await api("/api/data")).json();
  assert.ok(!d.income.some((x) => x.id === mistake.id), "the mistake is gone");
  assert.ok(d.apartments.length > 0, "the apartments survive a restore");

  const after = await (await api("/api/backups")).json();
  assert.ok(after.length >= snaps.length, "the pre-restore state was snapshotted too");
});

test("a snapshot name cannot escape the backup directory", async () => {
  for (const name of ["../../data.json", "data.json", "", "data-x/../../y.json"]) {
    const r = await post("/api/restore", { name });
    assert.equal(r.status, 400, `accepted ${JSON.stringify(name)}`);
  }
  const missing = await post("/api/restore", { name: "data-2000-01-01T00-00-00-000Z.json" });
  assert.equal(missing.status, 404);
});

// ------------------------------------------------------- export and import
test("exports the whole store as a download", async () => {
  const r = await api("/api/export");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition") || "", /attachment/);
  const d = await r.json();
  assert.ok(Array.isArray(d.income) && Array.isArray(d.expenses));
});

test("an import must look like this app's export", async () => {
  for (const body of [{ nope: true }, { income: [], expenses: [] },
                      { income: {}, expenses: [], taxRates: {}, apartments: [] },
                      { income: [], expenses: [], taxRates: {} }]) {
    const r = await post("/api/import", body);
    assert.equal(r.status, 400, `accepted ${JSON.stringify(body)}`);
  }
});

test("imports a valid export, rentals and people and all", async () => {
  // The rentals and the people travel WITH the records: a row filed under a
  // rental the store does not have, or a rate filed under someone it cannot
  // name, would be money and tax that nothing can show.
  const r = await post("/api/import", {
    apartments: [{ id: "elsewhere", name: "Somewhere else", color: "#2F6F62", links: {}, note: "" }],
    people: [{ id: "someone", name: "Someone Else", color: "#B5654A", share: 100 }],
    taxRates: { "2025-2026": { someone: 10 } },
    income: [{ id: "x1", apartment: "elsewhere", date: "2025-04-01", amount: 5, note: "" }],
    expenses: [],
  });
  assert.equal(r.status, 200);
  const d = await (await api("/api/data")).json();
  assert.equal(d.income.length, 1);
  assert.ok(d.apartments.some((a) => a.id === "elsewhere"), "the imported rental came with its records");
  assert.deepEqual(d.people.map((p) => p.id), ["someone"], "and so did the people the rates belong to");
  assert.deepEqual(d.taxRates["2025-2026"], { someone: 10 });
  assert.equal(rateOf(d.settings, "GBP"), 0.81, "settings are configuration: an import replaces records, not the rates");
  // Re-seed: the import replaced the rentals and people the rest of the suite used.
  await seedRentals();
  P1 = await (await post("/api/people", { name: "Owner One", share: 100 })).json();
});

// ----------------------------------------------------------- rates refresh
test("a rate refresh either updates the rate or changes nothing", async () => {
  // The only outbound request in the app. This runs wherever the tests run, so
  // it must pass with the network available and with it blocked — what is
  // asserted is the invariant either way: the stored rate is never left broken.
  const before = (await (await api("/api/data")).json()).settings;
  const r = await post("/api/rates/refresh", {});
  const body = await r.json();
  const after = (await (await api("/api/data")).json()).settings;

  if (r.status === 200) {
    assert.ok(Array.isArray(body.updated) && Array.isArray(body.skipped));
    assert.equal(rateOf(after, "USD"), 1, "the base stays pinned");
    for (const c of after.currencies) assert.ok(c.rate > 0, `${c.code} has a usable rate`);
  } else {
    assert.equal(r.status, 502, `unexpected status ${r.status}`);
    assert.ok(body.error, "a failure says why");
    assert.deepEqual(after, before, "a failed refresh must leave the stored rates alone");
  }
});

test("a store written before settings existed comes back with them", async () => {
  // A top-level spread would replace the whole settings object, and the dialog
  // would then render an empty currency list rather than fail.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rental-tracker-legacy-"));
  fs.mkdirSync(path.join(dir, "backups"));
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({
    apartments: [], taxRates: {}, income: [], expenses: [],
    settings: { fxUsdGbp: 0.66 },          // the shape that existed before the list
  }));
  const port = PORT + 1;
  const kid = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir }, stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/data`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error("legacy server did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
    const s = (await (await fetch(`http://127.0.0.1:${port}/api/data`)).json()).settings;
    assert.equal(s.baseCurrency, "USD", "the missing field was filled in");
    assert.ok(s.currencies.length >= 2, "the currency list was filled in");
    assert.equal(rateOf(s, "GBP"), 0.66, "the single rate it did have was carried onto GBP");
  } finally {
    kid.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a store written before people existed derives them from its own rates", async () => {
  // The owners used to be two ids in the source, and taxRates was keyed by
  // them. The only honest place to get the names from is the keys the store
  // itself used — inventing two here would put strangers in every ledger.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rental-tracker-people-"));
  fs.mkdirSync(path.join(dir, "backups"));
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({
    apartments: [], income: [], expenses: [],
    taxRates: { "2025-2026": { alex: 18, sam: 10 }, "2026-2027": { alex: 20, sam: 12 } },
  }));
  const port = PORT + 2;
  const kid = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir }, stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/data`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error("legacy server did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
    const d = await (await fetch(`http://127.0.0.1:${port}/api/data`)).json();
    assert.deepEqual(d.people.map((p) => p.id).sort(), ["alex", "sam"], "ids kept, so the rates still resolve");
    assert.deepEqual(d.people.map((p) => p.name).sort(), ["Alex", "Sam"], "named from the keys, capitalised");
    assert.deepEqual(d.people.map((p) => p.share), [50, 50], "equal, the only split the old store could express");
    for (const p of d.people) assert.match(p.color, /^#[0-9A-Fa-f]{6}$/);
    assert.deepEqual(d.taxRates["2026-2027"], { alex: 20, sam: 12 }, "and every rate survived");
  } finally {
    kid.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a rate for someone missing from the people list is dropped on read", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rental-tracker-orphan-"));
  fs.mkdirSync(path.join(dir, "backups"));
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({
    apartments: [], income: [], expenses: [],
    people: [{ id: "p1", name: "Only One", color: "#2F6F62", share: 100 }],
    taxRates: { "2026-2027": { p1: 20, ghost: 90 } },
  }));
  const port = PORT + 3;
  const kid = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir }, stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/data`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error("server did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
    const d = await (await fetch(`http://127.0.0.1:${port}/api/data`)).json();
    assert.deepEqual(d.taxRates["2026-2027"], { p1: 20 },
      "a 90% rate under nobody would keep adding to the tax total from nowhere");
  } finally {
    kid.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------ per-kind entry defaults
test("a fresh store defaults both kinds to the base currency", async () => {
  const d = await (await api("/api/data")).json();
  assert.deepEqual(d.settings.defaultCurrency, { income: "USD", expenses: "USD" },
    "a public template must not assume anyone's country");
});

test("each kind's default is set on its own", async () => {
  const r = await post("/api/settings", { defaultCurrency: { expenses: "MXN" } });
  assert.equal(r.status, 200);
  const s = (await (await api("/api/data")).json()).settings;
  assert.equal(s.defaultCurrency.expenses, "MXN");
  assert.equal(s.defaultCurrency.income, "USD", "setting one must not reset the other");
  // and it is configuration, so the currency list is untouched by the write
  assert.equal(s.currencies.length, (await (await api("/api/data")).json()).settings.currencies.length);
});

test("a default must name a currency that exists", async () => {
  const before = (await (await api("/api/data")).json()).settings.defaultCurrency;
  const r = await post("/api/settings", { defaultCurrency: { income: "ZZZ" } });
  assert.equal(r.status, 400, "a default with no rate would open the dialog on a figure that cannot be converted");
  const after = (await (await api("/api/data")).json()).settings.defaultCurrency;
  assert.deepEqual(after, before, "a refused write changes nothing");
});

test("deleting a currency that was a default falls back to the base", async () => {
  const base = (await (await api("/api/data")).json()).settings.currencies;
  await post("/api/settings", { currencies: [...base, { code: "SEK", symbol: "kr", rate: 10.9 }] });
  assert.equal((await post("/api/settings", { defaultCurrency: { income: "SEK" } })).status, 200);
  await post("/api/settings", { currencies: base });   // SEK is gone
  const s = (await (await api("/api/data")).json()).settings;
  assert.equal(s.defaultCurrency.income, "USD", "or a new line opens at a rate that no longer exists");
});

// -------------------------------------------------------------------- 404s
test("a restore puts the records back and leaves the configuration alone", async () => {
  const cur = (await (await api("/api/data")).json()).settings.currencies;
  await post("/api/settings", { currencies: cur.map((c) => (c.code === "GBP" ? { ...c, rate: 0.77 } : c)) });
  const snaps = await (await api("/api/backups")).json();
  const oldest = snaps[snaps.length - 1].name; // a much older ledger, with an older rate in it
  assert.equal((await post("/api/restore", { name: oldest })).status, 200);
  const d = await (await api("/api/data")).json();
  assert.equal(rateOf(d.settings, "GBP"), 0.77, "restoring a ledger must not change the rate you estimate at");
});

test("unknown api routes 404", async () => {
  const r = await api("/api/nope");
  assert.equal(r.status, 404);
});

test("malformed JSON is a 400, not a crash", async () => {
  const r = await api("/api/income", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json",
  });
  assert.equal(r.status, 400);
  assert.equal((await api("/api/data")).status, 200, "the server is still up");
});
