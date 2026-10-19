// Rythu Bazar Prices — vanilla client for /api/*.
// Default view: every bazar at once (price range, where it's cheapest).
// ?market=<id> narrows to one bazar.

const $ = (id) => document.getElementById(id);
const els = {
  today: $("today"),
  back: $("back"),
  title: $("title"),
  nearLine: $("near-line"),
  directions: $("directions"),
  nearAsk: $("near-ask"),
  sub: $("sub"),
  fresh: $("fresh"),
  board: $("board"),
  boardLabel: $("board-label"),
  controls: $("controls"),
  search: $("search"),
  bazarChip: $("bazar-chip"),
  bazarChipLabel: $("bazar-chip-label"),
  dealsChip: document.querySelector('[data-sort="deals"]'),
  notice: $("notice"),
  prices: $("prices"),
  empty: $("empty"),
  compare: $("compare"),
  cmpTitle: $("cmp-title"),
  cmpTe: $("cmp-te"),
  cmpBody: $("cmp-body"),
  markets: $("markets"),
  mkNear: $("mk-near"),
  mkSearch: $("mk-search"),
  mkBody: $("mk-body"),
};

// The board shows the biggest price moves; until there are enough (no history yet, or nothing moved), these fill it.
const STAPLES = [
  ["Tomato", "Tomato"],
  ["Onions-I", "Onion"],
  ["Potato", "Potato"],
];
// Sold per piece or bunch at some bazars and per kg at others; the source doesn't say which.
const UNIT_VARIES = new Set(["Mulagakada", "Leafy Vegetables"]);

// Fewer bazars than this and an item isn't really "across bazars": all-branches leaves it out of
// the list, but search still finds it.
const RARE = 3;

// English/Telugu names and tile colours come with the data (src/items.ts) and are kept here
// so sorting and the compare sheet can use them.
const labels = new Map();
const remember = (list) => {
  for (const i of list ?? []) if (i.en) labels.set(i.item, { en: i.en, te: i.te, color: i.color });
};
const info = (item) => labels.get(item) ?? { en: item, te: "", color: "#a6a8aa" };
const matches = (item, q) => {
  const { en, te } = info(item);
  return item.toLowerCase().includes(q) || en.toLowerCase().includes(q) || te.includes(q);
};

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  remove(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const fmtDate = (ymd) => dateFmt.format(new Date(`${ymd}T00:00:00Z`));
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
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

const state = {
  today: null,
  all: [], // flat bazars with district name
  market: null, // null = all bazars; else the /api/prices market
  current: null, // { date, isToday, items } with items as { item, price, stats, cheapest? }
  sort: store.get("rbz.sort") ?? "az",
  here: null, // { lat, lng } once the visitor shares their location; never sent anywhere
  sheetSort: "near", // branch list order once `here` is known: "near" or "az"
};

const reportedToday = (m) => m.lastReportedDate === state.today;

// ---------- Boot ----------

async function init() {
  try {
    localStorage.removeItem("rbz.market"); // the old "remember my bazar" default
  } catch {}
  let data;
  try {
    data = await api("/api/markets");
  } catch {
    setFresh("Couldn't load rates. Check your connection and refresh.", true);
    return;
  }
  state.today = data.today;
  state.all = data.districts.flatMap((d) => d.markets.map((m) => ({ ...m, district: d.name })));
  els.today.textContent = fmtDate(data.today);

  els.search.addEventListener("input", render);
  els.mkSearch.addEventListener("input", renderMarkets);
  // Overview: opens the branch list. One branch: goes straight back to all branches.
  els.bazarChip.addEventListener("click", () => (state.market ? go(null) : openMarkets()));
  els.bazarChip.disabled = !state.all.length;
  els.back.addEventListener("click", () => go(null));
  for (const chip of document.querySelectorAll("[data-sort]")) {
    chip.addEventListener("click", () => {
      state.sort = chip.dataset.sort;
      store.set("rbz.sort", state.sort);
      render();
    });
  }
  for (const dlg of [els.compare, els.markets]) {
    dlg.addEventListener("click", (e) => {
      // Tap on the backdrop (the dialog box itself, outside its content) closes it.
      if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
    });
  }
  window.addEventListener("popstate", () => show(urlMarket()));

  let id = urlMarket();
  if (!id && store.get("rbz.near") === "1") {
    // Turned "near me" on before: open on the nearest branch, unless a link named one.
    setFresh("Finding your nearest branch…");
    const near = await nearestOnReturn();
    if (near) {
      id = String(near.id);
      const url = new URL(location.href);
      url.searchParams.set("market", id);
      history.replaceState(null, "", url);
    }
  }
  show(id);
}

function urlMarket() {
  const id = new URLSearchParams(location.search).get("market");
  return id && state.all.some((m) => String(m.id) === id) ? id : null;
}

/** Navigate to all bazars (null) or one bazar, keeping the URL shareable. */
function go(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("market", id);
  else url.searchParams.delete("market");
  history.pushState(null, "", url);
  els.search.value = "";
  show(id);
  scrollTo({ top: 0 });
}

function show(id) {
  return id ? showMarket(id) : showAll();
}

function resetView() {
  els.notice.replaceChildren();
  els.prices.replaceChildren();
  els.board.hidden = true;
  els.empty.hidden = true;
  els.prices.classList.remove("old");
}

// ---------- All bazars ----------

async function showAll() {
  state.market = null;
  els.back.hidden = true;
  els.dealsChip.hidden = true;
  if (state.sort === "deals") state.sort = "az";
  els.bazarChipLabel.textContent = "Choose a branch";
  els.bazarChip.lastElementChild.style.display = "";
  els.title.textContent = "Today's rates";
  els.sub.textContent = "Price ranges across Telangana's Rythu Bazars";
  document.title = "Rythu Bazar rates today";
  setFresh("Loading rates…");
  resetView();
  renderNearLine(null);
  renderNearAsk();

  let data;
  try {
    data = await api("/api/overview");
  } catch {
    state.current = null;
    setFresh("Couldn't load rates. Try again in a bit.", true);
    return;
  }
  if (state.market) return; // navigated away meanwhile
  const checked = data.lastCheckedAt ? ` · checked ${timeFmt.format(new Date(data.lastCheckedAt))}` : "";
  remember(data.items);
  remember(data.missing);
  state.current = {
    date: data.today,
    isToday: true,
    items: data.items.map((i) => ({
      item: i.item,
      price: i.min, // lowest rate, so "Cheapest first" sorts by it
      stats: { min: i.min, max: i.max, median: i.median, markets: i.markets },
      cheapest: i.cheapest,
      trend: i.trend ?? [],
    })),
    changes: data.changes ?? [],
    movers: data.movers ?? [],
    missing: data.missing ?? [],
  };
  if (!data.items.length) {
    setFresh(`No branch has posted rates yet${checked}`, true);
    els.notice.replaceChildren(
      el(
        "div",
        { className: "card notice" },
        el("h2", { textContent: "No rates yet" }),
        el("p", { textContent: "Branches usually post rates by 1 PM. This page fills in on its own as they do." }),
      ),
    );
  } else {
    setFresh(`${data.reportedToday} of ${data.markets} branches reported today${checked}`, data.reportedToday === 0);
  }
  els.controls.hidden = !data.items.length;
  renderBoard();
  render();
}

// ---------- One bazar ----------

async function showMarket(id) {
  const m = state.all.find((x) => String(x.id) === id);
  state.market = m ?? { id: Number(id) };
  els.back.hidden = false;
  els.dealsChip.hidden = false;
  els.bazarChipLabel.textContent = "All branches";
  els.bazarChip.lastElementChild.style.display = "none";
  els.title.textContent = m?.name ?? "…";
  els.sub.textContent = m?.district ?? "";
  setFresh("Loading rates…");
  resetView();
  els.nearAsk.hidden = true;
  renderNearLine(m);

  let data;
  try {
    data = await api(`/api/prices?market=${encodeURIComponent(id)}`);
  } catch {
    state.current = null;
    setFresh("Couldn't load rates for this branch. Try again in a bit.", true);
    return;
  }
  if (String(state.market?.id) !== id) return; // navigated away meanwhile
  state.market = data.market;
  remember(data.items);
  state.current = data;
  const { date, isToday, market, items } = data;
  document.title = `${market.name} · Rythu Bazar rates today`;
  const checked = market.lastCheckedAt ? ` · checked ${timeFmt.format(new Date(market.lastCheckedAt))}` : "";
  els.sub.textContent = `${market.district}${items.length ? ` · ${plural(items.length, "item")}` : ""}`;

  if (!date || !items.length) {
    setFresh(`No rates in ${daysBetween(TRACKING_START, state.today)}+ days${checked}`, true);
    els.notice.replaceChildren(notReported(market));
  } else if (isToday) {
    setFresh(`Today's rates${checked}`);
  } else {
    const days = daysBetween(date, state.today);
    setFresh(`${days === 1 ? "Not updated today" : `Not updated in ${days} days`} · showing ${fmtDate(date)}${checked}`, true);
    els.notice.replaceChildren(
      el(
        "div",
        { className: "card notice warn" },
        el("h2", { textContent: `Rates from ${fmtDate(date)}` }),
        el("p", { textContent: `${market.name} hasn't posted today's rates yet. These are its latest, so today's may differ.` }),
      ),
    );
  }
  els.controls.hidden = !items.length && !state.all.length;
  els.prices.classList.toggle("old", Boolean(date) && !isToday);
  renderBoard();
  render();
}

function notReported(market) {
  const today = state.all.filter((m) => reportedToday(m) && m.id !== market.id);
  // Nearest to the visitor if we know where they are, else to this branch, else same district.
  const self = state.all.find((m) => m.id === market.id);
  const from = state.here ?? (self && located(self) ? self : null);
  const near = from ? [] : today.filter((m) => m.district === market.district);
  const picks = (from ? byDistance(today, from) : near.length ? near : today).slice(0, 3);
  return el(
    "div",
    {},
    el(
      "div",
      { className: "card notice" },
      el("h2", { textContent: "No rates from this branch yet" }),
      el("p", {
        textContent: `It hasn't posted rates since we started checking on ${fmtDate(TRACKING_START)}. We check every 30 minutes, so this page fills in on its own if it does.`,
      }),
    ),
    picks.length
      ? el(
          "div",
          { className: "nearby" },
          el("h3", { textContent: from || near.length ? "Nearest with today's rates" : "Branches with today's rates" }),
          ...picks.map((m) =>
            el(
              "button",
              { type: "button", className: "nearby-btn", onclick: () => go(String(m.id)) },
              el(
                "span",
                { className: "what" },
                el("span", { className: "en", textContent: m.name }),
                el("span", {
                  className: "sub",
                  textContent: `${m.district} · ${plural(m.itemCount, "item")}${state.here ? ` · ~${kmText(m.km)}` : ""}`,
                }),
              ),
              el("span", { className: "pill", textContent: "Open" }),
            ),
          ),
        )
      : null,
  );
}

// ---------- Verdicts ----------

const comparable = (i) => i.stats && i.stats.markets > 1 && !UNIT_VARIES.has(i.item);

/** One line under the item name. All bazars: where it's cheapest. One bazar: how it compares. */
function verdict(i) {
  const s = i.stats;
  if (!comparable(i)) return null;
  const n = `${s.markets} branches`;
  if (s.min === s.max) return { tone: "plain", text: `Same price at all ${n}` };
  if (!state.market) {
    const c = i.cheapest ?? [];
    if (c.length === 1) return { tone: "plain", text: `Cheapest at ${place(c[0])}` };
    return { tone: "plain", text: `${rupees(s.min)} at ${c.length} of ${n}` };
  }
  if (i.price <= s.min) return { tone: "good", text: `Lowest of ${n}` };
  if (i.price >= s.max) return { tone: "bad", text: `Highest of ${n}` };
  const diff = i.price - s.median;
  if (diff > s.median * 0.1) return { tone: "bad", text: `${rupees(diff)} above typical` };
  if (-diff > s.median * 0.1) return { tone: "good", text: `${rupees(-diff)} below typical` };
  return { tone: "plain", text: "Typical price" };
}

/** Best deals first: furthest below typical, then nearest the lowest rate, then the most saved vs the highest. */
function compareDeals(a, b) {
  const key = (i) => {
    const s = i.stats;
    if (!comparable(i)) return [Infinity, Infinity, 0];
    const span = s.max - s.min || 1;
    return [(i.price - s.median) / s.median, (i.price - s.min) / span, (s.max - i.price) / s.max];
  };
  const [a1, a2, a3] = key(a);
  const [b1, b2, b3] = key(b);
  return a1 - b1 || a2 - b2 || b3 - a3;
}

// ---------- Rendering ----------

function renderBoard() {
  const items = state.current?.items ?? [];
  const moves = new Map((state.current?.movers ?? []).map((m) => [m.item, m]));
  // Biggest movers first, then staples so the board stays three wide.
  const picks = [...moves.keys(), ...STAPLES.map(([key]) => key)]
    .filter((key, n, all) => all.indexOf(key) === n && items.some((x) => x.item === key))
    .slice(0, 3);
  els.boardLabel.textContent = moves.size ? "Biggest price moves since the day before" : "Daily staples";
  const tiles = picks.map((key) => {
    const i = items.find((x) => x.item === key);
    // Tiles are narrow: "Okra (bhindi)" → "Okra".
    const label = STAPLES.find(([k]) => k === key)?.[1] ?? info(key).en.replace(/\s*\(.*\)$/, "");
    const move = moves.get(key);
    const s = i.stats;
    const priceText = priceLabel(i);
    let note = "per kg";
    if (s && s.markets > 1) {
      if (!state.market) note = `per kg · ${s.markets} branches`;
      else {
        const v = verdict(i);
        note = `${v?.tone === "good" ? "low" : v?.tone === "bad" ? "high" : "typical"} · ${rupees(s.min)}–${money(s.max)}`;
      }
    }
    return el(
      "button",
      {
        type: "button",
        className: "staple",
        onclick: () => openCompare(i),
        ariaLabel: [
          `${label} ${priceText} per kg${state.market ? "" : " across branches"}`,
          move ? `${moveWords(move)}, ${Math.abs(move.pct)}%` : "",
          "Compare branches",
        ]
          .filter(Boolean)
          .join(". "),
      },
      el("span", { className: "label", textContent: label }),
      el("span", { className: "te", textContent: info(key).te }),
      el("span", { className: `num${priceText.length > 5 ? " small" : ""}`, textContent: priceText }),
      move
        ? el("span", {
            className: "move",
            ariaHidden: "true",
            textContent: `${moveText(move)} · ${Math.abs(move.pct)}%`,
          })
        : null,
      sparkline(i.trend),
      el("span", { className: "note", textContent: note }),
    );
  });
  els.board.replaceChildren(...tiles);
  els.board.hidden = tiles.length === 0;
  els.boardLabel.hidden = tiles.length === 0;
}

function render() {
  for (const chip of document.querySelectorAll("[data-sort]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.sort === state.sort));
  }
  if (!state.current) return;
  const q = els.search.value.trim().toLowerCase();
  let items = state.current.items.filter((i) =>
    q ? matches(i.item, q) : state.market || !i.stats || i.stats.markets >= RARE,
  );
  // Listed vegetables no bazar has reported lately: search shows their last price on record.
  const lost = q && !state.market ? (state.current.missing ?? []).filter((m) => matches(m.item, q)) : [];
  if (state.sort === "az") items = items.slice().sort((a, b) => info(a.item).en.localeCompare(info(b.item).en));
  if (state.sort === "cheap") items = items.slice().sort((a, b) => a.price - b.price);
  if (state.sort === "deals") items = items.slice().sort(compareDeals);

  const changes = new Map((state.current.changes ?? []).map((m) => [m.item, m]));
  els.prices.replaceChildren(...items.map((i) => row(i, changes.get(i.item))), ...lost.map(lastSeenRow));
  els.empty.hidden = items.length + lost.length > 0 || state.current.items.length === 0;
  els.empty.textContent = q ? `Nothing matches “${els.search.value.trim()}”.` : "";
}

function row(i, move) {
  const { en, te, color } = info(i.item);
  const s = i.stats;
  const rare = !state.market && s && s.markets < RARE;
  const v = rare
    ? { tone: "plain", text: s.markets === 1 ? `Only at ${place(i.cheapest?.[0] ?? "one branch")}` : `Only ${s.markets} branches report this` }
    : verdict(i);
  const unitVaries = UNIT_VARIES.has(i.item);
  // All bazars: the range is the headline, so the strip only earns its place inside one bazar.
  const showStrip = Boolean(state.market) && comparable(i) && s.max > s.min;
  const pos = (p) => `${((p - s.min) / (s.max - s.min)) * 100}%`;
  const priceText = priceLabel(i);
  // All bazars: the last week's trend and the change since the day before, under the range.
  const spark = state.market ? null : sparkline(i.trend);
  const change = state.market || !move ? null : move;

  const label = [
    en,
    `${priceText}${unitVaries ? "" : " per kg"}${state.market ? "" : " across branches"}`,
    change ? `${moveWords(change)} since the day before` : "",
    v?.text,
    "Compare branches",
  ]
    .filter(Boolean)
    .join(". ");
  return el(
    "li",
    {},
    el(
      "button",
      { type: "button", className: "row", onclick: () => openCompare(i), ariaLabel: label },
      el("span", { className: "tile", ariaHidden: "true", style: `background:${color};color:${inkOn(color)}` }, te ? [...te][0] : en[0]),
      el(
        "span",
        { className: "what" },
        el("span", { className: "en", textContent: en }),
        te ? el("span", { className: "te", textContent: te }) : null,
        v ? el("span", { className: `badge ${v.tone}`, textContent: v.text }) : null,
        unitVaries ? el("span", { className: "badge plain", textContent: "Per piece or bunch at some branches" }) : null,
      ),
      el(
        "span",
        { className: "cost" },
        el(
          "span",
          { className: `num${priceText.length > 5 ? " small" : ""}` },
          priceText,
          unitVaries ? null : el("span", { className: "unit", textContent: "/kg" }),
        ),
        showStrip
          ? el(
              "span",
              { className: "strip", ariaHidden: "true" },
              el("span", { className: "tick", style: `left:${pos(s.median)}` }),
              el("span", { className: "dot", style: `left:${pos(i.price)}` }),
            )
          : null,
        spark || change
          ? el(
              "span",
              { className: "meta", ariaHidden: "true" },
              spark,
              change ? el("span", { className: `chg ${change.change > 0 ? "up" : "down"}`, textContent: moveText(change) }) : null,
            )
          : null,
        showStrip
          ? el(
              "span",
              { className: "range", ariaHidden: "true" },
              el("span", { textContent: rupees(s.min) }),
              el("span", { textContent: rupees(s.max) }),
            )
          : null,
      ),
    ),
  );
}

const lastSeen = new Map(); // item → promise of its /api/last day, so retyping doesn't refetch

/** A search hit for a vegetable nobody has reported in the last 3 days: its last price on record. */
function lastSeenRow(m) {
  const { en, te, color } = info(m.item);
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
  return el(
    "li",
    {},
    el(
      "div",
      { className: "row old" },
      el("span", { className: "tile", ariaHidden: "true", style: `background:${color};color:${inkOn(color)}` }, te ? [...te][0] : en[0]),
      el(
        "span",
        { className: "what" },
        el("span", { className: "en", textContent: en }),
        te ? el("span", { className: "te", textContent: te }) : null,
        badge,
      ),
      cost,
    ),
  );
}

/** A small line of the last week's prices, stock-app style. Three days is the least that shows a trend. */
function sparkline(values) {
  if (!values || values.length < 3) return null;
  const H = 12;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo;
  const y = (v) => (span ? 1.5 + (1 - (v - lo) / span) * (H - 3) : H / 2).toFixed(1);
  const points = values.map((v, n) => `${((n / (values.length - 1)) * 100).toFixed(1)},${y(v)}`).join(" ");
  return svg(
    "svg",
    { class: "spark", viewBox: `0 0 100 ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" },
    svg("polyline", { points, "vector-effect": "non-scaling-stroke" }),
  );
}

// Unchanged prices get no label at all: an arrow appearing is the signal.
const moveText = (m) => `${m.change > 0 ? "▲" : "▼"} ${rupees(Math.abs(m.change))}`;
const moveWords = (m) => `${m.change > 0 ? "up" : "down"} ${rupees(Math.abs(m.change))}`;

/** rbzts writes "Miryalaguda(NSP Camp)"; give the bracket a space so it wraps like a name. */
const place = (name) => name.replace(/\s*\(/, " (");

/** All bazars: lowest–highest rate, since one number would hide the spread. One bazar: its own rate. */
function priceLabel(i) {
  const s = i.stats;
  return !state.market && s && s.max > s.min ? `${rupees(s.min)}–${money(s.max)}` : rupees(i.price);
}

/** Ink or white, whichever reads better on the tile colour. */
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#231f20" : "#ffffff";
}

// ---------- Compare sheet ----------

async function openCompare(i) {
  const { en, te } = info(i.item);
  els.cmpTitle.textContent = en;
  els.cmpTe.textContent = te;
  els.cmpBody.replaceChildren(el("p", { className: "sheet-msg", textContent: "Comparing branches…" }));
  els.compare.showModal();
  let data;
  // The chart is extra: if history fails, the comparison still shows.
  const history = api(`/api/history?name=${encodeURIComponent(i.item)}&days=30`).catch(() => null);
  try {
    data = await api(`/api/item?name=${encodeURIComponent(i.item)}`);
  } catch {
    els.cmpBody.replaceChildren(el("p", { className: "sheet-msg", textContent: "Couldn't load the comparison. Try again." }));
    return;
  }
  const here = state.market;
  const list = data.markets;
  if (list.length < 2) {
    els.cmpBody.replaceChildren(
      el("p", { className: "sheet-msg", textContent: "No other branch has reported this item in the last three days." }),
    );
    return;
  }
  const min = list[0].price;
  const max = list[list.length - 1].price;
  const cheapest = list.filter((m) => m.price === min);
  const unitVaries = UNIT_VARIES.has(i.item);
  const where = cheapest.length === 1 ? `${cheapest[0].market} at ${rupees(min)}` : `${plural(cheapest.length, "branch", "branches")} at ${rupees(min)}`;
  let summary;
  if (unitVaries) summary = `Branches sell this by different units, so these rates don't compare directly.`;
  else if (!here) summary = `${rupees(min)} to ${rupees(max)}/kg across branches. Cheapest is ${where}.`;
  else if (cheapest.some((m) => m.marketId === here.id)) summary = `${here.name} is among the cheapest at ${rupees(i.price)}.`;
  else {
    const v = verdict(i);
    summary = `At ${here.name} it's ${rupees(i.price)}${v?.tone === "plain" ? ", a typical price" : ""}. Cheapest is ${where}.`;
  }

  els.cmpBody.replaceChildren(
    el(
      "div",
      { className: "cmp-summary" },
      el("p", { textContent: summary }),
      el(
        "div",
        { className: "tags" },
        el("span", { textContent: `${plural(list.length, "branch", "branches")}, last 3 days` }),
        el("span", { textContent: `${rupees(min)} – ${rupees(max)}` }),
        unitVaries ? el("span", { className: "warn", textContent: "Units differ: per kg, piece or bunch" }) : null,
      ),
    ),
    unitVaries ? null : priceChart((await history)?.days ?? [], en),
    el(
      "ol",
      { className: "cmp-list", ariaLabel: "Branches, cheapest first. Tap one to see all its prices" },
      ...list.map((m) => {
        const isHere = m.marketId === here?.id;
        const isCheapest = m.price === min && !unitVaries;
        return el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              className: `cmp-row${isHere ? " here" : isCheapest ? " cheapest" : ""}`,
              ariaLabel: `${m.market}, ${m.district}, ${rupees(m.price)}. See all prices at ${m.market}`,
              onclick: () => {
                els.compare.close();
                if (!isHere) go(String(m.marketId));
              },
            },
            el(
              "span",
              { className: "where" },
              el(
                "span",
                { className: "name" },
                el("b", { textContent: m.market }),
                el("small", { textContent: m.district + (m.date === data.today ? "" : ` · ${fmtDate(m.date)}`) }),
              ),
              el("span", { className: "bar", ariaHidden: "true" }, el("span", { style: `width:${(m.price / max) * 100}%` })),
            ),
            el(
              "span",
              { className: "val" },
              el("span", { className: "num", textContent: rupees(m.price) }),
              el("small", { textContent: isHere ? "This branch" : isCheapest ? "Cheapest" : "" }),
            ),
            chevron(),
          ),
        );
      }),
    ),
  );
}

/**
 * The item's typical price per day (line) inside the lowest–highest bazar band, 7 or 30 days.
 * Needs 3 usable days (see usableDays in src/api.ts); until then, says when it will appear.
 */
function priceChart(days, name) {
  const box = el("section", { className: "chart", ariaLabel: `${name} price history` });
  if (days.length < 3) {
    box.append(el("p", { className: "chart-note", textContent: "A price chart appears here once there are 3 days of rates." }));
    return box;
  }
  const W = 300; // plot width; price labels sit to its right
  const H = 150;
  const draw = (n) => {
    const d = days.slice(-n);
    const lo = Math.floor(Math.min(...d.map((x) => x.min)) / 10) * 10;
    const hi = Math.max(lo + 10, Math.ceil(Math.max(...d.map((x) => x.max)) / 10) * 10);
    const x = (k) => ((k / (d.length - 1)) * W).toFixed(1);
    const y = (v) => (6 + (1 - (v - lo) / (hi - lo)) * (H - 6)).toFixed(1);
    const upper = d.map((p, k) => `${x(k)},${y(p.max)}`);
    const lower = d.map((p, k) => `${x(k)},${y(p.min)}`).reverse();
    const last = d[d.length - 1];
    const ticks = [0, Math.round((d.length - 1) / 2), d.length - 1];
    const first = d[0];
    box.replaceChildren(
      el(
        "div",
        { className: "chart-head" },
        el("span", { textContent: `Typical price, last ${plural(d.length, "day")}` }),
        days.length > 7
          ? el(
              "div",
              { className: "chart-tabs", role: "group", ariaLabel: "Chart period" },
              ...[7, 30].map((k) =>
                el("button", {
                  type: "button",
                  className: "chip",
                  textContent: `${k} days`,
                  ariaPressed: String(n === k),
                  onclick: () => draw(k),
                }),
              ),
            )
          : null,
      ),
      svg(
        "svg",
        {
          viewBox: `0 0 ${W + 40} ${H + 22}`,
          role: "img",
          "aria-label": `Typical ${name} price from ${rupees(first.median)} on ${dayFmt.format(new Date(`${first.date}T00:00:00Z`))} to ${rupees(last.median)} on ${dayFmt.format(new Date(`${last.date}T00:00:00Z`))}`,
        },
        ...[hi, (hi + lo) / 2, lo].flatMap((v) => [
          svg("line", { class: "grid", x1: 0, x2: W, y1: y(v), y2: y(v) }),
          svg("text", { x: W + 8, y: (Number(y(v)) + 4).toFixed(1) }, `₹${money(v)}`),
        ]),
        svg("path", { class: "band", d: `M${upper.join(" L")} L${lower.join(" L")} Z` }),
        svg("polyline", { class: "line", points: d.map((p, k) => `${x(k)},${y(p.median)}`).join(" ") }),
        svg("rect", { class: "end", x: W - 4, y: Number(y(last.median)) - 4, width: 8, height: 8 }),
        ...ticks.map((k, j) =>
          svg(
            "text",
            { x: x(k), y: H + 18, "text-anchor": j === 0 ? "start" : j === ticks.length - 1 ? "end" : "middle" },
            dayFmt.format(new Date(`${d[k].date}T00:00:00Z`)),
          ),
        ),
      ),
      el(
        "div",
        { className: "chart-key", ariaHidden: "true" },
        el("span", {}, el("i", { className: "k-line" }), "Typical price"),
        el("span", {}, el("i", { className: "k-band" }), "Lowest to highest branch"),
      ),
    );
  };
  draw(Math.min(30, days.length) > 7 ? 30 : 7);
  return box;
}

function chevron() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "chev");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M9 6l6 6-6 6");
  svg.append(path);
  return svg;
}

// ---------- Bazar list ----------

function openMarkets() {
  els.mkSearch.value = "";
  renderMarkets();
  els.markets.showModal();
  els.mkBody.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
}

function renderMarkets() {
  const q = els.mkSearch.value.trim().toLowerCase();
  const hits = state.all.filter((m) => !q || m.name.toLowerCase().includes(q) || m.district.toLowerCase().includes(q));
  const today = hits.filter(reportedToday);
  const later = hits.filter((m) => !reportedToday(m));
  const currentId = state.market?.id;

  const pick = (id) => {
    els.markets.close();
    if (String(id ?? "") !== String(currentId ?? "")) go(id == null ? null : String(id));
  };
  const nearFirst = state.here && state.sheetSort === "near";
  renderSheetNear();
  const btn = (m, isLater, meta) =>
    el(
      "li",
      {},
      el(
        "button",
        {
          type: "button",
          className: `mk-btn${isLater ? " later" : ""}`,
          ariaCurrent: m.id === currentId ? "true" : "false",
          onclick: () => pick(m.id),
        },
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
  const distBtn = (m) => {
    const a = age(m);
    return btn(
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

  const allBtn = el(
    "ul",
    { className: "mk-list" },
    el(
      "li",
      {},
      el(
        "button",
        { type: "button", className: "mk-btn", ariaCurrent: currentId == null ? "true" : "false", onclick: () => pick(null) },
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

  els.mkBody.replaceChildren(
    ...(hits.length
      ? [
          q ? null : allBtn,
          nearFirst
            ? el("ul", { className: "mk-list" }, ...[...byDistance(hits), ...hits.filter((m) => !located(m))].map(distBtn))
            : null,
          nearFirst ? null : today.length ? el("h3", { className: "sheet-section", textContent: `Reporting today · ${today.length}` }) : null,
          nearFirst ? null : today.length ? el("ul", { className: "mk-list" }, ...today.map((m) => btn(m, false))) : null,
          nearFirst ? null : later.length ? el("h3", { className: "sheet-section muted", textContent: `Not reported today · ${later.length}` }) : null,
          nearFirst ? null : later.length ? el("ul", { className: "mk-list" }, ...later.map((m) => btn(m, true))) : null,
        ].filter(Boolean)
      : [el("p", { className: "sheet-msg", textContent: `No branch matches “${els.mkSearch.value.trim()}”.` })]),
  );
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
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
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

/** A returning "near me" visitor's nearest branch, if the browser still allows location without asking. */
async function nearestOnReturn() {
  if (!canLocate) return null;
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" });
    if (perm?.state !== "granted") {
      if (perm?.state === "denied") store.remove("rbz.near");
      return null; // never pop a permission prompt the visitor didn't tap for
    }
    await locate(5000);
  } catch {
    return null;
  }
  return byDistance()[0] ?? null;
}

/** Runs a "Use my location" tap: busy label, then `then()`, or an explanation in `msg`. */
async function useLocation(btn, label, msg, then) {
  const text = label.textContent;
  btn.disabled = true;
  label.textContent = "Finding you…";
  try {
    await locate();
    then();
  } catch (err) {
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
  const box = els.nearAsk;
  box.hidden = true;
  if (!canLocate || !state.all.some(located)) return;
  if (state.here) {
    const [m] = byDistance();
    box.replaceChildren(
      el(
        "div",
        { className: "wrap" },
        el(
          "button",
          { type: "button", className: "near-go", onclick: () => go(String(m.id)) },
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
    btn.onclick = () => useLocation(btn, btn, msg, () => go(String(byDistance()[0].id)));
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

/** One branch: its distance from the visitor (if known) and a Directions link to Google Maps. */
function renderNearLine(m) {
  els.nearLine.hidden = els.directions.hidden = true;
  if (!m || !located(m)) return;
  els.directions.href = `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}`;
  els.directions.hidden = false;
  if (!state.here) return;
  const d = kmText(km(state.here, m));
  els.nearLine.replaceChildren(pinIcon(), byDistance()[0]?.id === m.id ? `Nearest to you · about ${d}` : `About ${d} from you`);
  els.nearLine.hidden = false;
}

/** Branch list: "Use my location" until we know where the visitor is, then the sort toggle. */
function renderSheetNear() {
  const box = els.mkNear;
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

function setFresh(text, stale = false) {
  els.fresh.classList.toggle("stale", stale);
  els.fresh.textContent = text;
}

init();
