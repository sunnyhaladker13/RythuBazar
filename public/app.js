// Rythu Bazar Prices — vanilla client for /api/*.
// Default view: every bazar at once (price range, where it's cheapest).
// ?market=<id> narrows to one bazar.

const $ = (id) => document.getElementById(id);
const els = {
  today: $("today"),
  back: $("back"),
  title: $("title"),
  sub: $("sub"),
  fresh: $("fresh"),
  board: $("board"),
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
  mkSearch: $("mk-search"),
  mkBody: $("mk-body"),
};

// rbzts item name → English label, Telugu name, tile colour.
const ITEMS = {
  Aratikaya: ["Raw banana", "అరటికాయ", "#6f9a3b"],
  "Beet Root": ["Beetroot", "బీట్‌రూట్", "#9b1f45"],
  Bhendi: ["Okra (bhindi)", "బెండకాయ", "#5f9a3a"],
  "Bitter Gourd": ["Bitter gourd", "కాకరకాయ", "#4d7a2a"],
  "Bottle Gourd": ["Bottle gourd", "సొరకాయ", "#a8c66c"],
  Brinjal: ["Brinjal", "వంకాయ", "#5b3a78"],
  Cabbage: ["Cabbage", "క్యాబేజీ", "#9cc56b"],
  Carrot: ["Carrot", "క్యారెట్", "#f07d22"],
  Cauliflower: ["Cauliflower", "కాలీఫ్లవర్", "#e8dfbf"],
  "Cluster Beans": ["Cluster beans", "గోరుచిక్కుడు", "#6a9a40"],
  "Colocasia(Chama)": ["Colocasia (arbi)", "చామదుంప", "#7a5a44"],
  Cucumber: ["Cucumber", "దోసకాయ", "#6aa84f"],
  Donda: ["Ivy gourd (tindora)", "దొండకాయ", "#4b8a3a"],
  "Field Beans": ["Field beans", "చిక్కుడుకాయ", "#7aa54a"],
  "French Beans": ["French beans", "బీన్స్", "#4f8a2e"],
  "Green Chillies": ["Green chillies", "పచ్చిమిర్చి", "#3f8f3a"],
  Kanda: ["Elephant foot yam", "కంద", "#8c6a4a"],
  Keera: ["Keera (cucumber)", "కీర దోసకాయ", "#3e7d3a"],
  "Leafy Vegetables": ["Leafy greens", "ఆకుకూరలు", "#2f7d32"],
  Mulagakada: ["Drumstick", "మునగకాయ", "#567d2e"],
  "Onions-I": ["Onion", "ఉల్లిపాయ", "#b04a7a"],
  Potato: ["Potato", "బంగాళదుంప", "#c9a26b"],
  "Ribbed Gourd": ["Ridge gourd", "బీరకాయ", "#6d8f3e"],
  Rice: ["Rice", "బియ్యం", "#e8e0cc"],
  "Snake Gourd": ["Snake gourd", "పొట్లకాయ", "#8fb35a"],
  Tomato: ["Tomato", "టమాటా", "#e2412f"],
};
const STAPLES = [
  ["Tomato", "Tomato"],
  ["Onions-I", "Onion"],
  ["Potato", "Potato"],
];
// Sold per piece or bunch at some bazars and per kg at others; the source doesn't say which.
const UNIT_VARIES = new Set(["Mulagakada", "Leafy Vegetables"]);

const info = (item) => {
  const [en, te, color] = ITEMS[item] ?? [item, "", "#a6a8aa"];
  return { en, te, color };
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
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const fmtDate = (ymd) => dateFmt.format(new Date(`${ymd}T00:00:00Z`));
const money = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
const rupees = (n) => `₹${money(n)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
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
  show(urlMarket());
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
  state.current = {
    date: data.today,
    isToday: true,
    items: data.items.map((i) => ({
      item: i.item,
      price: i.min, // lowest rate, so "Cheapest first" sorts by it
      stats: { min: i.min, max: i.max, median: i.median, markets: i.markets },
      cheapest: i.cheapest,
    })),
  };
  if (!data.items.length) {
    setFresh(`No bazar has posted rates yet${checked}`, true);
    els.notice.replaceChildren(
      el(
        "div",
        { className: "card notice" },
        el("h2", { textContent: "No rates yet" }),
        el("p", { textContent: "Bazars usually post rates by 1 PM. This page fills in on its own as they do." }),
      ),
    );
  } else {
    setFresh(`${data.reportedToday} of ${data.markets} bazars reported today${checked}`, data.reportedToday === 0);
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

  let data;
  try {
    data = await api(`/api/prices?market=${encodeURIComponent(id)}`);
  } catch {
    state.current = null;
    setFresh("Couldn't load rates for this bazar. Try again in a bit.", true);
    return;
  }
  if (String(state.market?.id) !== id) return; // navigated away meanwhile
  state.market = data.market;
  state.current = data;
  const { date, isToday, market, items } = data;
  document.title = `${market.name} · Rythu Bazar rates today`;
  const checked = market.lastCheckedAt ? ` · checked ${timeFmt.format(new Date(market.lastCheckedAt))}` : "";
  els.sub.textContent = `${market.district}${items.length ? ` · ${plural(items.length, "item")}` : ""}`;

  if (!date || !items.length) {
    setFresh(`No rates yet today${checked}`, true);
    els.notice.replaceChildren(notReported(market));
  } else if (isToday) {
    setFresh(`Today's rates${checked}`);
  } else {
    setFresh(`Not updated today · showing ${fmtDate(date)}${checked}`, true);
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
  const near = today.filter((m) => m.district === market.district);
  const picks = (near.length ? near : today).slice(0, 3);
  return el(
    "div",
    {},
    el(
      "div",
      { className: "card notice" },
      el("h2", { textContent: "Not published yet" }),
      el("p", {
        textContent:
          "Bazars usually post rates by 1 PM. We check again every 30 minutes, so this page fills in on its own.",
      }),
    ),
    picks.length
      ? el(
          "div",
          { className: "nearby" },
          el("h3", { textContent: near.length ? "Nearby with today's rates" : "Bazars with today's rates" }),
          ...picks.map((m) =>
            el(
              "button",
              { type: "button", className: "nearby-btn", onclick: () => go(String(m.id)) },
              el(
                "span",
                { className: "what" },
                el("span", { className: "en", textContent: m.name }),
                el("span", { className: "sub", textContent: `${m.district} · ${plural(m.itemCount, "item")}` }),
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
  const n = `${s.markets} bazars`;
  if (s.min === s.max) return { tone: "plain", text: `Same price at all ${n}` };
  if (!state.market) {
    const c = i.cheapest ?? [];
    const where = c.length === 1 ? c[0] : `${c.length} bazars`;
    return { tone: "plain", text: `Cheapest at ${where}` };
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
  const tiles = STAPLES.map(([key, label]) => {
    const i = items.find((x) => x.item === key);
    if (!i) return null;
    const s = i.stats;
    const priceText = priceLabel(i);
    let note = "per kg";
    if (s && s.markets > 1) {
      if (!state.market) note = `per kg · ${s.markets} bazars`;
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
        ariaLabel: `${label} ${priceText} per kg${state.market ? "" : " across bazars"}. Compare bazars`,
      },
      el("span", { className: "label", textContent: label }),
      el("span", { className: "te", textContent: info(key).te }),
      el("span", { className: `num${priceText.length > 5 ? " small" : ""}`, textContent: priceText }),
      el("span", { className: "note", textContent: note }),
    );
  }).filter(Boolean);
  els.board.replaceChildren(...tiles);
  els.board.hidden = tiles.length === 0;
}

function render() {
  for (const chip of document.querySelectorAll("[data-sort]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.sort === state.sort));
  }
  if (!state.current) return;
  const q = els.search.value.trim().toLowerCase();
  let items = state.current.items.filter((i) => {
    if (!q) return true;
    const { en, te } = info(i.item);
    return i.item.toLowerCase().includes(q) || en.toLowerCase().includes(q) || te.includes(q);
  });
  if (state.sort === "az") items = items.slice().sort((a, b) => info(a.item).en.localeCompare(info(b.item).en));
  if (state.sort === "cheap") items = items.slice().sort((a, b) => a.price - b.price);
  if (state.sort === "deals") items = items.slice().sort(compareDeals);

  els.prices.replaceChildren(...items.map(row));
  els.empty.hidden = items.length > 0 || state.current.items.length === 0;
  els.empty.textContent = q ? `Nothing matches “${els.search.value.trim()}”.` : "";
}

function row(i) {
  const { en, te, color } = info(i.item);
  const v = verdict(i);
  const s = i.stats;
  const unitVaries = UNIT_VARIES.has(i.item);
  // All bazars: the range is the headline, so the strip only earns its place inside one bazar.
  const showStrip = Boolean(state.market) && comparable(i) && s.max > s.min;
  const pos = (p) => `${((p - s.min) / (s.max - s.min)) * 100}%`;
  const priceText = priceLabel(i);

  const label = [
    en,
    `${priceText}${unitVaries ? "" : " per kg"}${state.market ? "" : " across bazars"}`,
    v?.text,
    "Compare bazars",
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
        unitVaries ? el("span", { className: "badge plain", textContent: "Per piece or bunch at some bazars" }) : null,
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
  els.cmpBody.replaceChildren(el("p", { className: "sheet-msg", textContent: "Comparing bazars…" }));
  els.compare.showModal();
  let data;
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
      el("p", { className: "sheet-msg", textContent: "No other bazar has reported this item in the last three days." }),
    );
    return;
  }
  const min = list[0].price;
  const max = list[list.length - 1].price;
  const cheapest = list.filter((m) => m.price === min);
  const unitVaries = UNIT_VARIES.has(i.item);
  const where = cheapest.length === 1 ? `${cheapest[0].market} at ${rupees(min)}` : `${plural(cheapest.length, "bazar")} at ${rupees(min)}`;
  let summary;
  if (unitVaries) summary = `Bazars sell this by different units, so these rates don't compare directly.`;
  else if (!here) summary = `${rupees(min)} to ${rupees(max)}/kg across bazars. Cheapest is ${where}.`;
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
        el("span", { textContent: `${plural(list.length, "bazar")}, last 3 days` }),
        el("span", { textContent: `${rupees(min)} – ${rupees(max)}` }),
        unitVaries ? el("span", { className: "warn", textContent: "Units differ: per kg, piece or bunch" }) : null,
      ),
    ),
    el(
      "ol",
      { className: "cmp-list", ariaLabel: "Bazars, cheapest first. Tap one to see all its prices" },
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
              el("small", { textContent: isHere ? "This bazar" : isCheapest ? "Cheapest" : "" }),
            ),
            chevron(),
          ),
        );
      }),
    ),
  );
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
  const btn = (m, isLater) =>
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
          today.length ? el("h3", { className: "sheet-section", textContent: `Reporting today · ${today.length}` }) : null,
          today.length ? el("ul", { className: "mk-list" }, ...today.map((m) => btn(m, false))) : null,
          later.length ? el("h3", { className: "sheet-section muted", textContent: `Not reported today · ${later.length}` }) : null,
          later.length ? el("ul", { className: "mk-list" }, ...later.map((m) => btn(m, true))) : null,
        ].filter(Boolean)
      : [el("p", { className: "sheet-msg", textContent: `No bazar matches “${els.mkSearch.value.trim()}”.` })]),
  );
}

function setFresh(text, stale = false) {
  els.fresh.classList.toggle("stale", stale);
  els.fresh.textContent = text;
}

init();
