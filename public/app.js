// Rythu Bazar Prices. The Worker renders every page with its rates in it (src/pages.ts); this adds
// search and sorting, "near me", the branch list, the chart readout and "40 mins ago" times.
// body[data-page] says which page this is; #rbz-data holds what the page's script needs.

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
const data = (() => {
  try {
    return JSON.parse($("rbz-data")?.textContent ?? "{}") ?? {};
  } catch {
    return {};
  }
})();

const wrapStorage = (area) => ({
  get(k) {
    try {
      return area().getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      area().setItem(k, v);
    } catch {}
  },
  remove(k) {
    try {
      area().removeItem(k);
    } catch {}
  },
});
const store = wrapStorage(() => localStorage);
const session = wrapStorage(() => sessionStorage);

const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const utc = (ymd) => new Date(`${ymd}T00:00:00Z`);
const fmtDate = (ymd) => dateFmt.format(utc(ymd));
const fmtDay = (ymd) => dayFmt.format(utc(ymd));
const money = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
const rupees = (n) => `₹${money(n)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

const chevron = () => svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "chev" }, svg("path", { d: "M9 6l6 6-6 6" }));
const branchUrl = (m) => `/branches/${m.slug}`;

const state = {
  today: data.today,
  all: data.markets ?? [], // every branch: id, name, slug, district, lat, lng, lastReportedDate, itemCount
  here: null, // { lat, lng } once the visitor shares their location; never sent anywhere
  sheetSort: "near", // branch list order once `here` is known: "near" or "az"
};

const reportedToday = (m) => m.lastReportedDate === state.today;

// ---------- Times ----------

/** The server writes "at 12:05 pm"; here it becomes "40 mins ago" and stays current. */
function agoTimes() {
  const now = Date.now();
  for (const t of document.querySelectorAll("time[data-ago]")) {
    const mins = Math.max(0, Math.floor((now - Date.parse(t.dateTime)) / 60000));
    if (!(mins < 24 * 60)) continue; // a day or more: the clock time says more
    t.textContent = mins < 1 ? "just now" : mins < 60 ? `${plural(mins, "min")} ago` : `${plural(Math.floor(mins / 60), "hr")} ago`;
  }
}

// ---------- Item lists: search + sort (home and branch pages) ----------

function initList() {
  const list = $("prices");
  const search = $("search");
  if (!list || !search) return;
  const rows = [...list.children];
  const empty = $("empty");
  const chips = document.querySelectorAll("[data-sort]");
  const order = {
    az: (a, b) => a.dataset.en.localeCompare(b.dataset.en),
    cheap: (a, b) => a.dataset.price - b.dataset.price,
    deals: (a, b) => a.dataset.deal - b.dataset.deal,
  };
  let sort = store.get("rbz.sort") ?? "az";
  if (!document.querySelector(`[data-sort="${sort}"]`)) sort = "az"; // "Best deals here" is only on a branch

  const render = () => {
    for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.sort === sort));
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const li of rows) {
      // Rare items are left out of the all-branches list, but search still finds them.
      li.hidden = q ? !li.dataset.q.includes(q) : "rare" in li.dataset;
      if (!li.hidden) shown++;
    }
    // Listed vegetables no branch has reported lately: search shows their last price on record.
    const lost = q ? (data.missing ?? []).filter((m) => matches(m, q)).map(lastSeenRow) : [];
    list.replaceChildren(...rows.slice().sort(order[sort]), ...lost);
    empty.hidden = shown + lost.length > 0;
    empty.textContent = q ? `Nothing matches “${search.value.trim()}”.` : "";
  };
  search.addEventListener("input", render);
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      sort = chip.dataset.sort;
      store.set("rbz.sort", sort);
      render();
    });
  }
  render();
}

const matches = (m, q) => m.item.toLowerCase().includes(q) || m.en.toLowerCase().includes(q) || m.te.includes(q);

/** Ink or white, whichever reads better on the tile colour. */
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#231f20" : "#ffffff";
}

const lastSeen = new Map(); // item → promise of its /api/last day, so retyping doesn't refetch

/** A search hit for a vegetable nobody has reported in the last 3 days: its last price on record. */
function lastSeenRow(m) {
  const badge = el("span", { className: "badge plain", textContent: "Looking up its last price…" });
  const cost = el("span", { className: "cost" });
  if (!lastSeen.has(m.item)) {
    lastSeen.set(m.item, api(`/api/last?name=${encodeURIComponent(m.item)}`).then((r) => r.day, () => undefined));
  }
  lastSeen.get(m.item).then((day) => {
    if (day === undefined) badge.textContent = "Couldn't look up its last price.";
    else if (!day) badge.textContent = "No branch has reported this yet.";
    else {
      badge.textContent = `Last reported ${fmtDate(day.date)} · ${plural(day.markets, "branch", "branches")}`;
      const text = day.min === day.max ? rupees(day.median) : `${rupees(day.min)}–${money(day.max)}`;
      cost.replaceChildren(
        el("span", { className: `num${text.length > 5 ? " small" : ""}` }, text, el("span", { className: "unit", textContent: "/kg" })),
      );
    }
  });
  const tile = el("span", {
    className: "tile",
    ariaHidden: "true",
    style: `background:${m.color};color:${inkOn(m.color)}`,
    textContent: m.te ? [...m.te][0] : m.en[0],
  });
  const what = el(
    "span",
    { className: "what" },
    el("span", { className: "en", textContent: m.en }),
    m.te ? el("span", { className: "te", textContent: m.te }) : null,
    badge,
  );
  return el("li", {}, m.path ? el("a", { className: "row old", href: m.path }, tile, what, cost) : el("div", { className: "row old" }, tile, what, cost));
}

// ---------- Near me ----------
// Distances are worked out here in the browser: the visitor's location never leaves the phone.
// Stored on the phone only: that "near me" is on (rbz.near) and when the home invite was
// dismissed (rbz.nearSkip). Distances are straight-line, so they're shown as approximate, with
// a Directions link to Google Maps for the road route.

const TRACKING_START = "2026-10-07"; // first day of scraped rates: "no rates in N+ days" counts from here
const SKIP_DAYS = 30; // "Not now" hides the home invite this long
const DAY_MS = 864e5;

const canLocate = "geolocation" in navigator;
const located = (m) => m.lat != null && m.lng != null;
const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / DAY_MS);
const kmText = (d) => `${d < 10 ? d.toFixed(1) : Math.round(d)} km`;

function km(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Placed branches nearest first, each with .km from `from`. */
function byDistance(list = state.all, from = state.here) {
  return list
    .filter(located)
    .map((m) => ({ ...m, km: km(from, m) }))
    .sort((a, b) => a.km - b.km);
}

/** How fresh a branch's rates are: a tag for lists, and words for a sentence. */
function age(m) {
  if (!m.lastReportedDate) {
    const text = `No rates in ${daysBetween(TRACKING_START, state.today)}+ days`;
    return { text, words: text.toLowerCase(), tone: "old" };
  }
  const n = daysBetween(m.lastReportedDate, state.today);
  if (n <= 0) return { text: "Today", words: "today's rates", tone: "today" };
  if (n === 1) return { text: "Yesterday", words: "updated yesterday", tone: "recent" };
  return { text: `${n} days ago`, words: `updated ${n} days ago`, tone: "old" };
}

function locate(timeout = 10000) {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.here = { lat: p.coords.latitude, lng: p.coords.longitude };
        store.set("rbz.near", "1");
        resolve(state.here);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) store.remove("rbz.near");
        reject(err);
      },
      { enableHighAccuracy: false, timeout, maximumAge: 10 * 60 * 1000 },
    ),
  );
}

/** A returning "near me" visitor's location, if the browser still allows it without asking. */
async function quietLocate() {
  if (!canLocate || store.get("rbz.near") !== "1") return null;
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" });
    if (perm?.state !== "granted") {
      if (perm?.state === "denied") store.remove("rbz.near");
      return null; // never pop a permission prompt the visitor didn't tap for
    }
    return await locate(5000);
  } catch {
    return null;
  }
}

/** Runs a "Use my location" tap: busy label, then `then()`, or an explanation in `msg`. */
async function useLocation(btn, label, msg, then) {
  const text = label.textContent;
  btn.disabled = true;
  label.textContent = "Finding you…";
  try {
    await locate();
    label.textContent = text;
    then();
  } catch (err) {
    msg.hidden = false;
    msg.textContent =
      err?.code === 1
        ? "Location is blocked for this site. Allow it in your browser settings, or choose a branch."
        : "Couldn't find your location. Try again.";
    label.textContent = err?.code === 1 ? text : "Try again";
  } finally {
    btn.disabled = false;
  }
}

const pinIcon = () => svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "pin" }, svg("path", { d: "M3 11l18-8-8 18-2-8z" }));

/** Home: a one-line invite to find the nearest branch, or, once location is on, a link to it. */
function renderNearAsk() {
  const box = $("near-ask");
  if (!box) return;
  box.hidden = true;
  if (!canLocate || !state.all.some(located)) return;
  if (state.here) {
    const [m] = byDistance();
    box.replaceChildren(
      el(
        "div",
        { className: "wrap" },
        el(
          "a",
          { className: "near-go", href: branchUrl(m) },
          pinIcon(),
          el(
            "span",
            { className: "what" },
            el("span", { textContent: `Nearest branch: ${m.name}` }),
            el("small", { textContent: `About ${kmText(m.km)} away · ${age(m).words}` }),
          ),
          chevron(),
        ),
      ),
    );
  } else {
    if (Date.now() - Number(store.get("rbz.nearSkip") ?? 0) < SKIP_DAYS * DAY_MS) return;
    const msg = el("span", { className: "what", textContent: "Your nearest branch" });
    const btn = el("button", { type: "button", className: "btn-sun", textContent: "Use my location" });
    btn.onclick = () => useLocation(btn, btn, msg, () => location.assign(branchUrl(byDistance()[0])));
    const skip = () => {
      store.set("rbz.nearSkip", String(Date.now()));
      box.hidden = true;
    };
    box.replaceChildren(
      el(
        "div",
        { className: "wrap near-ask-inner" },
        pinIcon(),
        msg,
        btn,
        el(
          "button",
          { type: "button", className: "icon-btn bare", ariaLabel: "Not now", onclick: skip },
          svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: "M6 6l12 12M18 6L6 18" })),
        ),
      ),
    );
  }
  box.hidden = false;
}

/** One branch: its distance from the visitor, once known. */
function renderNearLine() {
  const line = $("near-line");
  const m = state.all.find((x) => x.id === data.id);
  if (!line || !m || !located(m) || !state.here) return;
  const d = kmText(km(state.here, m));
  line.replaceChildren(pinIcon(), byDistance()[0]?.id === m.id ? `Nearest to you · about ${d}` : `About ${d} from you`);
  line.hidden = false;
}

// ---------- Branch list (home) ----------

function initSheet() {
  const sheet = $("markets");
  const chip = $("bazar-chip");
  if (!sheet || !chip) return;
  $("mk-search").addEventListener("input", renderMarkets);
  chip.addEventListener("click", () => {
    $("mk-search").value = "";
    renderMarkets();
    sheet.showModal();
  });
  sheet.addEventListener("click", (e) => {
    // Tap on the backdrop (the dialog box itself, outside its content) closes it.
    if (e.target === sheet || e.target.closest("[data-close]")) sheet.close();
  });
}

function renderMarkets() {
  const sheet = $("markets");
  const q = $("mk-search").value.trim().toLowerCase();
  const hits = state.all.filter((m) => !q || m.name.toLowerCase().includes(q) || m.district.toLowerCase().includes(q));
  const today = hits.filter(reportedToday);
  const later = hits.filter((m) => !reportedToday(m));
  const nearFirst = state.here && state.sheetSort === "near";
  renderSheetNear();
  const link = (m, isLater, meta) =>
    el(
      "li",
      {},
      el(
        "a",
        { className: `mk-btn${isLater ? " later" : ""}`, href: branchUrl(m) },
        el("span", { className: "radio", ariaHidden: "true" }),
        el(
          "span",
          { className: "what" },
          el("span", { className: "en", textContent: m.name }),
          el("span", { className: "sub", textContent: m.district }),
        ),
        meta ??
          el("span", {
            className: "meta",
            textContent: isLater
              ? m.lastReportedDate
                ? `last ${fmtDate(m.lastReportedDate)}`
                : "no rates yet"
              : plural(m.itemCount, "item"),
          }),
      ),
    );
  // Nearest first: distance plus how fresh each branch's rates are; unplaced branches go last.
  const distLink = (m) => {
    const a = age(m);
    return link(
      m,
      false,
      el(
        "span",
        { className: "dist" },
        m.km != null ? el("b", { className: "num", textContent: `~${kmText(m.km)}` }) : null,
        el("span", { className: `tag ${a.tone}`, textContent: a.text }),
      ),
    );
  };
  // This page is all branches: picking it again just closes the list.
  const allRow = el(
    "ul",
    { className: "mk-list" },
    el(
      "li",
      {},
      el(
        "button",
        { type: "button", className: "mk-btn", ariaCurrent: "true", onclick: () => sheet.close() },
        el("span", { className: "radio", ariaHidden: "true" }),
        el(
          "span",
          { className: "what" },
          el("span", { className: "en", textContent: "All branches" }),
          el("span", { className: "sub", textContent: "Price ranges across Telangana" }),
        ),
      ),
    ),
  );

  $("mk-body").replaceChildren(
    ...(hits.length
      ? [
          q ? null : allRow,
          nearFirst
            ? el("ul", { className: "mk-list" }, ...[...byDistance(hits), ...hits.filter((m) => !located(m))].map(distLink))
            : null,
          nearFirst ? null : today.length ? el("h3", { className: "sheet-section", textContent: `Reporting today · ${today.length}` }) : null,
          nearFirst ? null : today.length ? el("ul", { className: "mk-list" }, ...today.map((m) => link(m, false))) : null,
          nearFirst ? null : later.length ? el("h3", { className: "sheet-section muted", textContent: `Not reported today · ${later.length}` }) : null,
          nearFirst ? null : later.length ? el("ul", { className: "mk-list" }, ...later.map((m) => link(m, true))) : null,
        ].filter(Boolean)
      : [el("p", { className: "sheet-msg", textContent: `No branch matches “${$("mk-search").value.trim()}”.` })]),
  );
}

/** Branch list: "Use my location" until we know where the visitor is, then the sort toggle. */
function renderSheetNear() {
  const box = $("mk-near");
  box.hidden = !canLocate || !state.all.some(located);
  if (box.hidden) return;
  if (!state.here) {
    const label = el("b", { textContent: "Use my location" });
    const msg = el("small", { textContent: "Sort branches by distance. Your location stays on this phone." });
    const btn = el("button", { type: "button", className: "near-btn" }, pinIcon(), el("span", { className: "what" }, label, msg));
    btn.onclick = () =>
      useLocation(btn, label, msg, () => {
        state.sheetSort = "near";
        renderMarkets();
        renderNearAsk();
      });
    box.replaceChildren(btn);
    return;
  }
  const near = state.sheetSort === "near";
  box.replaceChildren(
    el(
      "div",
      { className: "near-sort" },
      el("span", {}, pinIcon(), near ? "Nearest first" : "A–Z", near ? el("small", { textContent: "· approx. distance" }) : null),
      el("button", {
        type: "button",
        className: "link-btn",
        textContent: near ? "Sort A–Z instead" : "Nearest first",
        onclick: () => {
          state.sheetSort = near ? "az" : "near";
          renderMarkets();
        },
      }),
    ),
  );
}

// ---------- Vegetable page ----------

// Same geometry as the server's chart (CH in src/pages.ts).
const CHART_W = 358;
const CHART_L = 6;
const CHART_R = 6;

const typicalLabel = (date) => {
  const n = daysBetween(date, state.today);
  return n === 0 ? "Typical today" : n === 1 ? "Typical yesterday" : `Typical · ${fmtDay(date)}`;
};
const weekdayLabel = (date) => fmtDate(date).replace(",", "");

/** The change from a range's first day to `now` (changeText in src/pages.ts). */
function changeText(start, now, key) {
  const diff = now.median - start.median;
  if (diff === 0) return { text: `Same as ${fmtDay(start.date)}`, tone: "" };
  const pct = Math.round((Math.abs(diff) / start.median) * 100);
  return {
    text: `${diff < 0 ? "▼" : "▲"} ${rupees(Math.abs(diff))} · ${pct}% ${key === "1W" ? "past week" : `since ${fmtDay(start.date)}`}`,
    tone: diff < 0 ? "down" : "up",
  };
}

/** Hover or drag across the chart to read a day; the period chips swap the chart the server drew for each. */
function initChart() {
  const wrap = $("trend");
  const days = data.days ?? [];
  if (!wrap || !days.length) return;
  const boxes = [...wrap.querySelectorAll(".trend")];
  const when = $("veg-when");
  const num = $("veg-num");
  const chg = $("veg-chg");
  const points = new Map(
    boxes.map((b) => [
      b,
      b
        .querySelector("polyline")
        .getAttribute("points")
        .trim()
        .split(/\s+/)
        .map((p) => p.split(",").map(Number)),
    ]),
  );
  let box = boxes.find((b) => !b.hidden) ?? boxes[0];

  /** Show day `k` of the visible range, or its latest day when k is null. */
  const show = (k) => {
    const pts = days.slice(Number(box.dataset.from));
    const last = pts.length - 1;
    const i = k ?? last;
    const d = pts[i];
    when.textContent = i === last ? typicalLabel(d.date) : weekdayLabel(d.date);
    num.textContent = rupees(d.median);
    if (chg) {
      const c = changeText(pts[0], d, box.dataset.range);
      chg.textContent = c.text;
      chg.className = `chg ${c.tone}`;
    }
    const [x, y] = points.get(box)[i];
    const dot = box.querySelector(".trend-dot");
    const cursor = box.querySelector(".trend-cursor");
    dot.style.left = cursor.style.left = `${(x / CHART_W) * 100}%`;
    dot.style.top = `${y}px`;
    cursor.hidden = k == null;
  };
  const read = (e) => {
    const r = wrap.getBoundingClientRect();
    const n = points.get(box).length;
    const fx = ((e.clientX - r.left) / r.width) * CHART_W;
    show(Math.min(n - 1, Math.max(0, Math.round(((fx - CHART_L) / (CHART_W - CHART_L - CHART_R)) * (n - 1)))));
  };
  wrap.addEventListener("pointermove", read);
  wrap.addEventListener("pointerdown", read);
  wrap.addEventListener("pointerleave", () => show(null));
  wrap.addEventListener("pointercancel", () => show(null));
  wrap.addEventListener("pointerup", (e) => e.pointerType !== "mouse" && show(null));

  const chips = [...document.querySelectorAll(".range-chip")];
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      box = boxes.find((b) => b.dataset.range === chip.dataset.range) ?? box;
      for (const b of boxes) b.hidden = b !== box;
      for (const c of chips) c.setAttribute("aria-pressed", String(c === chip));
      show(null);
    });
  }
}

/**
 * Cheapest first (as the server sends it), Nearest (asks for location on the first tap) or A–Z.
 * Once the location is known, every row shows its distance and branches at the same price go nearest first.
 */
function initBranchSort() {
  const list = $("branches");
  if (!list) return;
  const rows = [...list.children];
  const chips = [...document.querySelectorAll("[data-vsort]")];
  const nearChip = chips.find((c) => c.dataset.vsort === "near");
  const msg = $("near-msg");
  const place = (li) => ({ lat: Number(li.dataset.lat), lng: Number(li.dataset.lng) });
  const dist = (li) => (li.dataset.lat ? km(state.here, place(li)) : Infinity);
  const by = {
    cheap: (a, b) =>
      a.dataset.price - b.dataset.price ||
      (state.here ? dist(a) - dist(b) : 0) ||
      a.dataset.age - b.dataset.age ||
      a.dataset.name.localeCompare(b.dataset.name),
    near: (a, b) => dist(a) - dist(b),
    az: (a, b) => a.dataset.name.localeCompare(b.dataset.name),
  };
  let sort = "cheap";
  const apply = () => {
    for (const c of chips) c.setAttribute("aria-pressed", String(c.dataset.vsort === sort));
    list.replaceChildren(...rows.slice().sort(by[sort]));
    for (const li of rows) {
      li.querySelector(".km").textContent = state.here && li.dataset.lat ? ` · about ${kmText(dist(li))}` : "";
    }
  };
  if (canLocate && rows.some((li) => li.dataset.lat)) nearChip.hidden = false;
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      msg.hidden = true;
      if (chip.dataset.vsort === "near" && !state.here) {
        useLocation(chip, chip.lastElementChild, msg, () => {
          sort = "near";
          apply();
        });
        return;
      }
      sort = chip.dataset.vsort;
      apply();
    });
  }
  // Shared their location before: distances straight away, without a prompt.
  quietLocate().then((here) => here && apply());
}

// ---------- Boot ----------

async function initHome(firstVisit) {
  initList();
  initSheet();
  renderNearAsk();
  if (store.get("rbz.near") !== "1") return;
  // Turned "near me" on before: a fresh visit opens on the nearest branch.
  const fresh = $("fresh");
  const text = fresh?.textContent;
  if (firstVisit && fresh) fresh.textContent = "Finding your nearest branch…";
  const here = await quietLocate();
  const [nearest] = here ? byDistance() : [];
  if (firstVisit && nearest) return location.replace(branchUrl(nearest));
  if (fresh) fresh.textContent = text;
  renderNearAsk();
}

async function initBranch() {
  initList();
  if (await quietLocate()) renderNearLine();
}

function init() {
  // A visit is "fresh" until the first page of it loads in this tab: going back to the home page
  // later in the visit must not bounce the visitor to their nearest branch again.
  const firstVisit = !session.get("rbz.seen");
  session.set("rbz.seen", "1");
  store.remove("rbz.market"); // the old "remember my bazar" default
  agoTimes();
  setInterval(agoTimes, 60_000);
  addEventListener("pageshow", agoTimes);
  if (page === "home") initHome(firstVisit);
  if (page === "branch") initBranch();
  if (page === "vegetable") {
    initChart();
    initBranchSort();
  }
}

init();
