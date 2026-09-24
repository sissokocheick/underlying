/*
 * Underlying — front end.
 *
 * Client-side portfolio intelligence for tokenised real-world assets & crypto.
 * Built on the CoinMarketCap API.
 */

const STORE_KEY = "underlying.positions.v1";
const $ = (s) => document.querySelector(s);
const usd = (n, d = 2) =>
  n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => (n == null || isNaN(n) ? "—" : (n * 100).toFixed(1) + "%");
const num = (n, d = 4) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let positions = loadFromHash() || load();
let demoPositions = [];
let lastRaw = null;
let apiEndpointsData = [];

function shown() {
  return positions.length > 0 ? positions : demoPositions;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (e) { return []; }
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(positions));
  syncHash();
}

function syncHash() {
  if (positions.length > 0) {
    try {
      const compact = positions.map((p) => [p.crypto_id, p.quantity, p.cost_basis]);
      const b64 = btoa(JSON.stringify(compact));
      history.replaceState(null, "", "#b=" + encodeURIComponent(b64));
    } catch (e) {}
  } else {
    history.replaceState(null, "", location.pathname);
  }
}

function loadFromHash() {
  if (location.hash.startsWith("#b=")) {
    try {
      const b64 = decodeURIComponent(location.hash.slice(3));
      const parsed = JSON.parse(atob(b64));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, i) => ({
          id: Date.now() + i,
          crypto_id: item[0],
          quantity: item[1],
          cost_basis: item[2] ?? null,
        }));
      }
    } catch (e) {}
  }
  return null;
}

/* ---------- toast ---------- */
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}

/* ---------- render ---------- */

function render(book) {
  renderHeadline(book.totals);
  renderRiskRadar(book.totals);
  renderFlags(book.flags || []);
  renderPositions(book.positions || [], book.totals);
  renderComparison(book.wrapper_comparison || []);
  renderGroups($("#byUnderlying"), book.by_underlying || [], ["wrappers", "issuers"], true);
  renderGroups($("#byIssuer"), book.by_issuer || [], ["positions"], false);
  renderGroups($("#byClass"), book.by_class || [], ["positions"], false);
  donut($("#donutClass"), $("#legendClass"), book.by_class || [], "name");
  donut($("#donutIssuer"), $("#legendIssuer"), book.by_issuer || [], "name");
  $("#emptyBook").classList.toggle("hidden", shown().length > 0);
}

function renderHeadline(t) {
  if (!t) return;
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

  const steps = [
    [t.positions, "token wrappers", "what you bought"],
    [t.n_underlying, "underlying assets", "what you're exposed to"],
    [t.n_issuers, "issuers", "who you owe it to"],
  ];
  const max = steps[0][0] || 1;
  $("#funnel").innerHTML = steps
    .map(
      ([n, label, why], i) => `<div class="fstep" style="--w:${Math.max((n / max) * 100, 8)}%;--d:${i * 90}ms">
        <div class="fbar"><span class="fn">${n}</span><span class="fl">${label}</span></div>
        <div class="fw">${why}</div>
      </div>`
    )
    .join("");
}

function renderRiskRadar(t) {
  const el = $("#riskRadar");
  if (!t || !t.stress_test) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const hhi = t.counterparty_hhi || 0;
  const level = t.hhi_level || "critical";
  const st = t.stress_test;

  el.innerHTML = `
    <div class="radar-head">
      <span class="radar-title">Counterparty Risk Radar</span>
      <span class="risk-pill ${esc(level)}">${esc(level)} Concentration</span>
    </div>
    <div class="radar-val">HHI: ${num(hhi, 0)} <span class="muted small">(threshold 2,500)</span></div>
    <div class="radar-hhi-desc">Herfindahl-Hirschman Index over tokenised collateral</div>
    <div class="radar-scenario">
      <b>Default Stress Scenario:</b> ${esc(st.scenario)}
    </div>
  `;
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
      const isRwa = r.kind === "rwa";

      let underCol = `<span class="muted">—</span>`;
      if (isRwa && r.asset_name) {
        const cikPart = r.company?.cik
          ? `<a class="cik-badge" href="${esc(r.edgar_url || 'https://www.sec.gov/edgar/browse/?CIK=' + r.company.cik)}" target="_blank" rel="noopener" title="View SEC EDGAR filings for ${esc(r.asset_name)}">SEC CIK ${esc(r.company.cik)} ↗</a>`
          : `<span class="pill">${esc(r.asset_type || "RWA")}</span>`;
        underCol = `<div><b>${esc(r.asset_name)}</b><div style="margin-top:2px">${cikPart}</div></div>`;
      } else if (!isRwa) {
        underCol = `<span class="pill">Native Crypto</span>`;
      }

      return `<tr>
        <td class="token">
          <b>${esc(r.symbol)}</b>
          <span>${esc(r.name)}</span>
        </td>
        <td class="r num">${num(r.quantity)}</td>
        <td class="r num">${usd(r.cost_basis)}</td>
        <td class="r num ${unpriced ? "down" : ""}">${unpriced ? "no market" : usd(r.price)}</td>
        <td class="r num">${usd(r.value)}</td>
        <td class="r num ${cls}">${r.pnl == null ? "—" : usd(r.pnl) + " <span class='muted'>(" + pct(r.pnl_pct) + ")</span>"}</td>
        <td>${r.issuer_name ? `<span class="pill issuer">${esc(r.issuer_name)}</span>` : `<span class="muted">None (Decentralised)</span>`}</td>
        <td>${underCol}</td>
        <td class="muted">${esc(r.chain || "Native")}</td>
        <td><button class="del" data-id="${r.id}" title="Remove position">×</button></td>
      </tr>`;
    })
    .join("");

  tb.querySelectorAll("button.del").forEach((b) =>
    b.addEventListener("click", () => {
      if (positions.length > 0) {
        positions = positions.filter((p) => String(p.id) !== b.dataset.id);
      } else {
        demoPositions = demoPositions.filter((p) => String(p.id) !== b.dataset.id);
      }
      save(); refresh();
    })
  );
}

function renderGroups(el, groups, subs, showIssuers) {
  if (!groups || !groups.length) { el.innerHTML = `<p class="muted small">Nothing priced yet.</p>`; return; }
  el.innerHTML = groups
    .map((g) => {
      const sub = showIssuers
        ? (g.issuers.length
            ? `${g.n_wrappers} wrapper${g.n_wrappers > 1 ? "s" : ""} · ${g.issuers.length} issuer${g.issuers.length > 1 ? "s" : ""}: ${esc(g.issuers.join(", "))}`
            : `${g.n_wrappers} wrapper · native crypto, no counterparty`)
            + (g.cik ? `<div class="sub"><a class="cik-badge" href="${esc(g.edgar_url || 'https://www.sec.gov/edgar/browse/?CIK=' + g.cik)}" target="_blank" rel="noopener">SEC CIK ${esc(g.cik)}</a> · ${esc(g.industry || "")}</div>` : "")
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

function renderComparison(groups) {
  const el = $("#compare");
  if (!groups.length) { el.innerHTML = `<p class="muted small">Hold the same company through more than one wrapper and this ranks exit liquidity &amp; basis spreads.</p>`; return; }
  el.innerHTML = groups
    .map(
      (g) => `<div class="cmp">
        <div class="cmp-h"><b>${esc(g.name)}</b><span class="muted small">${g.wrappers.length} wrappers, one underlying asset</span></div>
        ${g.wrappers
          .map(
            (w, i) => `<div class="cmp-row ${i === 0 ? "best" : ""} ${w.priced ? "" : "unpriced"}">
              ${i === 0 ? `<span class="tag">deepest market</span>` : ""}
              <b>${esc(w.symbol)}</b>
              <span class="pill issuer">${esc(w.issuer_name || "—")}</span>
              <span class="muted small">${esc(w.chain || "—")}</span>
              ${w.spread_bps != null ? `<span class="spread-tag">${w.spread_bps >= 0 ? "+" : ""}${w.spread_bps} bps basis</span>` : ""}
              ${w.liquidity_ratio != null ? `<span class="liq-tag">${w.liquidity_ratio}x thinner</span>` : ""}
              <span class="r num">${w.priced ? usd(w.price) : "no market"}</span>
              <span class="r num muted">${w.volume_24h ? usd(w.volume_24h, 0) + " 24h vol" : ""}</span>
            </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
}

/* ---------- donut ---------- */
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

/* ---------- data refresh ---------- */

async function refresh() {
  const isDemo = positions.length === 0;
  const body = { positions: shown(), demo: isDemo && demoPositions.length === 0 };
  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const book = await res.json();
    if (!res.ok && !book.positions) throw new Error(book.error || "pricing failed");
    lastRaw = book;
    if (isDemo && demoPositions.length === 0) demoPositions = book.positions || [];
    render(book);
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
          ${t.issuer_name ? `<span class="pill issuer">${esc(t.issuer_name)}</span>` : ""}</div>`
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
  const holder = $("#addPanel");
  holder.innerHTML = `<div class="add-panel" id="ap">
    <div class="add-token"><b>${esc(t.symbol)}</b><span class="muted small">${esc(t.name || "")}</span>
      ${t.issuer_name ? `<span class="pill issuer">${esc(t.issuer_name)}</span>` : ""}</div>
    <label>Quantity<input id="apQty" type="number" min="0" step="any" value="1"></label>
    <label>Avg USD paid<input id="apCost" type="number" min="0" step="any" placeholder="optional"></label>
    <button id="apSave" class="primary">Add position</button>
    <button id="apCancel" class="ghost">Cancel</button>
  </div>`;
  holder.classList.remove("hidden");
  const qtyEl = $("#apQty");
  qtyEl.focus();
  qtyEl.select();

  const close = () => {
    holder.innerHTML = "";
    holder.classList.add("hidden");
    box.value = "";
    addBtn.disabled = true;
  };

  $("#apCancel").addEventListener("click", close);
  $("#apSave").addEventListener("click", () => {
    const qty = parseFloat($("#apQty").value);
    const costRaw = $("#apCost").value.trim();
    const cost = costRaw === "" ? null : parseFloat(costRaw);
    if (!(qty > 0)) { qtyEl.focus(); qtyEl.classList.add("bad-input"); return; }
    if (positions.length > 0) {
      positions.push({ id: Date.now(), crypto_id: t.crypto_id, quantity: qty, cost_basis: cost });
    } else {
      demoPositions = demoPositions.concat([{ id: Date.now(), crypto_id: t.crypto_id, quantity: qty, cost_basis: cost }]);
    }
    save(); close(); refresh();
  });
  holder.onkeydown = (e) => { if (e.key === "Escape") close(); };
}

addBtn.addEventListener("click", () => { if (pending) qtyAndCost(pending); });
box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !addBtn.disabled) addBtn.click(); });
document.addEventListener("click", (e) => {
  if (!e.target.closest(".sec-actions") && !e.target.closest(".results")) results.innerHTML = "";
});

$("#demoBtn").addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  positions = [];
  demoPositions = [];
  history.replaceState(null, "", location.pathname);
  refresh();
  document.getElementById("holdings").scrollIntoView({ behavior: "smooth" });
});

/* ---------- CSV import ---------- */

$("#importBtn").addEventListener("click", () => {
  const holder = $("#addPanel");
  holder.innerHTML = `<div class="add-panel" id="imp">
    <div class="add-token"><b>Paste positions (CSV)</b><span class="muted small">SYMBOL,QUANTITY,AVG_COST — one per line. Header optional.</span></div>
    <textarea id="impText" rows="6" spellcheck="false">NVDAX,90,178.40
NVDAon,40,181.10
NVDA.D,30,175
COINX,45,210
BTC,0.18,64100</textarea>
    <button id="impGo" class="primary">Price these</button>
    <button id="impCancel" class="ghost">Cancel</button>
    <div id="impNote" class="small muted"></div>
  </div>`;
  holder.classList.remove("hidden");
  $("#impText").focus();

  $("#impCancel").addEventListener("click", () => {
    holder.innerHTML = "";
    holder.classList.add("hidden");
  });

  $("#impGo").addEventListener("click", async () => {
    const btn = $("#impGo");
    const csv = $("#impText").value;
    btn.disabled = true;
    btn.textContent = "Resolving…";
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "import failed");
      const got = data.positions || [];
      if (positions.length > 0) {
        positions = positions.concat(got);
      } else {
        demoPositions = demoPositions.concat(got);
      }
      save();
      const n = got.length;
      const bad = data.unresolved || [];
      $("#impNote").innerHTML =
        (n ? `<span class="up">Added ${n} position${n > 1 ? "s" : ""}.</span> ` : "") +
        (bad.length
          ? `<span class="down">Could not resolve ${bad.length}: ${esc(bad.map(b => b.symbol).join(", "))}.</span>`
          : "");
      if (n) {
        setTimeout(() => {
          holder.innerHTML = "";
          holder.classList.add("hidden");
          refresh();
        }, bad.length ? 4000 : 700);
      } else {
        btn.disabled = false;
        btn.textContent = "Price these";
      }
    } catch (e) {
      $("#impNote").innerHTML = `<span class="down">${esc(e.message)}</span>`;
      btn.disabled = false;
      btn.textContent = "Price these";
    }
  });
});

/* ---------- Export CSV ---------- */

$("#exportBtn").addEventListener("click", () => {
  const current = lastRaw?.positions || [];
  if (!current.length) {
    toast("No positions to export.");
    return;
  }
  const headers = ["Symbol", "Name", "Type", "Quantity", "Price_USD", "Value_USD", "Cost_Basis_USD", "PnL_USD", "Issuer_Counterparty", "Underlying_Asset", "SEC_CIK", "Chain"];
  const rows = current.map((r) => [
    `"${r.symbol || ""}"`,
    `"${(r.name || "").replace(/"/g, '""')}"`,
    `"${r.kind || ""}"`,
    r.quantity || 0,
    r.price || "",
    r.value || "",
    r.cost_basis || "",
    r.pnl || "",
    `"${(r.issuer_name || "").replace(/"/g, '""')}"`,
    `"${(r.asset_name || "").replace(/"/g, '""')}"`,
    `"${r.company?.cik || ""}"`,
    `"${r.chain || ""}"`,
  ]);
  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const uri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", uri);
  link.setAttribute("download", `underlying_rwa_audit_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast("CSV Audit Report downloaded.");
});

/* ---------- Share Link ---------- */

$("#shareBtn").addEventListener("click", () => {
  syncHash();
  navigator.clipboard.writeText(location.href).then(() => {
    toast("Shareable link copied to clipboard!");
  }).catch(() => {
    toast("Link: " + location.href);
  });
});

/* ---------- EVM Wallet Scanner ---------- */

$("#scanBtn").addEventListener("click", () => {
  const holder = $("#addPanel");
  holder.innerHTML = `<div class="add-panel" id="wScan">
    <div class="add-token">
      <b>Scan EVM Wallet or Load Institutional Preset</b>
      <span class="muted small">Reads tokenised RWA balances on Ethereum &amp; Arbitrum. Zero wallet connection required (Privacy-First).</span>
    </div>
    <div class="preset-group">
      <button class="preset-btn" data-preset="treasury">🏛️ Institutional Treasury (T-Bills &amp; Gold)</button>
      <button class="preset-btn" data-preset="whale">📈 Tech Equity Multi-Wrapper</button>
    </div>
    <label style="flex:1 1 100%">
      Or enter an Ethereum / EVM Address:
      <input id="wAddr" type="text" placeholder="0x..." style="width:100%">
    </label>
    <button id="wGo" class="primary">Scan On-Chain</button>
    <button id="wCancel" class="ghost">Cancel</button>
    <div id="wNote" class="small muted" style="flex:1 1 100%"></div>
  </div>`;
  holder.classList.remove("hidden");
  document.getElementById("holdings").scrollIntoView({ behavior: "smooth" });

  $("#wCancel").addEventListener("click", () => {
    holder.innerHTML = "";
    holder.classList.add("hidden");
  });

  holder.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const preset = btn.dataset.preset;
      btn.disabled = true;
      try {
        const res = await fetch("/api/scan-wallet?preset=" + encodeURIComponent(preset));
        const data = await res.json();
        if (data.positions) {
          positions = data.positions;
          save();
          toast(`Loaded ${data.label || preset}`);
          holder.innerHTML = "";
          holder.classList.add("hidden");
          refresh();
        }
      } catch (e) {
        $("#wNote").textContent = "Preset error: " + e.message;
        btn.disabled = false;
      }
    });
  });

  $("#wGo").addEventListener("click", async () => {
    const addr = ($("#wAddr").value || "").trim();
    if (!addr.startsWith("0x") || addr.length !== 42) {
      $("#wNote").innerHTML = `<span class="down">Please enter a valid 42-character EVM address starting with 0x.</span>`;
      return;
    }
    const btn = $("#wGo");
    btn.disabled = true;
    btn.textContent = "Scanning RPC…";
    try {
      const res = await fetch("/api/scan-wallet?address=" + encodeURIComponent(addr));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      if (data.positions && data.positions.length > 0) {
        positions = data.positions;
        save();
        toast(`Found ${data.detected} RWA positions on-chain!`);
        holder.innerHTML = "";
        holder.classList.add("hidden");
        refresh();
      } else {
        $("#wNote").innerHTML = `<span class="warn">${esc(data.message)}</span>`;
        btn.disabled = false;
        btn.textContent = "Scan On-Chain";
      }
    } catch (e) {
      $("#wNote").innerHTML = `<span class="down">${esc(e.message)}</span>`;
      btn.disabled = false;
      btn.textContent = "Scan On-Chain";
    }
  });
});

/* ---------- Interactive CMC API Explorer ---------- */

async function loadCapabilitiesAndExplorer() {
  // 1. Live Capabilities probe
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

  // 2. Interactive sample console
  try {
    const res = await fetch("/api/evidence/sample");
    const data = await res.json();
    apiEndpointsData = data.endpoints || [];
    const tabsContainer = $("#apiTabs");
    tabsContainer.innerHTML = apiEndpointsData
      .map((ep, i) => `<button class="api-tab ${i === 0 ? "active" : ""}" data-idx="${i}">${esc(ep.name)}</button>`)
      .join("");

    const showEndpoint = (idx) => {
      const ep = apiEndpointsData[idx];
      if (!ep) return;
      tabsContainer.querySelectorAll(".api-tab").forEach((b, i) => b.classList.toggle("active", i === idx));
      $("#apiEndpointPurpose").textContent = ep.purpose;
      $("#apiEndpointPath").textContent = ep.path;
      $("#apiEndpointPayload").textContent = JSON.stringify(ep.sample, null, 2);
    };

    tabsContainer.querySelectorAll(".api-tab").forEach((b) => {
      b.addEventListener("click", () => showEndpoint(+b.dataset.idx));
    });

    if (apiEndpointsData.length > 0) showEndpoint(0);
  } catch (e) {}
}

refresh();
loadCapabilitiesAndExplorer();
