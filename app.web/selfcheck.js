#!/usr/bin/env node
// =============================================================
//  Rental Tracker — self check
//
//  Run after editing server.js or public/index.html:
//      cd app.web && node selfcheck.js     (or `npm run selfcheck` at the root)
//
//  Not deployed: .dockerignore keeps it out of the image. Nothing here touches
//  the network or your data — it reads the two source files and exercises the
//  pure functions lifted out of them.
//
//  It guards the invariants that are easy to break SILENTLY, i.e. the ones that
//  produce a wrong NUMBER rather than an error:
//    * the apartment list agreeing across both files
//    * the owner ids agreeing across the UI, the save call and the API
//    * profit split 50/50 and taxed once, per owner, per fiscal year
//    * April–March fiscal years, so a March payment lands in the right one
//    * no view summing raw rows without scoping them to a year and a flat
//    * money parsed strictly, so a comma typo is a 400 and never a silent 0
// =============================================================

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const srvSrc = fs.readFileSync(path.join(DIR, "server.js"), "utf8");
const html = fs.readFileSync(path.join(DIR, "public/index.html"), "utf8");
const flat = html.replace(/\n\s*/g, "");
const js = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (detail ? "\n          " + detail : ""));
};
const head = (t) => console.log("\n" + t);

// Body of a top-level function in the inline script, up to the next one.
const bodyOf = (name) => {
  const re = new RegExp("(?:async )?function " + name + "\\s*\\(");
  const i = js.search(re);
  if (i === -1) return "";
  const next = js.indexOf("\nfunction ", i + 1);
  const nextAsync = js.indexOf("\nasync function ", i + 1);
  const ends = [next, nextAsync, js.length].filter((x) => x > 0);
  return js.slice(i, Math.min(...ends));
};

// ---------------------------------------------------------------- parsing
head("Source parses");
try {
  new Function(js);
  ok("public/index.html script parses", true);
} catch (e) {
  ok("public/index.html script parses", false, e.message);
}

// ------------------------------------------------- server / UI agreement
head("server.js and index.html agree");

// Rentals used to be a fixed pair, written into BOTH files. They are now data:
// added, renamed and deleted in the app. The invariant inverts — there must be
// no list in the page to disagree with the store.
ok("the store starts with no rentals", /apartments: \[\],/.test(srvSrc),
   "a template that ships someone else's property names is a template you have to clean out");
ok("the page has no rental list of its own",
   !/const APTS\s*=/.test(js) && /const apts = \(\) => \(DATA && DATA\.apartments\)/.test(js),
   "one source, and it is the store");
ok("the app asks for the first rental instead of drawing blank charts",
   /id="firstRun"/.test(html) && /const empty = apts\(\)\.length === 0/.test(js));
ok("the tabs and the summaries both come from the store",
   /apts\(\)\.map\(a =>/.test(bodyOf("renderViewNav")) && /apts\(\)\.map\(a => propSummary/.test(js),
   "a typed tab is a tab that can name a rental the data does not have");

// A record filed under a rental that does not exist is money no view can show
// and no total can include — invisible, and silently so. Guarded on the way in
// now that the rental list can change under it.
ok("a record must name a rental that exists",
   (srvSrc.match(/unknown rental/g) || []).length === 2,
   "on income and on expenses");
// Deleting a rental takes its records: rows left behind would belong to a
// rental no view can name.
ok("deleting a rental deletes what was filed under it",
   /data\.income = data\.income\.filter\(\(r\) => r\.apartment !== id\)/.test(srvSrc)
     && /data\.expenses = data\.expenses\.filter\(\(r\) => r\.apartment !== id\)/.test(srvSrc));
ok("and it is guarded by typing the rental's name",
   /id="rDelName"/.test(html) && /typed !== a\.name\.trim\(\)\.toLowerCase\(\)/.test(js),
   "a confirm() is dismissed by reflex, a name is not");
ok("the delete dialog says how many records go with it",
   /has \$\{n\} record/.test(js) && /Restore is the way back/.test(js));
ok("a rental deleted under you does not leave a view pointing at it",
   /if\(VIEW !== "overview" && !aptById\(VIEW\)\) VIEW = "overview"/.test(js));

// The links are rendered as hrefs, so the scheme is a security boundary:
// javascript: and data: URLs execute when clicked.
ok("only http(s) links are stored", /u\.protocol === "http:" \|\| u\.protocol === "https:"/.test(srvSrc)
   && /must start with http:\/\/ or https:\/\//.test(srvSrc));
ok("a link opens without handing over this tab", /rel="noopener noreferrer"/.test(js),
   "window.opener reaches back otherwise");
ok("a rental's name and note are escaped where they are drawn",
   /\$\{esc\(a\.name\)\}/.test(js) && /\$\{esc\(a\.note\)\}/.test(js),
   "they are typed by a person and rendered as HTML");
ok("nothing is ever fetched from a link",
   !/fetch\([^)]*links\./.test(js) && /nothing is ever fetched from them/.test(html),
   "the app still makes exactly one outbound request");

// Colour is part of the rental now, not of the stylesheet.
ok("a rental carries its own colour", /backgroundColor: s\.apt\.color/.test(bodyOf("renderCompare"))
   && /validColor/.test(srvSrc) && !/--apt1|--apt2\b/.test(html),
   "so there is no fixed number of them");
ok("a new rental takes a colour nothing else is using",
   /RENTAL_COLORS\.find\(col => !used\.has\(col\)\)/.test(js),
   "two rentals the same colour defeats the point of having one");
{
  // The swatch palette must stay far enough apart to read as different bars.
  const pal = JSON.parse((js.match(/const RENTAL_COLORS = (\[[^\]]+\])/) || ["", "[]"])[1].replace(/'/g, '"'));
  const srvPal = JSON.parse((srvSrc.match(/const DEFAULT_COLORS = (\[[\s\S]*?\]);/) || ["", "[]"])[1].replace(/\n\s+/g, " "));
  ok("the page and the server offer the same palette", JSON.stringify(pal) === JSON.stringify(srvPal),
     pal.length + " colours");
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist = (a, b) => Math.round(Math.sqrt(rgb(a).reduce((s, v, i) => s + (v - rgb(b)[i]) ** 2, 0)));
  let worst = Infinity, pair = "";
  pal.forEach((a, i) => pal.slice(i + 1).forEach((b) => {
    const d = dist(a, b);
    if (d < worst) { worst = d; pair = a + " / " + b; }
  }));
  ok("every pair of swatches is distinguishable", worst >= 55, "closest pair " + pair + " at " + worst);
}
// With one rental the card stays — it still has that rental's year to show.
// What goes is the bolding, because a single figure cannot be the best one.
ok("one rental still gets its card",
   !/style\.display = list\.length/.test(bodyOf("renderCompare"))
     && /const comparing = list\.length > 1;/.test(js)
     && /const mark = boldWinner && comparing;/.test(js),
   "nothing to compare with is not nothing to say");

// Expense categories are a whitelist on BOTH sides now: the server stores only
// what is in its list, and the page draws only what is in its own. A category in
// one and not the other is spend that lands in a total and appears nowhere else.
const srvCats = JSON.parse((srvSrc.match(/const CATEGORIES = (\[[\s\S]*?\]);/) || ["", "[]"])[1].replace(/\n\s+/g, " "));
const uiCats = [...(js.match(/const CATS = \[([\s\S]*?)\n\];/) || ["", ""])[1]
  .matchAll(/id:"([a-z]+)",\s*label:"([^"]+)",\s*icon:"([^"]+)",\s*color:"(#[0-9A-Fa-f]{6})"/g)]
  .map((m) => ({ id: m[1], label: m[2], icon: m[3], color: m[4] }));
ok("both sides list the same categories, in the same order",
   JSON.stringify(srvCats) === JSON.stringify(uiCats.map((x) => x.id)), srvCats.join(", "));
ok("an unknown category is refused rather than stored",
   (srvSrc.match(/unknown category/g) || []).length === 2, "on create and on edit");
ok("every category has an icon and a colour",
   uiCats.length > 0 && uiCats.every((x) => x.icon && x.color), uiCats.length + " categories");
ok("category icons are distinct", new Set(uiCats.map((x) => x.icon)).size === uiCats.length,
   "a shared glyph would defeat the point of having one");
{
  const rgb2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist2 = (a, b) => Math.round(Math.sqrt(rgb2(a).reduce((t, v, i) => t + (v - rgb2(b)[i]) ** 2, 0)));
  let worst = Infinity, pair = "";
  uiCats.forEach((a, i) => uiCats.slice(i + 1).forEach((b) => {
    const d = dist2(a.color, b.color);
    if (d < worst) { worst = d; pair = a.label + " / " + b.label; }
  }));
  ok("category colours are distinguishable", worst >= 40, "closest pair " + pair + " at " + worst);
}
ok("a row that predates the whitelist lands in a category that exists",
   /CATEGORIES\.includes\(String\(r\.category/.test(srvSrc) && /: "other"/.test(srvSrc),
   "rather than vanishing from the breakdown");

// ------------------------------------------------------------ the owners
head("Owners");
// The owners used to be two ids written into the source in three places that
// had to agree — a rename in one wrote a rate the other two never read, and
// the tax silently became zero. They are now a list in the store, so what has
// to hold is that NO name is in the source at all, and that every figure comes
// from that list.
["horia", "ema"].forEach((word) => {
  ok(`no owner named "${word}" in the page`, !new RegExp("\\b" + word + "\\b", "i").test(html),
     "the people are data — a name here is one household's, published for everyone");
  ok(`no owner named "${word}" in the server`, !new RegExp("\\b" + word + "\\b", "i").test(srvSrc));
});
ok("the people come from the store", /const people = \(\) => \(DATA && DATA\.people\) \|\| \[\];/.test(js)
   && /people: \[\],/.test(srvSrc), "empty on a fresh install, like the rentals");
// One function turns profit into per-person figures. Two would be two ways to
// divide the same profit, and the Overview and a rental's page use both.
ok("one place divides the profit", /function splitOf\(fy, profit\)\{/.test(js)
   && (js.match(/splitOf\(/g) || []).length >= 3
   && !/profit \/ 2/.test(js), "no division by a hard-coded number of owners");
ok("a share is stored, not derived from the head count",
   /const share = profit \* \(p\.share\/100\)/.test(js) && /share: Math\.round\(share \* 10\) \/ 10/.test(srvSrc),
   "two owners are often not equal owners");
ok("the rate is per person per year", /rates\[p\.id\]/.test(js)
   && /data\.taxRates\[b\.fy\] = \{ \.\.\.\(data\.taxRates\[b\.fy\] \|\| \{\}\), \.\.\.clean \}/.test(srvSrc),
   "and merged into the year, so saving one rate cannot blank another");
ok("a rate for someone not in the list is refused and dropped",
   /if \(!known\.has\(id\)\) return sendJSON\(res, 400, \{ error: "unknown person: " \+ id \}\)/.test(srvSrc)
     && /if \(ids\.has\(id\) && Number\.isFinite\(Number\(pct\)\)\) kept\[id\] = Number\(pct\)/.test(srvSrc),
   "refused on write, and dropped on read for a store that already has one");
ok("removing a person removes their rates",
   /DELETE" && url\.startsWith\("\/api\/people\/"\)/.test(srvSrc) && /delete row\[id\]/.test(srvSrc),
   "a rate under someone the store cannot name goes on adding to the tax total from nowhere");
// The one thing a store written before people existed can be migrated from is
// the keys it filed its own rates under. Inventing names here would put two
// strangers in everyone's ledger.
ok("legacy owners are derived from the store's own rate keys",
   /Object\.values\(data\.taxRates \|\| \{\}\)\.flatMap\(\(r\) => Object\.keys\(r \|\| \{\}\)\)/.test(srvSrc)
     && /id\.charAt\(0\)\.toUpperCase\(\) \+ id\.slice\(1\)/.test(srvSrc));
ok("people travel with an import and a restore",
   (srvSrc.match(/people: Array\.isArray\((?:snap|b)\.people\)/g) || []).length === 2,
   "a tax percentage filed under someone the store cannot name is a figure no view can label");
// The shares are allowed not to total 100 — refusing the save would land
// half-way through re-dividing them. The panel has to say so instead.
ok("a share total other than 100 is reported, not refused",
   /sharesHeld: Math\.round\(held\*10\)\/10/.test(js) && /unassigned/.test(js)
     && /over by/.test(js) && !/must total 100/.test(srvSrc));
// One way in, not two. The empty panel used to carry its own "+ Person"
// beside the one in the heading, which is two controls to keep in agreement
// for no gain.
ok("there is exactly one way to add a person",
   (html.match(/data-act="new-person"/g) || []).length === 1
     && /b\.dataset\.act === "new-person"/.test(js),
   "the heading's button — the same control whether or not there are people yet");
ok("the empty panel points at it", /add the first with <b>\+ Person<\/b> above/.test(js));
ok("the ratio in the heading is drawn from the shares",
   /people\(\)\.map\(p => p\.share\)\.join\(" \/ "\)/.test(js),
   "or the heading can claim 50 / 50 while the panel says something else");
ok("each person is drawn in their own colour",
   /class="pav" style="background:\$\{esc\(p\.color\)\};color:\$\{readableOn\(p\.color\)\}"/.test(js)
     && /backgroundColor: p\.color/.test(js),
   "the avatar and their series in the tax chart, so a bar and a row read as one person");
// A person's colour is stored data, so nothing in the stylesheet can know
// whether text on it should be white or near-black. Computed per colour, and
// picked by which one actually contrasts better rather than by a threshold.
ok("text on a stored colour is computed, not fixed",
   /const readableOn = hex =>/.test(js)
     && /against\("#FFFFFF"\) >= against\("#16201D"\)/.test(js));
{
  const src = (js.match(/const readableOn = hex => \{[\s\S]*?\n\};/) || [""])[0]
    .replace(/^const readableOn = /, "").replace(/;\s*$/, "");
  const pick = new Function("return (" + src + ")")();
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const swatches = JSON.parse((js.match(/const RENTAL_COLORS = (\[[^\]]+\])/) || ["", "[]"])[1].replace(/'/g, '"'));
  const worst = swatches.reduce((w, col) => Math.min(w, ratio(pick(col), col)), Infinity);
  ok("initials are readable on every swatch", worst >= 4.2,
     "worst pair " + worst.toFixed(2) + ":1 — white on the pale green was 2.45:1");
}

// ------------------------------------------------------- the actual maths
head("Money");
// Lift the pure calculation layer out of the page and run it. Everything on
// screen is derived from these four functions, so this is where a wrong number
// would come from.
const i0 = js.indexOf("function monthToFY");
const i1 = js.indexOf("function render()");
// The summaries read the rental list and the people list, both declared above
// this slice. Lifted by their real declarations, so a rename breaks the checks
// rather than silently testing a copy.
const rentalHelpers = (js.match(/const apts = \(\)[^\n]*\n/) || [""])[0]
  + (js.match(/const aptById = [^\n]*\n/) || [""])[0]
  + (js.match(/const people = \(\)[^\n]*\n/) || [""])[0]
  + (js.match(/const personById = [^\n]*\n/) || [""])[0];
const calc = rentalHelpers + js.slice(i0, i1);
const make = (DATA) => new Function("DATA", "extraFYs", calc +
  "\nreturn {allFYs,propSummary,fySummary,propFySummary,lifetime,monthToFY,splitOf};")(DATA, []);

const FY1 = "2025-2026";
const base = {
  apartments: [
    { id: "a1", name: "Rental One", color: "#2F6F62", links: {}, note: "" },
    { id: "a2", name: "Rental Two", color: "#B5654A", links: {}, note: "" },
  ],
  // Two owners, deliberately NOT equal ones: an equal split is the case that
  // hides a division by the head count.
  people: [
    { id: "o1", name: "Owner One", color: "#2F6F62", share: 60 },
    { id: "o2", name: "Owner Two", color: "#B5654A", share: 40 },
  ],
  taxRates: { [FY1]: { o1: 40, o2: 20 } },
  // `amount` is AS PAID, `amountBase` is what that came to in the base currency.
  // The summaries must read the second and never the first.
  income: [
    { id: "1", apartment: "a1", date: "2025-04-01", month: "2025-04", amount: 1000, currency: "USD", fx: 1, amountBase: 1000, note: "" },
    { id: "2", apartment: "a2", date: "2026-03-05", month: "2026-03", amount: 9000, currency: "MXN", fx: 18, amountBase: 500, note: "" }, // Jan–Mar: same FY
  ],
  expenses: [{ id: "3", apartment: "a1", date: "2025-05-09", month: "2025-05", amount: 100, currency: "USD", fx: 1, amountBase: 100, category: "internet", note: "" }],
};
const M = make(JSON.parse(JSON.stringify(base)));
const s = M.fySummary(FY1);

ok("the fiscal year runs April to March",
   M.monthToFY("2026-03") === FY1 && M.monthToFY("2026-04") === "2026-2027" && M.monthToFY("2025-04") === FY1,
   "a March payment belongs to the year that started the previous April");
ok("income is every rental's income", s.income === 1500,
   "$1,000 plus a MX$9,000 payment that came to $500 — pesos are never added to dollars");
ok("profit is income minus expenses", s.profit === 1400);
ok("the profit is split by each person's share",
   s.per[0].amount === 840 && s.per[1].amount === 560,
   "$1,400 at 60% and 40% — not halved, and not divided by the head count");
ok("the shares add back up to the profit",
   s.per.reduce((t, x) => t + x.amount, 0) === s.profit);
ok("tax is a PERCENTAGE of the share", s.per[0].tax === 336 && s.per[1].tax === 112,
   "840 at 40% and 560 at 20% — not 840 x 40, not 840 x 0.004");
ok("total tax is every owner's tax", s.totalTax === s.per[0].tax + s.per[1].tax);
ok("take-home is profit after tax", s.takeHome === s.profit - s.totalTax);
ok("each owner keeps their share after their own tax",
   s.per.every((x) => x.net === x.amount - x.tax));
{
  // Shares that do not total 100 must leave the rest unassigned rather than
  // being quietly scaled up to fill the profit.
  const part = JSON.parse(JSON.stringify(base));
  part.people[1].share = 20;                       // 60 + 20 = 80
  const sp = make(part).splitOf(FY1, 1400);
  ok("shares under 100% leave the rest unassigned",
     sp.sharesHeld === 80 && Math.round(sp.unassigned) === 280
       && sp.per.reduce((t, x) => t + x.amount, 0) === 1120,
     "nobody's share grows to cover what nobody holds");
}
{
  // Nobody to split between: every figure must be 0, and none of them NaN.
  const none = JSON.parse(JSON.stringify(base));
  none.people = [];
  const sn = make(none).fySummary(FY1);
  ok("no people means no tax and no NaN",
     sn.per.length === 0 && sn.totalTax === 0 && sn.takeHome === sn.profit
       && Number.isFinite(sn.takeHome));
}

// The combined view and the per-property views are computed by different
// functions. If one gains an apartment id the other spells differently, the
// totals stop adding up and neither one errors.
const perProp = ["a1", "a2"].reduce((t, id) => {
  const p = M.propSummary(FY1, id);
  return { income: t.income + p.income, expenses: t.expenses + p.expenses };
}, { income: 0, expenses: 0 });
ok("the combined totals equal the sum of the flats",
   perProp.income === s.income && perProp.expenses === s.expenses,
   "per-property " + perProp.income + "/" + perProp.expenses + " vs combined " + s.income + "/" + s.expenses);

// Why the two apartment lists must agree: a row under an unknown id is counted
// by nothing and reported by nothing.
const orphan = JSON.parse(JSON.stringify(base));
orphan.income.push({ id: "4", apartment: "not-a-flat", date: "2025-04-01", month: "2025-04", amount: 9999, currency: "USD", fx: 1, amountBase: 9999, note: "" });
ok("a row under an unknown apartment id is invisible", make(orphan).fySummary(FY1).income === 1500,
   "which is exactly why the apartment lists must agree");

// A property page taxes that property's own profit, not the combined one.
const p = M.propFySummary(FY1, "a1");
ok("a rental's page taxes that rental's profit",
   p.profit === 900 && p.per[0].amount === 540 && p.per[0].tax === 216,
   "the same shares and rates, applied to this rental's profit alone");

// Rates are per fiscal year. Last year's percentage must never restate this year.
const s2 = M.fySummary("2026-2027");
ok("a year with no rate set is taxed at zero", s2.totalTax === 0 && !Number.isNaN(s2.totalTax));
ok("a year with no income reports 0% spent, not NaN", s2.spent === 0 && Number.isFinite(s2.spent));

// Lifetime is the sum of the years — each counted once.
const two = JSON.parse(JSON.stringify(base));
two.income.push({ id: "5", apartment: "a1", date: "2026-04-02", month: "2026-04", amount: 700, currency: "USD", fx: 1, amountBase: 700, note: "" });
const L = make(two);
ok("lifetime counts every year exactly once", L.lifetime().income === 2200, "$1,500 + $700");

// ------------------------------------------- reading the ledger directly
head("Nothing sums raw rows without scoping them");
// Every figure on screen should come from the calculation layer. Two chart
// renderers read DATA directly by necessity (they group by category and by
// month); they must still scope to the selected year and the selected flat, or
// a property page quietly shows the other flat's money.
const CALC_FNS = ["allFYs", "rowsFor"];
const ALLOWED = [...CALC_FNS, "renderCatChart", "renderMonthlyChart"];
let fn = "(top level)";
const readers = new Set();
js.split("\n").forEach((l) => {
  const m = /^(?:async\s+)?function\s+(\w+)\s*\(/.exec(l) || /^const\s+(\w+)\s*=\s*\(/.exec(l);
  if (m) fn = m[1];
  if (/^\s*(\/\/|\*)/.test(l)) return;
  // Counting records is not reading the ledger: what this guards is a view
  // summing amounts without scoping them to a year and a property.
  if (/DATA\.(income|expenses)\b/.test(l) && !/\.length/.test(l)) readers.add(fn);
});
const unexpected = [...readers].filter((f) => !ALLOWED.includes(f));
ok("only the calculation layer and the two groupers read rows directly",
   unexpected.length === 0,
   unexpected.length ? "also reads DATA directly: " + unexpected.join(", ") : [...readers].join(", "));
ok("the category chart scopes to the year and the flat",
   /monthToFY\(r\.month\) === FY/.test(bodyOf("renderCatChart")) && /!aptId \|\| r\.apartment === aptId/.test(bodyOf("renderCatChart")));
ok("the monthly chart scopes to the year and the flat",
   /fyMonths\(FY\)/.test(bodyOf("renderMonthlyChart")) && /r\.month===m/.test(bodyOf("renderMonthlyChart"))
     && /!aptId \|\| r\.apartment===aptId/.test(bodyOf("renderMonthlyChart")));

// ------------------------------------------------------ what the server takes
head("The server refuses what would corrupt the ledger");
const lift = (header) => {
  const i = srvSrc.indexOf(header);
  return i === -1 ? "" : srvSrc.slice(i, srvSrc.indexOf("\n}", i) + 2);
};
const guards = new Function(lift("function parseNum(") + "\n" +
  (srvSrc.match(/const validMonth = .*;/) || [""])[0] + "\nreturn {parseNum, validMonth};")();

ok("a thousands separator is REJECTED, not read as 0", guards.parseNum("1,200", true) === null,
   "Number(\"1,200\") is NaN — the old `|| 0` turned a $1,200 payment into nothing");
ok("junk is rejected", guards.parseNum("12a", true) === null && guards.parseNum("abc", true) === null);
ok("a blank amount is rejected", guards.parseNum("", true) === null);
ok("a blank rate means 0 by design", guards.parseNum("", false) === 0);
ok("a real number is kept exactly", guards.parseNum("1200.55", true) === 1200.55);
ok("infinity is not a number here", guards.parseNum(Infinity, true) === null);
ok("months must be YYYY-MM", guards.validMonth("2026-01") === true && guards.validMonth("2026-13") === false
   && guards.validMonth("2026-00") === false && guards.validMonth("2026-1") === false && guards.validMonth("") === false);
ok("the UI submits the shape the server accepts", /<input id="liDate" type="date"/.test(html),
   "a date input is the only control that emits YYYY-MM-DD");
ok("the client refuses a comma before the server has to",
   /badAmount\(amount\)/.test(bodyOf("saveLine")));
ok("a server 400 is surfaced beside the field, not swallowed",
   /lineError\("Not saved: " \+ res\.error\)/.test(js),
   "otherwise a rejected save looks exactly like a successful one");

// An edit goes through the same parser as a create, or the strict rule has a
// back door: save junk by editing a row instead of adding one.
ok("an edit is validated like a create", /buildMoney\(b, data\.settings, rec\)/.test(srvSrc),
   "the same function, so an edit is not a back door");

head("The store cannot be lost");
ok("a snapshot is taken BEFORE the store is overwritten",
   srvSrc.indexOf("copyFileSync") < srvSrc.indexOf("renameSync"), "inside writeData");
ok("the write itself is atomic", /renameSync\(tmp, DATA_FILE\)/.test(srvSrc),
   "a half-written data.json is an unrecoverable ledger");
ok("snapshots are bounded", /pruneBackups\(30\)/.test(srvSrc));
ok("a restore is itself undoable", /\/api\/restore[\s\S]{0,1200}writeData\(/.test(srvSrc),
   "writeData snapshots the current state first");
// Only the exact snapshot filename shape may be read back, or "../../" walks out
// of the backup directory.
const snapRe = (srvSrc.match(/\/\^data-\[0-9TZ-\]\+\\\.json\$\//g) || []).length;
ok("snapshot names are whitelisted in both the listing and the restore", snapRe >= 2, snapRe + " occurrences");
ok("a snapshot name cannot escape the backup directory",
   !/^data-[0-9TZ-]+\.json$/.test("../../data.json") && !/^data-[0-9TZ-]+\.json$/.test("data-x/../../y.json"));
ok("an import must look like this app's export", /Array\.isArray\(b\.income\)[\s\S]{0,120}Array\.isArray\(b\.expenses\)/.test(srvSrc),
   "or a stray JSON file silently empties the ledger");
// Rentals ARE structure: a backup's records are meaningless without the list
// they are filed under, so they travel together. Settings do not — see below.
ok("rentals come with an import and a restore",
   /apartments: Array\.isArray\(b\.apartments\)/.test(srvSrc)
     && /apartments: Array\.isArray\(snap\.apartments\)/.test(srvSrc)
     && !/apartments: DEFAULT_DATA\.apartments/.test(srvSrc));
ok("and a payload without them is refused",
   (srvSrc.match(/Array\.isArray\(b\.apartments\)/g) || []).length >= 2
     && (srvSrc.match(/Array\.isArray\(snap\.apartments\)/g) || []).length >= 2,
   "importing records with no rentals would file every one of them under nothing");
ok("static files cannot escape public/", /filePath\.startsWith\(PUBLIC_DIR\)/.test(srvSrc));

// ------------------------------------------------------- wiring integrity
head("Wiring");
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const used = [...new Set([...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]))];
const missing = used.filter((x) => !ids.has(x));
ok("every getElementById target exists", missing.length === 0, missing.join(", ") || used.length + " references");

const canvases = [...html.matchAll(/<canvas id="([^"]+)"/g)].map((m) => m[1]);
const orphanCanvas = canvases.filter((id) => !new RegExp('"' + id + '"').test(js));
ok("every canvas is drawn by something", orphanCanvas.length === 0,
   orphanCanvas.join(", ") || canvases.length + " charts");
ok("a chart is destroyed before it is redrawn", /if\(charts\[id\]\) charts\[id\]\.destroy\(\)/.test(js),
   "Chart.js leaks the old instance otherwise, and stale tooltips come back");
// Delete used to sit on every ledger row, a thumb-width from edit, and it is
// the only action there that cannot be undone from the row itself.
ok("deleting a line starts inside the dialog",
   /id="liDel"/.test(html) && /function deleteLine/.test(js)
     && !/data-act="del"/.test(js),
   "not beside the line you are only trying to correct");
ok("and it still asks, and says what saves you",
   /confirm\(/.test(bodyOf("deleteLine")) && /Restore is the way back/.test(bodyOf("deleteLine")));
// The snapshot list can be 30 rows long. A Close button under it is a Close
// button you have to scroll to.
{
  const restore = html.slice(html.indexOf('id="restoreBg"'), html.indexOf('id="snapList"'));
  ok("the way out of the restore list is at the top",
     /<div class="modalhead">[\s\S]*id="restoreCancel"/.test(restore));
}
ok("a refreshed rate is stored to two decimals",
   /Math\.round\(perBase \* 100\) \/ 100/.test(srvSrc) && /step="0.01"/.test(js),
   "and the field you may edit it in steps in the same units");

// The tabs are beside the title again: the open one names the rental, which is
// why its page carries no heading of its own.
const headerMarkup = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
ok("the tabs sit in the header with the brand and the controls",
   /id="viewNav"/.test(headerMarkup) && (html.match(/id="viewNav"/g) || []).length === 1
     && /class="brand"/.test(headerMarkup) && /class="btns"/.test(headerMarkup));
ok("the open tab names the rental, and nothing repeats it",
   /class="vtab\$\{VIEW === a\.id \? " on" : ""\}"/.test(js)
     && !/renderRentalHead/.test(js) && !/class="ptitle"/.test(html),
   "a second title under the year tabs said what the highlighted tab already said");
// The note, links and Edit take the empty right-hand half of the year row.
// The Apr–Mar framing belongs with the figures it qualifies, not beside the
// year pills where it competed with them.
ok("the fiscal-year framing sits with the split it qualifies",
   /class="splithead"/.test(html) && /\.splithead \.fyhint\{margin-left:auto\}/.test(flat)
     && !/fyhint">fiscal year/.test(js),
   "one place, and it is the card the years actually change");
ok("the rental's tools ride the year row",
   /class="yearrow"/.test(html) && /id="rentalTools"/.test(html)
     && /function renderRentalTools/.test(js) && /\.rtools\{margin-left:auto/.test(flat));
ok("there is nothing there on the Overview",
   /const a = VIEW === "overview" \? null : aptById\(VIEW\);/.test(bodyOf("renderRentalTools"))
     && /\.rtools:empty\{display:none\}/.test(flat));
ok("the note can be read, not only hovered",
   /data-act="note"/.test(js) && /NOTE_OPEN = !NOTE_OPEN/.test(js) && /id="rentalNote"/.test(html),
   "a Wi-Fi code in a tooltip is a Wi-Fi code you squint at");
ok("switching rental closes the last one's note", /NOTE_OPEN = false; render\(\)/.test(js));
ok("a link in the tools does nothing but open", /if\(e\.target\.closest\("a"\)\) return;/.test(js));
ok("the header names the app, not the current view",
   /<h1 class="brand">/.test(html) && !/h1title/.test(html),
   "the highlighted tab already says which view this is");
ok("every layout grid lets its children shrink",
   /\.charts2 > \*,\.main > \*,\.propmain > \*,#kpis > \*/.test(flat),
   "one card that will not shrink sets the width of the whole page");
ok("a wide comparison scrolls inside its card",
   /#compareStats\{overflow-x:auto/.test(flat) && /\.cmp\{[^}]*min-width:max-content/.test(flat),
   "five rentals are wider than a phone, and a table may scroll where a page may not");

// Below 720px the tabs take a line of their own and the tools drop below the
// years rather than squeezing them.
ok("on a narrow screen the tabs and the tools each take a row",
   /#viewNav\{order:2;width:100%\}/.test(flat) && /\.rtools\{margin-left:0;width:100%\}/.test(flat));
// The row is a header, not a floating group of controls: without the rule
// below it runs straight into the year tabs underneath it.
ok("the header is separated from the page", /header\{[^}]*border-bottom:1px solid/.test(flat));

// --- the settings menu ---------------------------------------------------
// The backup actions are rare and deliberate, and they now live behind one
// control. Each row must still exist — a menu row that lost its handler looks
// identical to one that works.
// The menu block ends at the line that closes it, so "inside the menu" means
// inside the menu and not merely inside the header.
const menuStart = html.indexOf('id="setMenu"');
const menu = html.slice(menuStart, html.indexOf("\n        </div>", menuStart));
["fxBtn", "loadBtn", "restoreBtn"].forEach((id) =>
  ok("the menu offers " + id, new RegExp('id="' + id + '"').test(menu) && new RegExp('getElementById\\("' + id + '"\\)').test(js)));
ok("saving a backup is a plain download link", /<a class="mrow" href="\/api\/export" download>/.test(menu),
   "a fetch cannot hand the browser a file to save");
ok("the file picker sits outside the menu", /id="fileInput"/.test(html) && !/id="fileInput"/.test(menu),
   "the menu closes on any click inside it, and a picker removed mid-click never opens");
ok("the menu closes on a click, an outside click and Escape",
   /setMenu\.classList\.remove\("open"\)/.test(js) && /key === "Escape"/.test(js));

// --- currencies and rates -------------------------------------------------
// The estimator used to keep the USD→GBP rate in localStorage, per device. Two
// phones then estimated tax at two different rates, and neither said so.
const srvCurs = [...(srvSrc.match(/currencies: \[([\s\S]*?)\],/) || ["", ""])[1]
  .matchAll(/code: "([A-Z]{3})", symbol: "([^"]+)", rate: ([\d.]+)/g)].map((m) => m[1]);
ok("the store seeds a currency list", srvCurs.length >= 2, srvCurs.join(", "));
ok("the base currency is first and pinned at 1",
   srvCurs[0] === "USD" && /baseCurrency: "USD"/.test(srvSrc)
     && /code === base \? 1 :/.test(srvSrc) && /return \{ \.\.\.cur, rate: 1 \}/.test(srvSrc),
   "every stored figure is already in it, so any other rate would contradict the ledger");
ok("the dialog draws its rows from the store",
   /<div id="curRows"><\/div>/.test(html) && /function drawCurRows/.test(js),
   "a typed row is a rate that can be edited and go nowhere");
ok("the estimator shows the rate rather than taking a second copy",
   /id="calcFxLbl"/.test(html) && !/id="calcFx"[^L]/.test(html) && !/calc_fx/.test(js),
   "a second input is a second source, and they drift");
ok("a rate of zero or junk is refused on both sides",
   /badAmount\(r\.rate\) \|\| \+r\.rate <= 0/.test(js) && /rate === null \|\| rate <= 0/.test(srvSrc),
   "a zero rate reports an estimate of no tax at all, rather than failing");
ok("a currency code is three letters, and unique",
   /\^\[A-Z\]\{3\}\$/.test(srvSrc) && /duplicate currency/.test(srvSrc));
ok("the base currency must stay in the list",
   /must be in the currency list/.test(srvSrc), "the ledger would be denominated in nothing");
// Changing the base relabels every stored figure without converting one of them.
ok("the base currency is locked once records exist",
   /the base currency is locked/.test(srvSrc) && /sel\.disabled = n > 0/.test(js)
     && /Use the currency dropdown in the header/.test(js),
   "$1,450 would silently become MX$1,450");
// A store written before a setting existed must come back WITH it. A top-level
// spread would replace the whole settings object, and the dialog would render
// an empty list rather than fail — the silent kind of wrong.
ok("settings are backfilled field by field, not replaced wholesale",
   /data\.settings = \{ \.\.\.DEFAULT_DATA\.settings, \.\.\.\(parsed\.settings \|\| \{\}\) \}/.test(srvSrc)
     && /!Array\.isArray\(data\.settings\.currencies\)/.test(srvSrc));
ok("an older single-rate store carries its rate onto GBP",
   /settings\.fxUsdGbp/.test(srvSrc) && /c\.code === "GBP" \? \{ \.\.\.c, rate: legacy \}/.test(srvSrc),
   "a rate someone typed is not silently reset to a default");
// Every rate on screen says what reads it. Without this a row nothing consumes
// looks broken, and someone eventually "fixes" it.
ok("every currency row states what its rate is for",
   /function curHint/.test(js) && /base currency/.test(js) && /used by the tax estimator/.test(js)
     && /available in the header dropdown/.test(js) && /the ECB does not publish this one/.test(js),
   "a rate with no stated purpose is one someone eventually 'fixes'");
ok("a currency the ECB cannot fill is added with a rate of 0, not a guess",
   /list\.push\(\{code, symbol: curSymbol\(code\), rate: 0\}\)/.test(js),
   "an invented rate is a wrong number wearing a plausible face");
ok("the picker offers what the device knows, grouped by what fills itself",
   /Intl\.supportedValuesOf\("currency"\)/.test(js) && /Rates update online/.test(js)
     && /All currencies/.test(js),
   "the list comes from the browser, so it works offline");
ok("the dialog edits a working copy, so Cancel really cancels",
   /const list = currencies\(\)\.map\(c => \(\{\.\.\.c\}\)\)/.test(js));
ok("a currency the ECB does not publish is reported, not zeroed",
   /skipped\.push\(cur\.code\); return cur;/.test(srvSrc) && /does not publish/.test(js));
// --- the explanation ------------------------------------------------------
ok("the long explanation is behind the info button, and lives in one place",
   /id="fxInfoBtn"/.test(html) && /id="fxInfo"/.test(html)
     && /aria-expanded/.test(html) && /aria-controls="fxInfo"/.test(html)
     && (html.match(/only outbound request this app ever makes/g) || []).length === 1,
   "worth reading once, not worth standing between you and the field every time");
// Configuration is not ledger: an import replaces the records, and the rate you
// are estimating at stays the one you set. Reverting it with a restore would
// move every tax figure on screen with nothing to say why.
ok("settings are never taken from an import or a restore",
   (srvSrc.match(/settings: \{ \.\.\.DEFAULT_DATA\.settings, \.\.\.readData\(\)\.settings \}/g) || []).length === 2,
   "the same rule the apartments follow");

// --- the one outbound request --------------------------------------------
// This app talks to nothing. The single exception is the rate refresh, and it
// must stay single, stay on a button, and stay unable to damage the ledger.
const outbound = [...srvSrc.matchAll(/fetch\(\s*["'`](https?:[^"'`]+)/g)].map((m) => m[1]);
ok("the server makes exactly one kind of outbound request", outbound.length === 1, outbound.join(", "));
ok("it goes to the ECB's published rates", /api\.frankfurter\.app/.test(outbound[0] || ""));
ok("the page itself calls nothing off-machine",
   ![...js.matchAll(/fetch\(\s*["'`](https?:)/g)].length,
   "every request the page makes is to its own server");
// Never on a timer, never on boot: the only callers are click handlers.
// The function is declared once and only ever handed to a click listener —
// calling it anywhere else is how "on a button" quietly becomes "on load".
const autoCalls = js.split("\n").filter((l) => /refreshRates\(/.test(l) && !/^(async )?function refreshRates/.test(l.trim()));
ok("the refresh happens on a press, never on a timer or on boot", autoCalls.length === 0,
   autoCalls.map((l) => l.trim()).join(" | ") || "declared once, never called directly");
ok("both rate buttons run the same refresh",
   (js.match(/addEventListener\("click", refreshRates\)/g) || []).length === 2,
   "the header button and the one in the dialog");
const ratesRoute = srvSrc.slice(srvSrc.indexOf('url === "/api/rates/refresh"'),
                                srvSrc.indexOf("// DELETE /api/income/:id"));
ok("a hung rate service cannot hang the button", /AbortController/.test(ratesRoute) && /abort\(\), 10000/.test(ratesRoute));
ok("a failed refresh writes nothing",
   ratesRoute.indexOf("writeData(") > ratesRoute.lastIndexOf("sendJSON(res, 502"),
   "a stale rate that looks fresh is worse than an error");
ok("a refresh touches the rate and nothing else",
   !/data\.(income|expenses|taxRates|apartments)/.test(ratesRoute),
   "not one recorded figure is restated by it");
ok("the button says what happened, either way",
   /Updated · /.test(js) && /Already current/.test(js) && /Rates update failed/.test(js),
   "the label carries the result — there is no toast to miss");
ok("the rate dialog reports its own errors",
   /id="fxErr"/.test(html) && /function fxError/.test(js) && !/alert\("Rate must be/.test(js),
   "next to the field that caused them, not in a box you dismiss by reflex");

// --- header affordances ---------------------------------------------------
// Settings and Rates are always present, so they sit flush with the page and
// take a surface only on hover — otherwise two permanent buttons compete with
// the view tabs for the eye.
ok("the header's always-there controls are flush with the background",
   /#setMenuBtn\{background:none;border-color:transparent/.test(flat)
     && /#ratesBtn\{background:none;border-color:transparent/.test(flat));

// --- appearance -----------------------------------------------------------
// Three palettes to keep in agreement: the light one on bare :root, the dark
// one for an explicit choice, and the dark one for a device that is dark and
// has not been asked. A token missing from either dark block does not fail —
// it silently keeps its LIGHT value, which is how dark mode ends up with one
// white card in it.
{
  const block = (sel) => {
    const i = html.indexOf(sel);
    if (i === -1) return null;
    const open = html.indexOf("{", i);
    return html.slice(open + 1, html.indexOf("}", open));
  };
  const tokens = (src) => {
    const out = {};
    [...(src || "").matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)].forEach((m) => { out[m[1]] = m[2].trim(); });
    return out;
  };
  const FONTS = ["--serif", "--mono"];                 // the same in any light
  const light = tokens(block("  :root{"));
  const dark = tokens(block(':root[data-theme="dark"]{'));
  const auto = tokens(block(':root:not([data-theme="light"]){'));

  ok("a dark palette is defined", Object.keys(dark).length > 0);
  const missing = Object.keys(light).filter((k) => !FONTS.includes(k) && !dark[k]);
  ok("the dark palette restates every colour the light one defines", missing.length === 0,
     missing.join(", ") || Object.keys(dark).length + " tokens");
  // Two ways to end up dark — an explicit choice, and a dark device. They must
  // land on the same colours or the app looks different for no stated reason.
  const disagree = Object.keys(dark).filter((k) => auto[k] !== dark[k]);
  ok("a dark device and a chosen dark theme agree", disagree.length === 0, disagree.join(", "));

  // Text on paper has to be readable in both. This is the one contrast pair
  // that, if it goes wrong, makes the app unusable rather than ugly.
  const rgb2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (h) => { const [r, g, b] = rgb2(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
                       return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  [["light", light], ["dark", dark]].forEach(([name, t]) => {
    const r = ratio(t["--ink"], t["--paper"]);
    ok(`body text is readable in ${name}`, r >= 7, `contrast ${r.toFixed(1)}:1 (AAA needs 7)`);
  });
}

// A dark device must never be shown the light palette on its way to the dark
// one. Resolved in the head, before a single style is parsed.
ok("the theme is resolved before the first paint",
   html.indexOf('localStorage.getItem("rl-theme")') < html.indexOf("<style>")
     && /dataset\.theme = t/.test(html),
   "no flash of the wrong theme on launch");
// ...and it has to resolve to the value the app actually wrote. The app saves
// through lsSet, which JSON-encodes, so storage holds "dark" WITH quotes; the
// boot script read it raw and compared to dark, which silently never matched.
// The check above passed throughout: ordering was right, the comparison was not.
ok("the boot script decodes what the app wrote",
   /raw\.charAt\(0\) === '"' \? raw\.slice\(1, -1\) : raw/.test(html),
   "lsSet JSON-encodes, so a raw read never equals \"dark\" and every load flashes light");
ok("the theme is saved through the JSON helper",
   /lsSet\("rl-theme", next\)/.test(js),
   "the pair above only holds while both halves agree on the encoding");
ok("all three modes are offered",
   /THEME_MODES = \[[\s\S]*?"light"[\s\S]*?"dark"[\s\S]*?"auto"[\s\S]*?\];/.test(js),
   "light, dark and follow-the-device");
// One control in the header, cycling light → dark → auto. Icon only: sun, moon
// and half-circle read at a glance, and the words stay in the title and the
// aria-label, where a screen reader and a hover can still reach them.
ok("the theme control is a single header button",
   /id="themeBtn"/.test(html) && /cycleTheme/.test(js) && !/id="themeSeg"/.test(html));
ok("its icon comes from the same list it cycles",
   /const \[, label, icon\] = THEME_MODES\[i\]/.test(js) && /class="tico"/.test(js),
   "a typed icon is an icon that can disagree with the mode");
ok("it carries no visible label, but is still labelled",
   !/\$\{icon\}<\/svg><span>/.test(js) && /setAttribute\("aria-label", btn\.title\)/.test(js),
   "icons alone in the row, words for anyone who hovers or listens");
ok("the button says where the next press goes",
   /Switch to \$\{THEME_MODES\[\(i \+ 1\)/.test(js));
// "Auto" is a decision made elsewhere, so it has to say what it resolved to —
// otherwise a dark app on a bright afternoon looks like a bug.
ok("auto says what it is currently following",
   /your device is dark right now/.test(js) && /your device is light right now/.test(js));
ok("a device that changes appearance redraws the charts",
   /matchMedia\("\(prefers-color-scheme: dark\)"\)\.addEventListener/.test(js)
     && /themeMode\(\) === "auto"/.test(js));
// Browser controls (select popups, date pickers, scrollbars) are painted by the
// browser, not by this stylesheet. color-scheme is the only thing that flips them.
ok("the browser's own controls follow the theme",
   // The semicolon is what tells a declaration from the "prefers-color-scheme"
   // media query and the two matchMedia calls in the script.
   /color-scheme: light;/.test(flat) && (flat.match(/color-scheme: dark;/g) || []).length === 2,
   "one for an explicit dark choice, one for a dark device");

// A <button> does not inherit colour from the page. Any rule that gives one a
// background must give it a colour too, or it falls back to the browser's own
// button text — which is black, on whatever you just painted.
{
  const btnClasses = new Set();
  [...html.matchAll(/<button[^>]*class="([^"]+)"/g)].forEach((m) =>
    m[1].split(/\s+/).forEach((cls) => { if (/^[a-z][a-z0-9-]*$/.test(cls)) btnClasses.add(cls); }));
  const styleBlock = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const bad = [];
  [...styleBlock.matchAll(/([^{}]+)\{([^}]*)\}/g)].forEach(([, sel, body]) => {
    // Base rules only: a :hover or .on rule inherits the colour from its base.
    const target = sel.trim();
    if (!/^\.[a-z][a-z0-9-]*$/.test(target)) return;
    if (!btnClasses.has(target.slice(1))) return;
    if (/background:(?!\s*none)/.test(body) && !/(^|;)\s*color:/.test(body)) bad.push(target);
  });
  ok("every button rule that paints a background also sets a colour", bad.length === 0,
     bad.join(", ") || btnClasses.size + " button classes checked");
}
// Order in the row is deliberate: view controls together, then settings.
{
  const btns = html.slice(html.indexOf('<div class="btns">'), html.indexOf("</header>"));
  const order = ["ratesBtn", "dispCur", "themeBtn", "setMenuBtn", "addRentalBtn"]
    .map((id) => btns.indexOf('id="' + id + '"'));
  ok("the header controls stay in their intended order", order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])),
     "rates, currency, appearance, settings, + Rental");
}
ok("auto really hands the decision back to the device",
   /delete document\.documentElement\.dataset\.theme/.test(js)
     && /prefers-color-scheme: dark/.test(html),
   "storing a resolved value instead would freeze the app at whatever it was that day");
ok("the charts are redrawn when the theme changes", /if\(DATA\) render\(\)/.test(bodyOf("applyTheme")),
   "Chart.js reads the palette once, at draw time — the page would go dark and the bars would not");
// Every colour must come from the palette, or it cannot follow the theme.
{
  const styleBlock = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const afterPalette = styleBlock.slice(styleBlock.indexOf("*{box-sizing"));
  // Values only: "#addCur{" is a selector, and its "#add" is not a colour.
  const values = [...afterPalette.matchAll(/[a-z-]+\s*:\s*([^;{}]+)/g)].map((m) => m[1]);
  const hard = values.flatMap((v) => [...v.matchAll(/(#[0-9A-Fa-f]{3,6}\b|rgba?\([^)]*\))/g)].map((m) => m[0]));
  ok("no colour is hardcoded outside the palette", hard.length === 0,
     hard.join(", ") || "every rule reads a token");
  const inline = [...html.matchAll(/style="[^"]*(#[0-9A-Fa-f]{3,6})[^"]*"/g)].map((m) => m[1]);
  ok("no inline style carries a colour either", inline.length === 0, inline.join(", "));
}

// --- knowing which build this is -----------------------------------------
// Every piece of this chain is load-bearing and none of it is visible in a
// browser that has never cached anything.
ok("the page is stamped with its version",
   /name="app-version" content="__APP_VERSION__"/.test(html)
     && /__APP_VERSION__/.test(srvSrc) && /ext === "\.html"/.test(srvSrc),
   "placeholder in the page, substitution in the server");
ok("the version comes from the image, not a file",
   /ARG APP_VERSION/.test(fs.readFileSync(path.join(DIR, "Dockerfile"), "utf8")) &&
   /process\.env\.APP_VERSION/.test(srvSrc));
ok("the version probe is never cached", /"\/api\/version"[\s\S]{0,220}no-store/.test(srvSrc)
   && /cache:"no-store"/.test(js), "a cached answer about staleness is worthless");
ok("index.html is never cached", /Cache-Control"\] = "no-cache"/.test(srvSrc),
   "so a redeploy cannot leave a stale UI reading a newer API");
ok("the check button answers either way", /Up to date/.test(js) && /No connection/.test(js),
   "a button that does nothing visible reads as broken");


// --- showing money in another currency -----------------------------------
// One formatter. Two places formatting money is how one column ends up in
// dollars and the next in pesos.
ok("money is formatted in one place, plus the as-paid one",
   (js.match(/style:\s*"currency"/g) || []).length === 3 // fmtMoney, curSymbol's probe, inCur
     && /const money0 = n => fmtMoney/.test(js) && /const money2 = n => fmtMoney/.test(js));
// AS PAID WINS: a line paid MX$4,700 shows exactly that in the MXN view rather
// than being converted out and back at today's rate into MX$4,698.
ok("a line paid in the currency you are viewing shows what was paid",
   /const lineAmount = r => r\.currency === dispCode\(\) \? inCur\(r\.amount, r\.currency\) : money2\(r\.amountBase\)/.test(js));
ok("and what was paid is shown beside the total when it differs",
   /class="orig"/.test(js) && /inCur\(r\.amount, r\.currency\)/.test(js));
// The rate is frozen onto the row at entry. Editing a rate in Settings later
// must never restate a payment that already happened.
ok("a line keeps the rate it was entered at",
   /existing && existing\.currency === code \? existing\.fx : cur\.rate/.test(srvSrc)
     && /frozen onto this line/.test(js));
ok("the base currency's own lines are never converted",
   /const fx = code === base \? 1 :/.test(srvSrc));
ok("no view hardcodes a currency", !/currency:\s*"[A-Z]{3}"/.test(js) && !/"\$" \+/.test(js),
   "every figure goes through money0/money2");
// One shared axis helper, used by every money chart — the category breakdown
// has no axis at all now, it has names.
ok("the charts convert their labels too", /const axisMoney/.test(js)
   && /moneyAxes = \(\) =>[\s\S]{0,400}callback:axisMoney/.test(js),
   "an axis in one currency beside bars in another is worse than no axis");
// The ledger is grouped by day, and the month a fiscal year is worked out from
// is DERIVED from that date rather than typed beside it.
ok("lines are grouped under their date",
   /class="dayhead"/.test(js) && /const dayLabel/.test(js));
ok("the month comes from the date, never from a second field",
   (srvSrc.match(/month: b\.date\.slice\(0, 7\)/g) || []).length === 2
     && /rec\.month = b\.date\.slice\(0, 7\)/.test(srvSrc),
   "two fields that can disagree about when a payment happened is one too many");
// Expenses by category, as bars: a chart needed a legend and a hover to answer
// "which is the biggest", and the answer is the point.
ok("the breakdown is bars with names on them",
   /class="brow"/.test(js) && /class="bar"/.test(js) && !/chartCats/.test(html),
   "every bar carries its category's icon, colour and share");
// Card and KPI titles carry a drawn icon — an emoji is a different glyph on
// every platform and cannot take the colour of the text beside it.
ok("titles are labelled with drawn icons",
   /const KICON = \{/.test(js) && /const kicon = /.test(js) && /class="h2ico"/.test(js));
// The display currency is a VIEW. Nothing about it may reach the store.
ok("switching display currency is a render, never a write",
   /DISPLAY = e\.target\.value === baseCur\(\) \? null : e\.target\.value;\s+render\(\);/.test(js)
     && !/post\([^)]*DISPLAY/.test(js),
   "the ledger is recorded in the base currency and stays there");
ok("the conversion is stated on screen while it is happening",
   /id="convBar"/.test(html) && /recorded<\/b> in \$\{esc\(baseCur\(\)\)\}/.test(js),
   "figures that are not the ones on disk must say so");
// Lift the formatter out and run it. This is the arithmetic every figure on
// screen passes through, so a mistake here is wrong money everywhere at once.
{
  const grab = (re) => (js.match(re) || [""])[0];
  const src = [
    grab(/const currencies = \(\)[^\n]*\n/),
    grab(/const baseCur = \(\)[^\n]*\n/),
    grab(/const curSymbol = code => \{[\s\S]*?\n\};/),
    js.slice(js.indexOf("const dispCode = ()"), js.indexOf("const pct ")),
  ].join("\n");
  const DATA = { settings: { baseCurrency: "USD", currencies: [
    { code: "USD", symbol: "$", rate: 1 },
    { code: "MXN", symbol: "MX$", rate: 18 },
  ] } };
  const make = (DISPLAY) => new Function("DATA", "DISPLAY", src + "\nreturn {money0,money2,dispRate};")(DATA, DISPLAY);
  const snapshot = JSON.stringify(DATA);

  ok("the base view shows the figures as stored", make(null).money0(1450) === "$1,450",
     "no conversion at all when you are looking at the base");
  ok("another currency converts at its stored rate", make("MXN").money0(1450) === "MX$26,100",
     "1,450 x 18 — and the symbol comes from the same row as the rate");
  ok("cents survive the conversion", make("MXN").money2(10.5) === "MX$189.00");
  ok("the display rate is the row's rate", make("MXN").dispRate() === 18 && make(null).dispRate() === 1);
  ok("converting never mutates the store", JSON.stringify(DATA) === snapshot,
     "the ledger is recorded in the base currency and must stay byte-for-byte that");
}

// The global input rule stretches every select to 100%, which put the picker on
// a line of its own and pushed the settings button off the row.
ok("the display picker is sized to its content", /#dispCur\{width:auto/.test(flat),
   "or the global input rule stretches it across the header");

ok("a deleted currency cannot stay selected",
   /if\(DISPLAY && !codes\.includes\(DISPLAY\)\) DISPLAY = null/.test(js),
   "or the view converts at a rate that no longer exists");

// The chart library is vendored so the app renders with no internet at all.
ok("Chart.js is vendored, not fetched from a CDN",
   /<script src="\/chart\.umd\.min\.js">/.test(html) && !/<script src="https?:/.test(html));
ok("ships chart.umd.min.js", fs.existsSync(path.join(DIR, "public", "chart.umd.min.js")));

// ---------------------------------------------------------------- the ledger
// One list, not two. Income and expenses are the same account read in date
// order; two cards meant looking in two places to see what a month did, and
// left a tall list beside a short one.
ok("the rental page has one ledger",
   /id="properties"/.test(html) && !/id="propExpenses"/.test(html)
     && (js.match(/<h2>\$\{kicon\(KICON\.flow, "--profit"\)\} Ledger<\/h2>/g) || []).length === 1,
   "one card, one heading, one list");
ok("the ledger is cleared when no rental is open",
   /if\(!a\)\{ host\.innerHTML = ""; return; \}/.test(js),
   "or a deleted rental leaves its lines on screen");
ok("the ledger listener is delegated on the view",
   /getElementById\("propertyView"\)\.addEventListener\("click"/.test(js)
     && /getElementById\("propertyView"\)\.addEventListener\("keydown"/.test(js));

// The kind is settled by which button is pressed, so the window never asks.
// Each button is tinted with the colour its lines are shown in.
ok("both kinds have their own add button",
   /class="kbtn in"\s+data-act="new" data-kind="income"/.test(js)
     && /class="kbtn out" data-act="new" data-kind="expenses"/.test(js),
   "the button carries the kind, not a picker inside the dialog");
["in", "out"].forEach((k) => {
  ok(`the ${k === "in" ? "income" : "expense"} button is tinted, not filled`,
     new RegExp(`\\.kbtn\\.${k}\\{background:var\\(--${k}-soft\\);border-color:var\\(--${k}-line\\);color:var\\(--${k}-ink\\)\\}`).test(flat),
     "a wash, a border and a text colour — all three from the palette");
});
// Those three tokens must exist in every palette; the light/dark comparison
// further up only checks that the lists match, not that they are populated.
["in-soft", "in-line", "in-ink", "out-soft", "out-line", "out-ink"].forEach((t) => {
  ok(`--${t} is defined`, new RegExp(`--${t}:\\s*[^;]+;`).test(html),
     "or the button loses its colour and reads as a plain outline");
});

// A mixed list needs three things to stay readable: a sign, a colour and an
// icon. Without the sign, "160" and "-160" look like the same fact.
ok("expense lines are signed and coloured apart from income",
   /const sign = kind === "expenses" \? "\\u2212" : "\+";/.test(js)
     && /class="amt \$\{kind === "expenses" \? "out" : "in"\}"/.test(js)
     && /\.lrow \.amt\.in\{color:var\(--in-ink\)\}/.test(flat)
     && /\.lrow \.amt\.out\{color:var\(--out-ink\)\}/.test(flat),
   "the -ink pair, not the chart fills: --income at 2.8:1 on paper is a figure you squint at");
// Income has no category, so its icon and colour live beside the ones it is
// shown among rather than being typed into the row.
ok("income has one icon, declared with the categories",
   /const INCOME_MARK = \{ icon:"[^"]+", color:"#[0-9A-Fa-f]{6}" \};/.test(js)
     && /const mark = cat \|\| INCOME_MARK;/.test(js),
   "or the ledger and the breakdown can disagree about what income looks like");

// The chips are a reading mode. Filtering the list must never reach the totals:
// the KPI row, the charts and the tax are the year, whatever is on screen.
ok("the chips filter the list and nothing else",
   /LFILTER = t\.dataset\.filter; renderPropertyCard\(VIEW\)/.test(js)
     && /\.filter\(x => LFILTER === "all" \|\| LFILTER === x\.kind\)/.test(js),
   "only the ledger re-renders, so no total can move with a chip");
ok("the filter never reaches the server",
   !/LFILTER/.test(srvSrc) && !/filter=/.test(js.match(/fetch\("\/api[^)]*\)/g)?.join("") || ""),
   "it is a view, like the display currency");
ok("an empty ledger says why it is empty",
   /const EMPTY_LEDGER = \{[\s\S]*?all:[\s\S]*?income:[\s\S]*?expenses:[\s\S]*?\};/.test(js)
     && /EMPTY_LEDGER\[LFILTER\]/.test(js),
   "\"no expenses\" while the income chip is on would be a lie");

// The charts that summarise the ledger sit beside it, so a tall list never has
// an empty half-page next to it.
ok("the ledger's charts share its row",
   /id="catBars"[\s\S]{0,400}id="chartMonthlyProp"/.test(html)
     && /\.propmain\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/.test(flat));

// ---------------------------------------------------- the amount field
// The symbol used to be positioned absolutely over a 20px gutter, which fits
// "$" and puts "MX$" on top of the number. A flex child takes the room it
// needs, so any symbol pushes the figure along instead.
ok("the currency symbol cannot overlap the amount",
   /\.amtwrap\{display:flex/.test(flat)
     && /\.amtwrap \.cur\{[^}]*flex:none;white-space:nowrap\}/.test(flat)
     && !/\.amtwrap \.cur\{position:absolute/.test(flat)
     && !/\.amtwrap input\{padding-left/.test(flat),
   "a three-character symbol like MX$ has to fit beside the figure, not over it");

// ------------------------------------------------------ title icons
// Every card and dialog heading carries a drawn icon. The ones JS rewrites go
// through setTitle, which re-applies the icon; the ones it never rewrites carry
// it as a data-icon attribute. Both read the same KICON list, so there is one
// place to change a glyph and no title can quietly lose one.
ok("titles that JS rewrites keep their icon",
   /const TITLE_ICON = \{/.test(js) && /const setTitle = \(id, text, icon\)/.test(js)
     && !/Title"\)\.textContent =/.test(js),
   "a textContent write would drop the icon on the next render");
ok("titles JS never rewrites carry one too",
   /const paintStaticTitles = /.test(js) && /paintStaticTitles\(\);/.test(js)
     && /querySelectorAll\("\[data-icon\]"\)/.test(js));
[...html.matchAll(/data-icon="([a-z]+)"/g)].map((m) => m[1]).forEach((name) => {
  ok(`the "${name}" icon exists`, new RegExp(`\\n  ${name}:\\s*\``).test(js),
     "a heading naming an icon that is not in KICON silently renders no icon");
});
{
  // Every heading with an id the app sets must be in TITLE_ICON, or it would
  // come back bare the first time it is rewritten.
  const block = (js.match(/const TITLE_ICON = \{([\s\S]*?)\};/) || [])[1] || "";
  [...js.matchAll(/setTitle\("([A-Za-z]+)"/g)].map((m) => m[1]).forEach((id) => {
    ok(`${id} has an icon`, block.includes(id + ":") || id === "lineTitle",
       "in TITLE_ICON, or passed one at the call site as lineTitle is");
  });
}

// ------------------------------------------- what a new line starts in
// A setting, not a guess. Remembering the last currency used would change under
// you; a stored default is visible in one place and stays put.
ok("a new line opens in the default for its kind",
   /defaultCurrency: \{ income: "USD", expenses: "USD" \}/.test(srvSrc)
     && /const defaultCurFor = kind =>/.test(js)
     && /liCur"\)\.value = defaultCurFor\(kind\)/.test(js),
   "and both ship as the base — a template must not assume anyone's country");
ok("both defaults are settable",
   /id="defIncome"/.test(html) && /id="defExpense"/.test(html)
     && /function drawEntryDefaults\(list\)/.test(js)
     && /defaultCurrency: \{\s*income:\s*document\.getElementById\("defIncome"\)\.value/.test(js));
ok("a default is backfilled and checked against the list",
   /data\.settings\.defaultCurrency = \{ income: pick\(d\.income\), expenses: pick\(d\.expenses\) \}/.test(srvSrc)
     && /if \(!codes\.includes\(code\)\) return sendJSON\(res, 400, \{ error: "unknown currency: " \+ code \}\)/.test(srvSrc),
   "a store written before this existed must come back with both, and a deleted currency must not stay selected");
ok("the page falls back when the stored default is gone",
   /return currencies\(\)\.some\(x => x\.code === code\) \? code : baseCur\(\);/.test(js));

// A page with no icon asks the browser for /favicon.ico and logs a 404 on every
// load. Inlined, so it costs no request and works with no internet.
ok("the page carries its own icon",
   /<link rel="icon" href="data:image\/svg\+xml,/.test(html),
   "or every load ends with a 404 in the console");

// Nothing in a public template should name the author's machines or households.
["rpi5", "raspberry", "satori", "homakah", "homa kah"].forEach(word => {
  ok(`no "${word}" left in the page`, !new RegExp(word, "i").test(html),
     "this repo is public — the template must not describe one person's setup");
});

// ------------------------------------------------------------------ done
console.log("\n" + (fails ? fails + " FAILURE" + (fails > 1 ? "S" : "") : "All checks passed") + "\n");
process.exit(fails ? 1 : 0);
