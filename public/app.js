// Rythu Bazar Prices — vanilla client for /api/*.

const $ = (id) => document.getElementById(id);
const els = {
  today: $("today"),
  market: $("market"),
  search: $("search"),
  status: $("status"),
  prices: $("prices"),
  empty: $("empty"),
};

// English names for the Telugu terms rbzts uses.
const ALIASES = {
  Aratikaya: "Raw banana",
  Bhendi: "Okra (bhindi)",
  Donda: "Ivy gourd (tindora)",
  Mulagakada: "Drumstick",
  Kanda: "Elephant foot yam",
  "Colocasia(Chama)": "Colocasia (arbi)",
};

const STORE_KEY = "rbz.market";
const store = {
  get() {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {}
  },
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const longDateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const fmtDate = (ymd, f = dateFmt) => f.format(new Date(`${ymd}T00:00:00Z`));
const rupees = (n) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

let current = null; // { market, date, isToday, items }

async function init() {
  let data;
  try {
    data = await api("/api/markets");
  } catch {
    setStatus("Couldn't load markets. Check your connection and refresh.", true);
    return;
  }
  els.today.textContent = `Telangana · ${fmtDate(data.today, longDateFmt)}`;

  const all = data.districts.flatMap((d) => d.markets);
  if (!all.length) {
    els.market.replaceChildren(el("option", { textContent: "No markets yet" }));
    setStatus("Prices haven't been collected yet. Check back shortly.");
    return;
  }

  els.market.replaceChildren(
    ...data.districts.map((d) =>
      el(
        "optgroup",
        { label: d.name },
        ...d.markets.map((m) =>
          el("option", {
            value: String(m.id),
            textContent: m.lastReportedDate === data.today ? m.name : `${m.name} (not updated today)`,
          }),
        ),
      ),
    ),
  );

  const saved = store.get();
  const fallback =
    all.find((m) => m.lastReportedDate === data.today && m.name === "Mehdipatnam") ??
    all.find((m) => m.lastReportedDate === data.today) ??
    all[0];
  els.market.value = saved && all.some((m) => String(m.id) === saved) ? saved : String(fallback.id);
  els.market.disabled = false;
  els.market.addEventListener("change", () => {
    store.set(els.market.value);
    loadMarket(els.market.value);
  });
  els.search.addEventListener("input", render);
  loadMarket(els.market.value);
}

async function loadMarket(id) {
  setStatus("Loading prices…");
  els.prices.replaceChildren();
  try {
    current = await api(`/api/prices?market=${encodeURIComponent(id)}`);
  } catch {
    current = null;
    setStatus("Couldn't load prices for this market. Try again in a bit.", true);
    return;
  }
  const { date, isToday, market, items } = current;
  const checked = market.lastCheckedAt ? ` · checked ${timeFmt.format(new Date(market.lastCheckedAt))}` : "";
  if (!date || !items.length) {
    setStatus(`${market.name} hasn't published any rates yet${checked}.`, true);
  } else if (isToday) {
    setStatus(`Today's rates at ${market.name}${checked}`);
  } else {
    setStatus(`<strong>Not updated today.</strong> Showing rates from ${fmtDate(date)}${checked}.`, true, true);
  }
  render();
}

function render() {
  if (!current) return;
  const q = els.search.value.trim().toLowerCase();
  const items = current.items.filter(
    (i) => !q || i.item.toLowerCase().includes(q) || (ALIASES[i.item] ?? "").toLowerCase().includes(q),
  );
  els.prices.replaceChildren(...items.map(row));
  els.empty.hidden = items.length > 0 || current.items.length === 0;
  els.empty.textContent = q ? `Nothing matches “${els.search.value.trim()}”.` : "";
}

function row(i) {
  const alias = ALIASES[i.item];
  const details = el(
    "details",
    {},
    el(
      "summary",
      {},
      el("span", { className: "item" }, alias ?? i.item, alias ? el("small", { textContent: i.item }) : null),
      el("span", { className: "price", textContent: rupees(i.price) }),
      el("span", { className: "chev", ariaHidden: "true", textContent: "›" }),
    ),
  );
  const panel = el("div", { className: "compare" });
  details.append(panel);
  details.addEventListener("toggle", () => {
    if (details.open && !panel.dataset.loaded) loadCompare(i.item, panel);
  });
  return el("li", {}, details);
}

async function loadCompare(item, panel) {
  panel.dataset.loaded = "1";
  panel.replaceChildren(el("p", { textContent: "Comparing markets…" }));
  try {
    const data = await api(`/api/item?name=${encodeURIComponent(item)}`);
    const hereId = current?.market.id;
    if (data.markets.length < 2) {
      panel.replaceChildren(el("p", { textContent: "No other market has reported this item recently." }));
      return;
    }
    panel.replaceChildren(
      el("p", { textContent: `Across ${data.markets.length} markets, cheapest first` }),
      el(
        "ol",
        {},
        ...data.markets.map((m) =>
          el(
            "li",
            { className: m.marketId === hereId ? "here" : "" },
            el("span", { textContent: `${m.market}, ${m.district}` }),
            el("span", {
              className: "num",
              textContent: rupees(m.price) + (m.date === data.today ? "" : ` · ${fmtDate(m.date)}`),
            }),
          ),
        ),
      ),
    );
  } catch {
    delete panel.dataset.loaded;
    panel.replaceChildren(el("p", { textContent: "Couldn't load the comparison." }));
  }
}

function setStatus(text, stale = false, html = false) {
  els.status.classList.toggle("stale", stale);
  if (html) els.status.innerHTML = text;
  else els.status.textContent = text;
}

init();
