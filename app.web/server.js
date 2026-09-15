// =============================================================
//  Rental Tracker — tiny backend
//  Serves the SPA and persists all data to JSON files on disk.
//  No external runtime deps: uses only Node's built-in http/fs.
//  Data lives in ./data/data.json (mount this dir as a volume).
// =============================================================

const http = require("http"); // built-in HTTP server (no Express needed)
const fs = require("fs"); // file system for JSON persistence
const path = require("path"); // safe path joining
const crypto = require("crypto"); // for generating record ids

// --- Paths & config ---
const PORT = process.env.PORT || 8099; // app port (override via env)
// Stamped in at build time from the git tag that produced the image (see the
// Dockerfile's ARG APP_VERSION) — never from a file anyone has to remember to
// edit. A local run with no env var says "dev", which is also the truth.
const APP_VERSION = process.env.APP_VERSION || "dev";
const ROOT = __dirname; // project root
const PUBLIC_DIR = path.join(ROOT, "public"); // static assets (SPA)
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data"); // persistent data dir
const DATA_FILE = path.join(DATA_DIR, "data.json"); // main data store
const BACKUP_DIR = path.join(DATA_DIR, "backups"); // timestamped backups

// --- Default empty store ---
// A fresh install has NO rentals: the app asks for the first one rather than
// shipping someone else's property names as data you have to clear out.
// A rental is { id, name, color, links:{airbnb,dashboard,internet}, note }.
const DEFAULT_DATA = {
  apartments: [],
  // App-wide settings. Kept in the store rather than in the browser so the rates
  // are the same on every device — two devices quietly estimating tax at two
  // different rates is exactly the kind of wrong number this app exists to avoid.
  //
  // rate = how many units of that currency one unit of the BASE is worth, so the
  // base is always pinned at 1. Only GBP is consumed today (by the optional tax
  // estimator); the others are kept current for reference and for the display
  // currency that arrives when the app's own currency stops being hard-coded.
  settings: {
    baseCurrency: "USD",
    // Which currency a NEW line starts in, per kind. Rent usually arrives in
    // the base currency while bills are usually paid locally, and typing the
    // same wrong currency every time is how a figure ends up off by the rate.
    // Both ship as the base — a template must not assume anyone's country —
    // and each is set in Currencies & rates.
    defaultCurrency: { income: "USD", expenses: "USD" },
    currencies: [
      { code: "USD", symbol: "$", rate: 1 },
      { code: "GBP", symbol: "£", rate: 0.79 },
      { code: "MXN", symbol: "MX$", rate: 18 },
      { code: "EUR", symbol: "€", rate: 0.92 },
    ],
  },
  // The people the profit is split between. Empty on a fresh install, like the
  // rentals: two names baked into the source would be someone else's household
  // for every other person who runs this.
  //   { id, name, color, share }   share = % of net profit, 0-100
  people: [],
  // taxRates keyed by fiscal year "YYYY-YYYY" -> { <person id>: % }. Per year
  // because a marginal rate is a fact about a year, not about a person.
  taxRates: {},
  income: [], // { id, apartment, month:"YYYY-MM", amount, note }
  expenses: [], // { id, apartment, month:"YYYY-MM", category, amount, note }
};

// --- Ensure data dir + file exist on boot ---
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); // create data dir
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); // create backups dir
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2)); // seed empty store
  }
}

// --- Read whole store ---
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8"); // read file
    const parsed = JSON.parse(raw); // parse JSON
    // Backfill any missing top-level keys (forward-compat with older files).
    // settings needs its OWN merge: a spread at the top level would replace the
    // whole object, so a store written before a setting existed would come back
    // without it — and the UI would render an empty currency list rather than
    // fail, which is the silent kind of wrong.
    const data = { ...DEFAULT_DATA, ...parsed };
    data.settings = { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) };
    // Rentals gained colour, links and a note after the first stores were
    // written. Fill them in rather than letting the UI read undefined.links.
    data.apartments = (Array.isArray(data.apartments) ? data.apartments : []).map((a, i) => ({
      id: a.id,
      name: a.name,
      color: validColor(a.color) ? a.color : DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      links: { airbnb: "", dashboard: "", internet: "", ...(a.links || {}) },
      note: String(a.note || ""),
    }));
    // People arrived after the first stores were written, where the owners were
    // two ids baked into the source and taxRates was keyed by them. Derive the
    // list from the keys the store itself used, so the names come from the
    // person's own data and nothing is invented here.
    data.people = (Array.isArray(data.people) ? data.people : []).map((p, i) => ({
      id: p.id,
      name: String(p.name || "").slice(0, 60),
      color: validColor(p.color) ? p.color : DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      share: Number.isFinite(Number(p.share)) ? Math.min(100, Math.max(0, Number(p.share))) : 0,
    })).filter((p) => p.id && p.name);
    if (!data.people.length) {
      const legacy = [...new Set(Object.values(data.taxRates || {}).flatMap((r) => Object.keys(r || {})))];
      data.people = legacy.map((id, i) => ({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        // Equal shares, because that is the only split the old store could express.
        share: Math.round((100 / legacy.length) * 10) / 10,
      }));
    }
    // A rate for someone who is not in the list is a figure no view can label.
    {
      const ids = new Set(data.people.map((p) => p.id));
      const rates = {};
      for (const [fy, row] of Object.entries(data.taxRates || {})) {
        const kept = {};
        for (const [id, pct] of Object.entries(row || {})) {
          if (ids.has(id) && Number.isFinite(Number(pct))) kept[id] = Number(pct);
        }
        if (Object.keys(kept).length) rates[fy] = kept;
      }
      data.taxRates = rates;
    }
    if (!Array.isArray(data.settings.currencies) || !data.settings.currencies.length) {
      data.settings.currencies = DEFAULT_DATA.settings.currencies;
    }
    // Same field-by-field rule as settings itself: a store written before
    // per-kind defaults existed must come back with both, and a default naming
    // a currency that has since been deleted falls back to the base rather than
    // opening the dialog on a rate that no longer exists.
    {
      const codes = data.settings.currencies.map((c) => c.code);
      const base = data.settings.baseCurrency;
      const d = data.settings.defaultCurrency || {};
      const pick = (v) => (codes.includes(String(v || "").toUpperCase()) ? String(v).toUpperCase() : base);
      data.settings.defaultCurrency = { income: pick(d.income), expenses: pick(d.expenses) };
    }
    // Rows once carried a month and a bare amount, in the base currency by
    // assumption. Give them a date (the 1st, the only honest guess), the base
    // currency and a rate of 1 — so every row in the store has one shape and no
    // view has to ask whether a field is there.
    const base = data.settings.baseCurrency;
    const forward = (r) => {
      const date = validDate(r.date) ? r.date : (validMonth(r.month) ? r.month + "-01" : null);
      if (!date) return null;                       // not a row this app wrote
      const amount = Number(r.amount) || 0;
      const currency = String(r.currency || base).toUpperCase();
      const fx = Number(r.fx) > 0 ? Number(r.fx) : 1;
      return { ...r, date, month: date.slice(0, 7), amount, currency, fx,
               amountBase: Number.isFinite(Number(r.amountBase)) ? Number(r.amountBase) : Math.round((amount / fx) * 100) / 100 };
    };
    data.income = (Array.isArray(data.income) ? data.income : []).map(forward).filter(Boolean);
    data.expenses = (Array.isArray(data.expenses) ? data.expenses : []).map(forward).filter(Boolean)
      // A category that predates the whitelist lands in "other" rather than
      // vanishing from the breakdown.
      .map((r) => ({ ...r, category: CATEGORIES.includes(String(r.category || "").toLowerCase())
        ? String(r.category).toLowerCase() : "other" }));

    // One earlier shape existed: a single fxUsdGbp number. Carry it onto GBP so
    // a rate someone set by hand is not silently reset to the default.
    const legacy = Number(data.settings.fxUsdGbp);
    if (Number.isFinite(legacy) && legacy > 0) {
      data.settings.currencies = data.settings.currencies.map((c) =>
        c.code === "GBP" ? { ...c, rate: legacy } : c);
      delete data.settings.fxUsdGbp;
    }
    return data;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_DATA)); // fall back to empty
  }
}

// --- Write whole store (atomic + keep a rolling backup) ---
function writeData(data) {
  const tmp = DATA_FILE + ".tmp"; // temp file for atomic replace
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); // write temp
  // Keep a timestamped backup BEFORE overwriting, so we can roll back
  if (fs.existsSync(DATA_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-"); // filesystem-safe stamp
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `data-${stamp}.json`)); // snapshot
    pruneBackups(30); // keep only the 30 most recent snapshots
  }
  fs.renameSync(tmp, DATA_FILE); // atomic swap into place
}

// --- Keep backups bounded ---
function pruneBackups(keep) {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("data-") && f.endsWith(".json"))
    .sort(); // lexical sort == chronological (ISO stamps)
  while (files.length > keep) {
    const old = files.shift(); // oldest first
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, old)); // delete it
    } catch (_) {}
  }
}

// Expense categories. A whitelist rather than free text, so every stored row
// has a label, an icon and a colour to be drawn with — and a typo cannot create
// a category that exists in exactly one row and is never seen again.
// ids are written onto stored rows: renaming one is a data migration.
const CATEGORIES = ["internet", "hoa", "fideicomiso", "utilities", "maintenance",
                    "management", "insurance", "other"];

// --- Helpers ---
const id = () => crypto.randomBytes(6).toString("hex"); // short random id

// The swatches the UI offers. Kept here so a rental created through the API
// without a colour still gets one that belongs to the palette.
const DEFAULT_COLORS = ["#2F6F62","#B5654A","#8556B3","#56B3AA","#85B356","#3D3399","#99337A","#479933"];

// Strict number parsing for money/percent fields.
// The old pattern `Number(x) || 0` silently turned junk into $0:
//   Number("1,200") -> NaN -> 0     (comma typo loses $1,200!)
//   Number("12a")   -> NaN -> 0
//   Number("")      -> 0
// Now junk returns null and the route answers 400 instead of corrupting the ledger.
//   required=true  : blank is an error (amounts — an empty amount is meaningless)
//   required=false : blank means 0 (tax-% fields, where empty = 0 by design)
function parseNum(v, required) {
  if (v === null || v === undefined || String(v).trim() === "") {
    return required ? null : 0; // blank: reject for amounts, 0 for rates
  }
  const n = Number(v); // strict conversion — no comma stripping, no partial parses
  return Number.isFinite(n) ? n : null; // NaN/Infinity -> null (rejected by caller)
}

// A link is rendered as an <a href>, so the scheme is a security boundary and
// not a formatting preference: javascript: and data: URLs in an href execute.
// Only http(s) is stored; anything else is refused rather than quietly dropped.
function cleanUrl(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return ""; // blank is a valid answer — most rentals have no dashboard
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return null; // not a URL at all
  }
  return u.protocol === "http:" || u.protocol === "https:" ? raw.slice(0, 500) : null;
}

// A colour ends up inside a style attribute and in chart config, so it is
// whitelisted to a plain hex rather than passed through.
const validColor = (c) => /^#[0-9A-Fa-f]{6}$/.test(String(c || ""));

// "YYYY-MM" validation — the shape a fiscal year is worked out from.
const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));
// "YYYY-YYYY", consecutive — the key tax percentages are filed under. A typo
// here would put a rate in a year no view ever looks at.
const validFY = (fy) => {
  const m = /^(\d{4})-(\d{4})$/.exec(String(fy || ""));
  return !!m && Number(m[2]) === Number(m[1]) + 1;
};
// "YYYY-MM-DD" — the exact shape <input type="date"> submits. Checked as a real
// date, so 2026-02-31 is refused rather than stored and silently rolled over.
function validDate(d) {
  const str = String(d || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const dt = new Date(str + "T00:00:00Z");
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === str;
}

// A line item's money. `amount` is what was ACTUALLY PAID, in `currency`; `fx`
// is the rate at the moment it was entered, and `amountBase` is what that came
// to in the base currency. The rate is frozen onto the row on purpose: editing
// a rate in Settings later must never restate a payment that already happened.
function buildMoney(b, settings, existing) {
  const base = settings.baseCurrency;
  const amount = parseNum(b.amount !== undefined ? b.amount : existing && existing.amount, true);
  if (amount === null) return { error: "amount is not a number" };
  if (amount < 0) return { error: "amount cannot be negative" };

  const code = String((b.currency !== undefined ? b.currency : (existing && existing.currency) || base)).toUpperCase();
  const cur = settings.currencies.find((c) => c.code === code);
  // A currency with no rate could never be converted — it would be a hole in
  // every total. Refused rather than invented.
  if (!cur) return { error: "unknown currency: " + code };

  // An explicit fx wins (an edit may correct the rate a payment was made at);
  // otherwise keep the row's own, or take today's from settings.
  const fxRaw = b.fx !== undefined ? b.fx : (existing && existing.currency === code ? existing.fx : cur.rate);
  const fx = code === base ? 1 : parseNum(fxRaw, true);
  if (fx === null || fx <= 0) return { error: "rate must be a positive number" };

  return { value: { amount, currency: code, fx, amountBase: Math.round((amount / fx) * 100) / 100 } };
}

// Validate and normalise a rental, for both create and edit. Returns
// { value } or { error } so the caller answers 400 with something specific —
// "rental name is required" beats "bad request" when you are looking at a form.
// Validate and normalise a person, for both create and edit. `others` is the
// rest of the list: a new person is offered whatever is left of 100% rather
// than a number that makes the shares add up to something impossible.
function buildPerson(b, existing, list) {
  const name = String((b && b.name) || (existing && existing.name) || "").trim();
  if (!name) return { error: "a person needs a name" };
  if (name.length > 60) return { error: "that name is too long (60 characters)" };

  const others = (list || []).filter((p) => !existing || p.id !== existing.id);
  const color = (b && b.color) || (existing && existing.color) || DEFAULT_COLORS[others.length % DEFAULT_COLORS.length];
  if (!validColor(color)) return { error: "colour must be a hex value like #2F6F62" };

  const taken = others.reduce((t, p) => t + p.share, 0);
  const raw = b && b.share !== undefined ? b.share
    : existing ? existing.share
    : Math.max(0, Math.round((100 - taken) * 10) / 10);   // what is left, for a new person
  const share = parseNum(raw, false);
  // The shares are allowed not to total 100 — the UI says so rather than
  // refusing a save half-way through re-dividing them between three people.
  // What is refused is a share that is not a percentage at all.
  if (share === null) return { error: "share is not a number" };
  if (share < 0 || share > 100) return { error: "share must be between 0 and 100" };

  return { value: { id: (existing && existing.id) || id(), name, color, share: Math.round(share * 10) / 10 } };
}

function buildApartment(b, existing) {
  const name = String((b && b.name) || "").trim();
  if (!name) return { error: "a rental needs a name" };
  if (name.length > 60) return { error: "that name is too long (60 characters)" };

  const color = (b && b.color) || (existing && existing.color) || DEFAULT_COLORS[0];
  if (!validColor(color)) return { error: "colour must be a hex value like #2F6F62" };

  const links = {};
  for (const key of ["airbnb", "dashboard", "internet"]) {
    const given = b && b.links ? b.links[key] : undefined;
    const raw = given === undefined && existing ? existing.links[key] : given;
    const url = cleanUrl(raw);
    if (url === null) return { error: `the ${key} link must start with http:// or https://` };
    links[key] = url;
  }

  const noteRaw = b && b.note !== undefined ? b.note : existing && existing.note;
  return {
    value: {
      id: existing ? existing.id : id(),
      name,
      color,
      links,
      note: String(noteRaw || "").slice(0, 1000),
    },
  };
}

// Read & parse a JSON request body, with a sane size cap.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ""; // accumulator
    req.on("data", (c) => {
      buf += c; // append chunk
      if (buf.length > 1e6) req.destroy(); // 1MB guard against abuse
    });
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {}); // parse or empty object
      } catch (e) {
        reject(e); // bad JSON
      }
    });
  });
}

// Standard JSON response helper.
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj); // serialize
  res.writeHead(code, { "Content-Type": "application/json" }); // headers
  res.end(body); // send
}

// Basic content-type map for static files.
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// --- Static file serving (the SPA + vendored Chart.js) ---
function serveStatic(req, res) {
  let rel = req.url.split("?")[0]; // strip query string
  if (rel === "/") rel = "/index.html"; // default document
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel)); // resolve safely
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "forbidden" }); // path traversal guard
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJSON(res, 404, { error: "not found" }); // 404
    const ext = path.extname(filePath); // pick mime
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    // The page carries its own version so a cached copy knows which build it is.
    if (ext === ".html") data = Buffer.from(String(data).replace(/__APP_VERSION__/g, APP_VERSION));
    // index.html carries the entire app (markup, styles and every line of JS),
    // so a browser-cached copy after a redeploy means the UI and the API can
    // disagree about what fields exist. Revalidate it every time; the vendored
    // Chart.js is genuinely static and stays cacheable.
    if (ext === ".html") headers["Cache-Control"] = "no-cache";
    res.writeHead(200, headers);
    res.end(data); // send file
  });
}

// =============================================================
//  HTTP server / router
// =============================================================
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0]; // path without query

  // ---- API routes ----
  if (url.startsWith("/api/")) {
    try {
      // GET /api/data  -> whole store
      if (url === "/api/data" && req.method === "GET") {
        return sendJSON(res, 200, readData());
      }

      // --- Rentals ---------------------------------------------------------
      // A rental is what every income and expense row is filed under. They are
      // yours to add, rename and remove: nothing about them is hard-coded, and
      // a fresh store has none at all.
      if (url === "/api/apartments" && req.method === "POST") {
        const b = await readBody(req); // { name, color, links, note }
        const rec = buildApartment(b, null);
        if (rec.error) return sendJSON(res, 400, { error: rec.error });
        const data = readData();
        data.apartments.push(rec.value);
        writeData(data);
        return sendJSON(res, 200, rec.value);
      }

      if (req.method === "PUT" && url.startsWith("/api/apartments/")) {
        const id = url.split("/")[3];
        const data = readData();
        const existing = data.apartments.find((a) => a.id === id);
        if (!existing) return sendJSON(res, 404, { error: "rental not found" });
        const rec = buildApartment(await readBody(req), existing);
        if (rec.error) return sendJSON(res, 400, { error: rec.error });
        data.apartments = data.apartments.map((a) => (a.id === id ? rec.value : a));
        writeData(data);
        return sendJSON(res, 200, rec.value);
      }

      // DELETE /api/apartments/:id -> the rental AND everything filed under it.
      // Deliberately a cascade: rows left behind would belong to a rental no
      // view can name, so the money would still be in the totals with nothing
      // to attribute it to. The UI asks for the rental's name first, and the
      // snapshot taken before this write is the way back.
      if (req.method === "DELETE" && url.startsWith("/api/apartments/")) {
        const id = url.split("/")[3];
        const data = readData();
        if (!data.apartments.some((a) => a.id === id)) return sendJSON(res, 404, { error: "rental not found" });
        const income = data.income.filter((r) => r.apartment === id).length;
        const expenses = data.expenses.filter((r) => r.apartment === id).length;
        data.apartments = data.apartments.filter((a) => a.id !== id);
        data.income = data.income.filter((r) => r.apartment !== id);
        data.expenses = data.expenses.filter((r) => r.apartment !== id);
        writeData(data);
        return sendJSON(res, 200, { ok: true, removed: { income, expenses } });
      }

      // POST /api/income  -> add an income payment
      if (url === "/api/income" && req.method === "POST") {
        const b = await readBody(req); // { apartment, date, amount, currency, fx, note }
        if (!validDate(b.date)) return sendJSON(res, 400, { error: "date must be YYYY-MM-DD" });
        const data = readData();
        // A row filed under a rental that does not exist is money no view can
        // show and no total can include — invisible, and silently so.
        if (!data.apartments.some((a) => a.id === b.apartment)) {
          return sendJSON(res, 400, { error: "unknown rental" });
        }
        const money = buildMoney(b, data.settings, null);
        if (money.error) return sendJSON(res, 400, { error: money.error });
        const rec = {
          id: id(),
          apartment: b.apartment, // the rental's id
          date: b.date, // "YYYY-MM-DD" (validated above)
          month: b.date.slice(0, 7), // derived, so the fiscal year is never guessed
          ...money.value, // amount as paid, currency, frozen fx, amountBase
          note: (b.note || "").toString().slice(0, 200), // optional label
        };
        data.income.push(rec); // append
        writeData(data); // persist
        return sendJSON(res, 200, rec);
      }

      // POST /api/expenses  -> add an expense
      if (url === "/api/expenses" && req.method === "POST") {
        const b = await readBody(req); // { apartment, date, category, amount, currency, fx, note }
        if (!validDate(b.date)) return sendJSON(res, 400, { error: "date must be YYYY-MM-DD" });
        const category = String(b.category || "other").toLowerCase();
        // Anything outside the list has no label, no icon and no colour to be
        // drawn with — it would be spend that appears in a total and nowhere else.
        if (!CATEGORIES.includes(category)) return sendJSON(res, 400, { error: "unknown category: " + category });
        const data = readData();
        if (!data.apartments.some((a) => a.id === b.apartment)) {
          return sendJSON(res, 400, { error: "unknown rental" });
        }
        const money = buildMoney(b, data.settings, null);
        if (money.error) return sendJSON(res, 400, { error: money.error });
        const rec = {
          id: id(),
          apartment: b.apartment,
          date: b.date,
          month: b.date.slice(0, 7), // derived
          category,
          ...money.value,
          note: (b.note || "").toString().slice(0, 200),
        };
        data.expenses.push(rec);
        writeData(data);
        return sendJSON(res, 200, rec);
      }

      // ---------------- people the profit is split between ----------------
      if (url === "/api/people" && req.method === "POST") {
        const data = readData();
        const rec = buildPerson(await readBody(req), null, data.people);
        if (rec.error) return sendJSON(res, 400, { error: rec.error });
        data.people.push(rec.value);
        writeData(data);
        return sendJSON(res, 200, rec.value);
      }

      if (req.method === "PUT" && url.startsWith("/api/people/")) {
        const id = url.split("/")[3];
        const data = readData();
        const existing = data.people.find((p) => p.id === id);
        if (!existing) return sendJSON(res, 404, { error: "person not found" });
        const rec = buildPerson(await readBody(req), existing, data.people);
        if (rec.error) return sendJSON(res, 400, { error: rec.error });
        data.people = data.people.map((p) => (p.id === id ? rec.value : p));
        writeData(data);
        return sendJSON(res, 200, rec.value);
      }

      // Removing a person takes their tax percentages with them: a rate filed
      // under someone the store cannot name is a figure no view can label, and
      // it would go on adding to the tax total from nowhere.
      if (req.method === "DELETE" && url.startsWith("/api/people/")) {
        const id = url.split("/")[3];
        const data = readData();
        if (!data.people.some((p) => p.id === id)) return sendJSON(res, 404, { error: "person not found" });
        let years = 0;
        for (const [fy, row] of Object.entries(data.taxRates)) {
          if (row && row[id] !== undefined) {
            delete row[id];
            years++;
            if (!Object.keys(row).length) delete data.taxRates[fy];
          }
        }
        data.people = data.people.filter((p) => p.id !== id);
        writeData(data);
        return sendJSON(res, 200, { ok: true, removed: { years } });
      }

      // POST /api/taxrate  -> the tax % for each person, for one fiscal year
      if (url === "/api/taxrate" && req.method === "POST") {
        const b = await readBody(req); // { fy:"YYYY-YYYY", rates: { <person id>: % } }
        if (!validFY(b.fy)) return sendJSON(res, 400, { error: "fy must look like YYYY-YYYY" });
        const rates = b.rates;
        if (!rates || typeof rates !== "object" || Array.isArray(rates)) {
          return sendJSON(res, 400, { error: "rates must be an object keyed by person id" });
        }
        const data = readData();
        const known = new Set(data.people.map((p) => p.id));
        const clean = {};
        for (const [id, raw] of Object.entries(rates)) {
          if (!known.has(id)) return sendJSON(res, 400, { error: "unknown person: " + id });
          // Blank is 0 by design — "I have not set a rate" and "no tax" are the
          // same estimate. Junk is refused, like every other number here.
          const pct = parseNum(raw, false);
          if (pct === null) return sendJSON(res, 400, { error: "rate is not a number" });
          if (pct < 0 || pct > 100) return sendJSON(res, 400, { error: "rate must be between 0 and 100" });
          clean[id] = pct;
        }
        data.taxRates[b.fy] = { ...(data.taxRates[b.fy] || {}), ...clean };
        writeData(data);
        return sendJSON(res, 200, { fy: b.fy, rates: data.taxRates[b.fy] });
      }

      // GET /api/version  -> what this container actually is.
      // Deliberately tiny and no-store: the page fetches it to find out whether
      // the copy it is running is the one the server would serve now, and a
      // cached answer about staleness is worthless.
      if (url === "/api/version" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ version: APP_VERSION }));
      }

      // POST /api/settings  -> app-wide settings (the currency list).
      // Same strict parser as every other number: a junk rate would silently
      // rescale every tax estimate rather than failing.
      if (url === "/api/settings" && req.method === "POST") {
        const b = await readBody(req); // { currencies: [{code, symbol, rate}] }
        const data = readData();
        if (b.currencies !== undefined || b.baseCurrency !== undefined) {
          const list = b.currencies === undefined ? data.settings.currencies : b.currencies;
          if (!Array.isArray(list) || !list.length) {
            return sendJSON(res, 400, { error: "currencies must be a non-empty list" });
          }
          const base = String(b.baseCurrency || data.settings.baseCurrency).toUpperCase();
          // The base is what every stored figure is DENOMINATED in. Changing it
          // once records exist would relabel every one of them without converting
          // a single figure — $1,450 silently becoming MX$1,450. It is therefore
          // locked as soon as there is anything to mislabel; the header dropdown
          // covers the real need, which is *viewing* in another currency.
          if (base !== data.settings.baseCurrency && (data.income.length || data.expenses.length)) {
            return sendJSON(res, 400, {
              error: `the base currency is locked: ${data.income.length + data.expenses.length} records are stored in ${data.settings.baseCurrency}`,
            });
          }
          const seen = new Set();
          const clean = [];
          for (const c of list) {
            const code = String((c && c.code) || "").toUpperCase();
            if (!/^[A-Z]{3}$/.test(code)) return sendJSON(res, 400, { error: "currency code must be three letters" });
            if (seen.has(code)) return sendJSON(res, 400, { error: "duplicate currency: " + code });
            seen.add(code);
            // The base is the unit every stored figure is already in, so its rate
            // is 1 by definition — accepting anything else would make every
            // conversion in the app disagree with the ledger.
            const rate = code === base ? 1 : parseNum(c.rate, true);
            if (rate === null || rate <= 0) return sendJSON(res, 400, { error: "rate for " + code + " must be a positive number" });
            clean.push({ code, symbol: String((c && c.symbol) || code).slice(0, 4), rate });
          }
          if (!seen.has(base)) return sendJSON(res, 400, { error: "the base currency " + base + " must be in the currency list" });
          data.settings = { ...data.settings, baseCurrency: base, currencies: clean };
        }
        // Per-kind entry defaults. Validated against the list as it is AFTER
        // the block above, so deleting a currency and re-pointing a default can
        // be one save rather than two.
        if (b.defaultCurrency !== undefined) {
          const codes = data.settings.currencies.map((c) => c.code);
          const next = { ...data.settings.defaultCurrency };
          for (const kind of ["income", "expenses"]) {
            if (b.defaultCurrency[kind] === undefined) continue;
            const code = String(b.defaultCurrency[kind]).toUpperCase();
            // A default pointing at a currency with no rate would open the
            // dialog on a figure that cannot be converted.
            if (!codes.includes(code)) return sendJSON(res, 400, { error: "unknown currency: " + code });
            next[kind] = code;
          }
          data.settings = { ...data.settings, defaultCurrency: next };
        }
        writeData(data);
        return sendJSON(res, 200, data.settings);
      }

      // POST /api/rates/refresh -> pull today's rates from the ECB
      //
      // THE ONLY OUTBOUND REQUEST THIS APP EVER MAKES, and only when you press
      // the button — never on a timer, never on boot. It writes nothing but
      // settings.currencies[].rate. Not one stored figure is converted or
      // restated by it: the ledger is in the base currency and stays in it.
      //
      // Frankfurter serves the European Central Bank's daily reference rates:
      // no API key, no account, no tracking, and it publishes one figure per
      // currency per day rather than anything tied to you.
      if (url === "/api/rates/refresh" && req.method === "POST") {
        const data = readData();
        const base = data.settings.baseCurrency;
        const want = data.settings.currencies.map((c) => c.code).filter((c) => c !== base);
        if (!want.length) return sendJSON(res, 200, { ok: true, updated: [], skipped: [], note: "nothing to update" });

        let feed;
        try {
          // 10s ceiling: a hung request must not hold the button in "updating" forever.
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 10000);
          const r = await fetch(
            `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${want.map(encodeURIComponent).join(",")}`,
            { signal: ctl.signal }
          );
          clearTimeout(timer);
          if (!r.ok) return sendJSON(res, 502, { error: `rate service returned ${r.status}` });
          feed = await r.json();
        } catch (e) {
          // Offline, DNS down, blocked egress — say so plainly. A stale rate that
          // looks fresh is worse than an error, so nothing is written here.
          return sendJSON(res, 502, { error: "could not reach the rate service (" + (e.name === "AbortError" ? "timed out" : e.message) + ")" });
        }
        if (!feed || !feed.rates) return sendJSON(res, 502, { error: "rate service sent an unexpected response" });

        // Frankfurter gives "how many X per 1 base", which is exactly how this
        // app stores it — no flipping, and nothing to get backwards. A currency
        // the ECB does not publish keeps the rate you typed rather than a zero.
        const updated = [], skipped = [];
        data.settings.currencies = data.settings.currencies.map((cur) => {
          if (cur.code === base) return { ...cur, rate: 1 }; // the base is always 1
          const perBase = Number(feed.rates[cur.code]);
          if (!Number.isFinite(perBase) || perBase <= 0) { skipped.push(cur.code); return cur; }
          // Two decimals. A tax estimate and a sense-of-scale conversion cannot
          // use more, and a rate you may later edit by hand should be a number
          // you can read. Currencies worth much more than the base (KWD, BHD)
          // are the one place this rounding is coarse enough to notice.
          const rate = Math.round(perBase * 100) / 100;
          if (rate !== cur.rate) updated.push(cur.code);
          return { ...cur, rate };
        });
        writeData(data);
        return sendJSON(res, 200, { ok: true, date: feed.date || null, updated, skipped });
      }

      // DELETE /api/income/:id  and  /api/expenses/:id
      if (req.method === "DELETE" && (url.startsWith("/api/income/") || url.startsWith("/api/expenses/"))) {
        const parts = url.split("/"); // ["", "api", "income", "<id>"]
        const kind = parts[2]; // "income" | "expenses"
        const recId = parts[3]; // record id
        const data = readData();
        const before = data[kind].length; // count before
        data[kind] = data[kind].filter((r) => r.id !== recId); // drop it
        writeData(data);
        return sendJSON(res, 200, { removed: before - data[kind].length });
      }

      // PUT /api/income/:id  and  /api/expenses/:id  -> edit a record in place.
      // Only fields present in the body are changed; same validation as POST,
      // so an edit can't sneak a NaN amount past the strict parser either.
      if (req.method === "PUT" && (url.startsWith("/api/income/") || url.startsWith("/api/expenses/"))) {
        const parts = url.split("/"); // ["", "api", "income", "<id>"]
        const kind = parts[2]; // "income" | "expenses"
        const recId = parts[3]; // record id
        const b = await readBody(req); // partial record: any of date/amount/currency/fx/note/category
        const data = readData();
        const rec = data[kind].find((r) => r.id === recId); // locate in place (mutated below)
        if (!rec) return sendJSON(res, 404, { error: "record not found" });
        if (b.amount !== undefined || b.currency !== undefined || b.fx !== undefined) {
          const money = buildMoney(b, data.settings, rec); // same strict rules as POST
          if (money.error) return sendJSON(res, 400, { error: money.error });
          Object.assign(rec, money.value);
        }
        if (b.date !== undefined) {
          if (!validDate(b.date)) return sendJSON(res, 400, { error: "date must be YYYY-MM-DD" });
          rec.date = b.date;
          rec.month = b.date.slice(0, 7); // may move the row to another fiscal year — that is the point
        }
        if (b.note !== undefined) rec.note = (b.note || "").toString().slice(0, 200);
        if (kind === "expenses" && b.category !== undefined) {
          const category = String(b.category || "other").toLowerCase();
          if (!CATEGORIES.includes(category)) return sendJSON(res, 400, { error: "unknown category: " + category });
          rec.category = category;
        }
        writeData(data); // persist (snapshots the previous state first)
        return sendJSON(res, 200, rec);
      }

      // GET /api/backups  -> newest-first list of the server-side rolling snapshots.
      // writeData() has always kept up to 30 of these in DATA_DIR/backups; this
      // endpoint finally surfaces them so the UI can offer a restore button.
      if (url === "/api/backups" && req.method === "GET") {
        const files = fs
          .readdirSync(BACKUP_DIR)
          .filter((f) => /^data-[0-9TZ-]+\.json$/.test(f)) // only our snapshot files
          .sort()
          .reverse(); // ISO stamps: lexical descending == newest first
        const out = files.map((f) => {
          const st = fs.statSync(path.join(BACKUP_DIR, f)); // size + mtime for the UI list
          return { name: f, size: st.size, mtime: st.mtime.toISOString() };
        });
        return sendJSON(res, 200, out);
      }

      // POST /api/restore { name }  -> replace the store with one snapshot.
      // writeData() snapshots the CURRENT store before overwriting, so a
      // restore is itself undoable (it just becomes the newest snapshot).
      if (url === "/api/restore" && req.method === "POST") {
        const b = await readBody(req); // { name: "data-<stamp>.json" }
        const name = String(b.name || "");
        // Whitelist the exact snapshot filename shape — this is the path-traversal
        // guard: only digits/T/Z/hyphens may appear, so "../../data.json" can't match.
        if (!/^data-[0-9TZ-]+\.json$/.test(name)) return sendJSON(res, 400, { error: "bad snapshot name" });
        const file = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(file)) return sendJSON(res, 404, { error: "snapshot not found" });
        let snap;
        try {
          snap = JSON.parse(fs.readFileSync(file, "utf8")); // parse the snapshot
        } catch (e) {
          return sendJSON(res, 400, { error: "snapshot file is not valid JSON" });
        }
        // Same shape validation as /api/import before clobbering anything
        if (!snap || typeof snap !== "object" || !Array.isArray(snap.income) || !Array.isArray(snap.expenses)
            || !Array.isArray(snap.apartments) || typeof snap.taxRates !== "object") {
          return sendJSON(res, 400, { error: "not a valid snapshot" });
        }
        writeData({
          // The rentals come WITH the records: a row filed under a rental the
          // store does not have is money no view can show. They are structure,
          // not preference — unlike settings, which stay as they are.
          apartments: Array.isArray(snap.apartments) ? snap.apartments : [],
          // Same argument for the people: a tax percentage filed under someone
          // the store cannot name is a figure no view can label.
          people: Array.isArray(snap.people) ? snap.people : [],
          // Settings are configuration, not ledger. A restore puts the RECORDS
          // back; silently reverting the FX rate along with them would change
          // every tax estimate on screen and say nothing about it.
          settings: { ...DEFAULT_DATA.settings, ...readData().settings },
          taxRates: snap.taxRates || {},
          income: snap.income || [],
          expenses: snap.expenses || [],
        });
        return sendJSON(res, 200, { ok: true, restored: name });
      }

      // GET /api/export  -> raw store (download/backup convenience)
      if (url === "/api/export" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=rental-data.json",
        });
        return res.end(JSON.stringify(readData(), null, 2));
      }

      // POST /api/import  -> replace the whole store from an uploaded JSON
      // (a snapshot of the previous store is kept automatically by writeData)
      if (url === "/api/import" && req.method === "POST") {
        const b = await readBody(req); // parsed uploaded JSON
        // Validate shape before clobbering anything
        if (!b || typeof b !== "object" || !Array.isArray(b.income) || !Array.isArray(b.expenses)
            || !Array.isArray(b.apartments) || typeof b.taxRates !== "object") {
          return sendJSON(res, 400, { error: "not a valid rental-tracker export" });
        }
        const clean = {
          apartments: Array.isArray(b.apartments) ? b.apartments : [],
          people: Array.isArray(b.people) ? b.people : [],
          settings: { ...DEFAULT_DATA.settings, ...readData().settings }, // configuration, not ledger
          taxRates: b.taxRates || {},
          income: b.income || [],
          expenses: b.expenses || [],
        };
        writeData(clean); // persist (also snapshots the old file first)
        return sendJSON(res, 200, { ok: true, income: clean.income.length, expenses: clean.expenses.length });
      }

      return sendJSON(res, 404, { error: "unknown endpoint" }); // unmatched API path
    } catch (e) {
      return sendJSON(res, 400, { error: e.message }); // bad request / JSON
    }
  }

  // ---- Static SPA ----
  return serveStatic(req, res);
});

ensureStore(); // make sure data files exist
server.listen(PORT, () => {
  console.log(`Rental Tracker listening on http://0.0.0.0:${PORT}`); // boot log
  console.log(`Data dir: ${DATA_DIR}`); // where backups land
});
