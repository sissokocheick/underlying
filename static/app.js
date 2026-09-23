/*
 * Underlying — front end.
 *
 * The browser owns the portfolio (localStorage). The server prices it and
 * returns the roll-ups; nothing about your holdings is stored anywhere else.
 */

const STORE_KEY = "underlying.positions.v1";
const $ = (s) => document.querySelector(s);
const usd = (n, d = 2) =>
  n == null || isNaN(n) ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => (n == null || isNaN(n) ? "—" : (n * 100).toFixed(1) + "%");
const num = (n, d = 4) => (n == null || isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let positions = load();
let lastRaw = null;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (e) { return []; }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(positions)); }

/* ---------- render ---------- */

function render(book) {
  renderHeadline(book.totals);
  renderFlags(book.flags);
  renderPositions(book.positions, book.totals);
  renderGroups($("#byUnderlying"), book.by_underlying, ["wrappers", "issuers"], true);
  renderGroups($("#byIssuer"), book.by_issuer, ["positions"], false);
  renderGroups($("#byClass"), book.by_class, ["positions"], false);
  donut($("#donutClass"), $("#legendClass"), book.by_class, "name");
  donut($("#donutIssuer"), $("#legendIssuer"), book.by_issuer, "name");
  $("#emptyBook").classList.toggle("hidden", positions.length > 0);
}

function renderHeadline(t) {
  const rows = [
    [usd(t.value, 0), "Book value"],
    [usd(t.pnl, 0), "Unrealised P&L"],
    [t.positions, "Token wrappers"],
    [t.n_underlying, "Underlying assets"],
    [t.n_issuers, "Issuers"],
  ];
  $("#headline").innerHTML = rows
    .map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`)
    .join("");
}

function renderFlags(flags) {
  const el = $("#flags");
  if (!flags.length) { el.innerHTML = ""; return; }
  el.innerHTML = flags
    .map(
      (f) => `<div class="flag ${esc(f.level)}"><div class="t">${esc(f.title)}</div><div class="d">${esc(f.detail)}</div></div>`
    )
    .join("");
}

function renderPositions(rows, totals) {
  const tb = $("#positions tbody");
  tb.innerHTML = rows
    .map((r) => {
      const cls = r.pnl == null ? "" : r.pnl >= 0 ? "up" : "down";
      const unpriced = r.value == null;
      return `<tr>
        <td class="token"><b>${esc(r.symbol)}</b><span>${esc(r.name)}</span></td>
        <td class="r num">${num(r.quantity)}</td>
        <td class="r num">${usd(r.cost_basis)}</td>
        <td class="r num ${unpriced ? "down" : ""}">${unpriced ? "no market" : usd(r.price)}</td>
        <td class="r num">${usd(r.value)}</td>
        <td class="r num ${cls}">${r.pnl == null ? "—" : usd(r.pnl) + " <span class='muted'>(" + pct(r.pnl_pct) + ")</span>"}</td>
        <td>${r.issuer_name ? `<span class="pill">${esc(r.issuer_name)}</span>` : `<span class="muted">native</span>`}</td>
        <td class="muted">${esc(r.chain || "—")}</td>
        <td><button class="del" data-id="${r.id}" title="Remove">×</button></td>
      </tr>`;
    })
    .join("");
  tb.querySelectorAll("button.del").forEach((b) =>
    b.addEventListener("click", () => {
      positions = positions.filter((p) => String(p.id) !== b.dataset.id);
      save(); refresh();
    })
  );
}

function renderGroups(el, groups, subs, showIssuers) {
  if (!groups || !groups.length) { el.innerHTML = `<p class="muted small">Nothing priced yet.</p>`; return; }
  el.innerHTML = groups
    .map((g) => {
      const sub = showIssuers
        ? `${g.n_wrappers} wrapper${g.n_wrappers > 1 ? "s" : ""} · ${g.issuers.length} issuer${g.issuers.length > 1 ? "s" : ""}: ${esc(g.issuers.join(", "))}`
            + (g.cik ? `<div class="sub">SEC CIK ${esc(g.cik)} · ${esc(g.industry || "")}</div>` : "")
            + (g.website ? `<div class="sub"><a href="${esc(g.website)}" target="_blank" rel="noopener">${esc(g.website)}</a></div>` : "")
        : `${g.n_positions} position${g.n_positions > 1 ? "s" : ""}`;
      return `<div class="bar">
        <div class="nm" title="${esc(g.name)}">${esc(g.name)}</div>
        <div class="track"><div class="fill" style="width:${(g.share * 100).toFixed(1)}%"></div></div>
        <div class="pc">${pct(g.share)}</div>
      </div><div class="sub">${sub}</div>`;
    })
    .join("");
}

/* ---------- donut (hand-rolled SVG, no chart dependency) ---------- */

const COLORS = ["#5eead4","#93c5fd","#c4b5fd","#fbbf24","#f87171","#4ade80","#f472b6","#38bdf8","#fcd34d","#a3e635"];
function donut(svg, legend, groups, labelKey) {
  svg.innerHTML = "";
  legend.innerHTML = "";
  if (!groups || !groups.length) { legend.innerHTML = `<span class="muted small">Nothing priced yet.</span>`; return; }
  const cx = 100, cy = 100, R = 84, r = 52;
  let angle = -Math.PI / 2, out = "";
  groups.slice(0, 10).forEach((g, i) => {
    const frac = g.share;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
    const col = COLORS[i % COLORS.length];
    out += `<path d="M${x0} ${y0} A${R} ${R} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${big} 0 ${x3} ${y3} Z"
      fill="${col}" stroke="var(--panel)" stroke-width="2"><title>${esc(g.name)} — ${pct(frac)}</title></path>`;
    legend.innerHTML += `<div><i style="background:${col}"></i><span>${esc(g.name)} <span class="muted">${pct(frac)}</span></span></div>`;
  });
  svg.innerHTML = out;
}

/* ---------- data ---------- */

async function refresh() {
  const body = { positions, demo: positions.length === 0 };
  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const book = await res.json();
    if (!res.ok) throw new Error(book.error || "pricing failed");
    lastRaw = book;
    render(book);
    $("#rawResponse").textContent = JSON.stringify(book.positions?.slice(0, 3), null, 1);
  } catch (e) {
    $("#flags").innerHTML = `<div class="flag high"><div class="t">Could not price the book</div><div class="d">${esc(e.message)}</div></div>`;
  }
}

/* ---------- search & add ---------- */

let pending = null;
const box = $("#searchBox"), results = $("#searchResults"), addBtn = $("#addBtn");

box.addEventListener("input", async () => {
  const q = box.value.trim();
  results.innerHTML = "";
  pending = null;
  addBtn.disabled = true;
  if (q.length < 1) return;
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(q));
    const data = await res.json();
    const all = [
      ...(data.native || []).map((n) => ({ ...n, kind: "crypto" })),
      ...(data.wrappers || []).map((w) => ({ ...w, kind: "rwa" })),
    ];
    results.innerHTML = all
      .slice(0, 8)
      .map(
        (t, i) => `<div class="res" data-i="${i}"><span class="k">${esc(t.kind)}</span>
          <b>${esc(t.symbol)}</b><span class="muted small">${esc(t.name)}</span>
          ${t.issuer_name ? `<span class="pill">${esc(t.issuer_name)}</span>` : ""}</div>`
      )
      .join("") || `<p class="muted small" style="margin:6px">No match.</p>`;
    results.querySelectorAll(".res").forEach((el) =>
      el.addEventListener("click", () => {
        const t = all[+el.dataset.i];
        pending = t;
        box.value = t.symbol + " — " + t.name;
        results.innerHTML = "";
        addBtn.disabled = false;
        qtyAndCost(pending);
      })
    );
  } catch (e) {
    results.innerHTML = `<p class="muted small">Search failed: ${esc(e.message)}</p>`;
  }
});

function qtyAndCost(t) {
  // Cost basis is required because this plan has no historical quotes endpoint.
  const qty = prompt(`Quantity of ${t.symbol}?`, "1");
  if (qty === null) return;
  const cost = prompt(`Average USD paid per ${t.symbol}? (This plan has no price history, so this is entered by hand.)`, "");
  if (cost === null) return;
  positions.push({
    id: Date.now(),
    crypto_id: t.crypto_id,
    quantity: parseFloat(qty) || 0,
    cost_basis: parseFloat(cost) || null,
  });
  save();
  box.value = "";
  addBtn.disabled = true;
  refresh();
}

addBtn.addEventListener("click", () => { if (pending) qtyAndCost(pending); });
box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !addBtn.disabled) addBtn.click(); });
document.addEventListener("click", (e) => {
  if (!e.target.closest(".sec-actions") && !e.target.closest(".results")) results.innerHTML = "";
});

$("#demoBtn").addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  positions = [];
  refresh();
  document.getElementById("holdings").scrollIntoView({ behavior: "smooth" });
});

/* ---------- evidence panel ---------- */

async function loadCapabilities() {
  try {
    const res = await fetch("/api/capabilities");
    const data = await res.json();
    const eps = data.endpoints || {};
    $("#endpointList").innerHTML = Object.entries(eps)
      .map(
        ([name, r]) =>
          `<li><span class="${r.ok ? "ok" : "no"}">${r.ok ? "●" : "○"}</span> ${esc(name)}
           ${r.ok ? "" : `<span class="code">${esc(r.error || "")}</span>`}</li>`
      )
      .join("");
  } catch (e) {
    $("#endpointList").innerHTML = `<li class="no">unavailable: ${esc(e.message)}</li>`;
  }
}

refresh();
loadCapabilities();
