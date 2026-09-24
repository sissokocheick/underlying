/*
 * Underlying — Institutional RWA Look-Through Intelligence
 * Front-end Engine built on CoinMarketCap RWA & Quotes APIs
 */

const STORE_KEY = "underlying.positions.v1";
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const usd = (n, d = 2) =>
  n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => (n == null || isNaN(n) ? "—" : (n * 100).toFixed(1) + "%");
const num = (n, d = 4) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let positions = loadFromHash() || load();
let demoPositions = [];
let lastRaw = null;
let apiEndpointsData = [];
let activeFilter = "all";
let isStressSimulated = false;

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

/* ---------- Toast Notification ---------- */
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3200);
}

/* ---------- Monogram Avatar Generator ---------- */
function getMonogram(sym) {
  const s = (sym || "TK").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return s.length >= 2 ? s.slice(0, 2) : s.padEnd(2, "X");
}

function getAvatarType(row) {
  if (row.kind === "crypto") return "crypto";
  const cat = (row.asset_type || "").toLowerCase();
  if (cat.includes("treasury") || cat.includes("yield") || cat.includes("bond")) return "treasury";
  return "rwa";
}

/* ---------- Main Render ---------- */
function render(book) {
  renderFunnel(book.totals);
  renderRiskRadar(book.totals);
  renderKpis(book.totals, book.positions || []);
  renderFlags(book.flags || []);
  updateFilterCounts(book.positions || []);
  renderPositions(book.positions || [], book.totals);
  renderComparison(book.wrapper_comparison || []);
  renderGroups($("#byUnderlying"), book.by_underlying || [], ["wrappers", "issuers"], true);
  renderGroups($("#byIssuer"), book.by_issuer || [], ["positions"], false);
  renderGroups($("#byClass"), book.by_class || [], ["positions"], false);
  donut($("#donutClass"), $("#legendClass"), $("#donutClassCenter"), book.by_class || [], "name");
  donut($("#donutIssuer"), $("#legendIssuer"), $("#donutIssuerCenter"), book.by_issuer || [], "name");
  $("#emptyBook").classList.toggle("hidden", shown().length > 0);
}

/* ---------- Look-Through Funnel (Hero) ---------- */
function renderFunnel(t) {
  const el = $("#funnel");
  if (!t) { el.innerHTML = ""; return; }
  const steps = [
    { badge: "TIER 1", n: t.positions || 0, label: "Token Wrappers", why: "What you hold on Ethereum/Arbitrum" },
    { badge: "TIER 2", n: t.n_underlying || 0, label: "SEC-Verified Underlyings", why: "Real stocks & T-Bills (CIK verified)" },
    { badge: "TIER 3", n: t.n_issuers || 0, label: "Collateral Custodians", why: "Legal issuers holding bankruptcy risk" },
  ];
  const max = Math.max(steps[0].n, 1);
  el.innerHTML = steps
    .map((s) => {
      const pctWidth = Math.max((s.n / max) * 100, 15).toFixed(1);
      return `
        <div class="fstep-row">
          <div class="fstep-badge">${s.badge}</div>
          <div class="fbar-wrap">
            <div class="fbar-fill" style="width:${pctWidth}%"></div>
            <div class="fbar-content">
              <div class="fbar-title">
                <span class="fbar-count">${s.n}</span>
                <span>${s.label}</span>
              </div>
              <div class="fbar-why">${s.why}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

/* ---------- Counterparty Threat Radar ---------- */
function renderRiskRadar(t) {
  const el = $("#riskRadar");
  if (!t || !t.stress_test) {
    el.innerHTML = "";
    return;
  }
  const hhi = t.counterparty_hhi || 0;
  const level = t.hhi_level || "critical";
  const st = t.stress_test;
  const meterPct = Math.min((hhi / 10000) * 100, 100).toFixed(1);

  let scenarioDesc = isStressSimulated
    ? `<span style="color:var(--bad);font-weight:700">⚠️ ACTIVE SHOCK APPLIED:</span> Backed Finance collateral frozen. Trading halted for Backed equity wrappers.`
    : `<b>Default Stress Scenario:</b> ${esc(st.scenario)}`;

  el.innerHTML = `
    <div class="radar-head">
      <div class="radar-title-group">
        <span class="radar-icon">🛡️</span>
        <span class="radar-title">Counterparty Threat Radar</span>
      </div>
      <span class="risk-pill ${esc(level)}">${esc(level)} Risk</span>
    </div>
    <div class="radar-score-wrap">
      <div class="radar-val">${num(hhi, 0)}</div>
      <div class="radar-scale-tag">/ 10,000 HHI</div>
    </div>
    <div class="radar-meter">
      <div class="radar-meter-fill" style="width:${meterPct}%"></div>
    </div>
    <div class="radar-thresholds">
      <span>0 (Diversified)</span>
      <span>1,500 (Moderate)</span>
      <span>2,500+ (Critical)</span>
    </div>
    <div class="radar-scenario-box">
      <div class="radar-scenario-title">LEGAL COLLATERAL STRESS TEST</div>
      <div>${scenarioDesc}</div>
    </div>
  `;
}

/* ---------- Top Level KPI Cockpit Cards ---------- */
function renderKpis(t, rows) {
  const el = $("#kpiGrid");
  if (!t) { el.innerHTML = ""; return; }
  const isUp = t.pnl != null && t.pnl >= 0;
  const pnlClass = isUp ? "up" : "down";
  const pnlSign = isUp ? "+" : "";

  // Calculate RWA vs Crypto ratio
  let rwaVal = 0, totalVal = t.value || 0;
  rows.forEach((r) => {
    if (r.kind === "rwa") rwaVal += (r.value || 0);
  });
  const rwaPct = totalVal > 0 ? ((rwaVal / totalVal) * 100).toFixed(1) : "0.0";
  const cryptoPct = (100 - parseFloat(rwaPct)).toFixed(1);

  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Portfolio Net Asset Value</div>
      <div class="kpi-val">${usd(t.value, 2)}</div>
      <div class="kpi-sub">
        <span class="kpi-badge-pnl ${pnlClass}">${pnlSign}${usd(t.pnl, 2)} (${pnlSign}${pct(t.pnl_pct)})</span>
        <span>Unrealised P&L</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">RWA Look-Through Exposure</div>
      <div class="kpi-val">${rwaPct}%</div>
      <div class="kpi-sub">
        <span>${t.n_underlying} Underlyings vs ${cryptoPct}% Crypto</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Counterparty Concentration (HHI)</div>
      <div class="kpi-val" style="color:var(--warn)">${num(t.counterparty_hhi, 0)}</div>
      <div class="kpi-sub">
        <span style="color:var(--bad)">${t.hhi_level || "Critical"} Concentration</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Collateral Custodians</div>
      <div class="kpi-val">${t.n_issuers || 0} Issuers</div>
      <div class="kpi-sub">
        <span>Across ${t.positions || 0} active token wrappers</span>
      </div>
    </div>
  `;
}

/* ---------- Flags ---------- */
function renderFlags(flags) {
  const el = $("#flags");
  if (!flags || !flags.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="flags">
      ${flags.map((f) => `
        <div class="flag ${esc(f.level)}">
          <div class="flag-icon">${f.level === "high" ? "⚠️" : "ℹ️"}</div>
          <div class="flag-body">
            <div class="t">${esc(f.title)}</div>
            <div class="d">${esc(f.detail)}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

/* ---------- Filter Counts ---------- */
function updateFilterCounts(rows) {
  $("#countAll").textContent = rows.length;
  $("#countRwa").textContent = rows.filter((r) => r.kind === "rwa").length;
  $("#countCrypto").textContent = rows.filter((r) => r.kind === "crypto").length;
  $("#countRisk").textContent = rows.filter((r) => r.issuer_id === "backed" || (r.share || 0) > 0.25).length;
}

/* ---------- Positions Table ---------- */
function renderPositions(rows, totals) {
  const tb = $("#positions tbody");
  let filtered = rows;
  if (activeFilter === "rwa") filtered = rows.filter((r) => r.kind === "rwa");
  else if (activeFilter === "crypto") filtered = rows.filter((r) => r.kind === "crypto");
  else if (activeFilter === "risk") filtered = rows.filter((r) => r.issuer_id === "backed" || (r.share || 0) > 0.25);

  tb.innerHTML = filtered
    .map((r) => {
      const cls = r.pnl == null ? "" : r.pnl >= 0 ? "up" : "down";
      const unpriced = r.value == null;
      const isRwa = r.kind === "rwa";
      const avatarType = getAvatarType(r);
      const monogram = getMonogram(r.symbol);
      const isFrozen = isStressSimulated && (r.issuer_name || "").toLowerCase().includes("backed");

      let underCol = `<span class="muted">—</span>`;
      if (isRwa && r.asset_name) {
        const cikPart = r.company?.cik
          ? `<a class="cik-badge" href="${esc(r.edgar_url || 'https://www.sec.gov/edgar/browse/?CIK=' + r.company.cik)}" target="_blank" rel="noopener" title="View official SEC EDGAR 10-K filings">SEC CIK ${esc(r.company.cik)} ↗</a>`
          : `<span class="pill">${esc(r.asset_type || "RWA")}</span>`;
        underCol = `<div><b>${esc(r.asset_name)}</b><div style="margin-top:3px">${cikPart}</div></div>`;
      } else if (!isRwa) {
        underCol = `<span class="pill">Native L1/L2</span>`;
      }

      let spreadCol = `<span class="muted">—</span>`;
      if (r.spread_bps != null) {
        const isDisc = r.spread_bps < 0;
        spreadCol = `<span class="pill spread ${isDisc ? "discount" : "premium"}">${r.spread_bps >= 0 ? "+" : ""}${r.spread_bps} bps</span>`;
      }

      let issuerCol = `<span class="muted">Decentralised</span>`;
      if (r.issuer_name) {
        issuerCol = `<span class="pill issuer">🛡️ ${esc(r.issuer_name)}</span>`;
        if (isFrozen) {
          issuerCol += `<div style="margin-top:4px"><span class="risk-pill critical" style="font-size:9.5px">FROZEN COLLATERAL</span></div>`;
        }
      }

      return `<tr class="${isFrozen ? "stress-highlight" : ""}">
        <td>
          <div class="token-cell">
            <div class="token-avatar ${avatarType}">${monogram}</div>
            <div class="token-meta">
              <span class="token-sym">${esc(r.symbol)}</span>
              <span class="token-name">${esc(r.name)}</span>
            </div>
          </div>
        </td>
        <td class="r num">${num(r.quantity)}</td>
        <td class="r num">${usd(r.cost_basis)}</td>
        <td class="r num ${unpriced ? "down" : ""}">${unpriced ? "no market" : usd(r.price)}</td>
        <td class="r num" style="font-weight:600">${usd(r.value)}</td>
        <td class="r num ${cls}">${r.pnl == null ? "—" : (r.pnl >= 0 ? "+" : "") + usd(r.pnl) + ` <span class="muted">(${pct(r.pnl_pct)})</span>`}</td>
        <td>${issuerCol}</td>
        <td>${underCol}</td>
        <td>${spreadCol}</td>
        <td><span class="tag-chain">${esc(r.chain || "Native")}</span></td>
        <td class="c"><button class="del" data-id="${r.id}" title="Remove position">×</button></td>
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

/* ---------- The 3-Dimensional Roll-Up ---------- */
function renderGroups(el, groups, subs, showIssuers) {
  if (!groups || !groups.length) { el.innerHTML = `<p class="muted small">Nothing priced yet.</p>`; return; }
  el.innerHTML = groups
    .map((g) => {
      let metaHtml = "";
      if (showIssuers) {
        const issuerDesc = g.issuers && g.issuers.length
          ? `${g.n_wrappers} wrapper${g.n_wrappers > 1 ? "s" : ""} · Custodians: ${esc(g.issuers.join(", "))}`
          : `${g.n_wrappers} wrapper · Native crypto, no balance-sheet counterparty`;

        let badges = [];
        if (g.cik) {
          badges.push(`<a class="cik-badge" href="${esc(g.edgar_url || 'https://www.sec.gov/edgar/browse/?CIK=' + g.cik)}" target="_blank" rel="noopener">SEC CIK ${esc(g.cik)} ↗</a>`);
        }
        if (g.industry) {
          badges.push(`<span class="industry-badge">${esc(g.industry)}</span>`);
        }
        if (g.website) {
          const prettyWeb = esc(g.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
          badges.push(`<a class="web-link" href="${esc(g.website)}" target="_blank" rel="noopener">${prettyWeb} ↗</a>`);
        }

        metaHtml = `
          <div class="roll-subtext">${esc(issuerDesc)}</div>
          ${badges.length ? `<div class="roll-badges">${badges.join("")}</div>` : ""}
        `;
      } else {
        metaHtml = `<div class="roll-subtext">${g.n_positions} position${g.n_positions > 1 ? "s" : ""} in book</div>`;
      }

      return `
        <div class="roll-item">
          <div class="roll-head">
            <span class="roll-title" title="${esc(g.name)}">${esc(g.name)}</span>
            <span class="roll-pct">${pct(g.share)}</span>
          </div>
          <div class="roll-track">
            <div class="roll-fill" style="width:${Math.max((g.share * 100), g.share > 0 ? 2 : 0).toFixed(1)}%"></div>
          </div>
          <div class="roll-meta-block">
            ${metaHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

/* ---------- Wrapper Comparison Matrix ---------- */
function renderComparison(groups) {
  const el = $("#compare");
  if (!groups.length) {
    el.innerHTML = `<p class="muted small">Hold the same company through multiple wrappers and this ranks exit liquidity &amp; basis spreads.</p>`;
    return;
  }
  el.innerHTML = groups
    .map(
      (g) => `
      <div class="cmp-card">
        <div class="cmp-header">
          <div class="cmp-asset-name">${esc(g.name)}</div>
          <div class="cmp-subtitle">${g.wrappers.length} wrappers across issuers</div>
        </div>
        <div class="cmp-rows">
          ${g.wrappers
            .map(
              (w, i) => `
              <div class="cmp-row ${i === 0 ? "best" : ""}">
                ${i === 0 ? `<span class="best-tag">👑 Deepest Liquidity</span>` : ""}
                <b>${esc(w.symbol)}</b>
                <span class="pill issuer">${esc(w.issuer_name || "—")}</span>
                <span class="tag-chain">${esc(w.chain || "—")}</span>
                ${w.spread_bps != null ? `<span class="spread-tag">${w.spread_bps >= 0 ? "+" : ""}${w.spread_bps} bps basis</span>` : ""}
                ${w.liquidity_ratio != null ? `<span class="liq-tag">${w.liquidity_ratio}x thinner</span>` : ""}
                <span class="cmp-price">${w.priced ? usd(w.price) : "no market"}</span>
                <span class="cmp-vol">${w.volume_24h ? usd(w.volume_24h, 0) + " 24h vol" : ""}</span>
              </div>
            `
            )
            .join("")}
        </div>
      </div>
    `
    )
    .join("");
}

/* ---------- Donut Charts ---------- */
const COLORS = ["#00f2fe", "#4facfe", "#c084fc", "#f59e0b", "#f43f5e", "#10b981", "#38bdf8", "#ec4899", "#8b5cf6", "#84cc16"];
function donut(svg, legend, centerEl, groups, labelKey) {
  svg.innerHTML = "";
  legend.innerHTML = "";
  if (!groups || !groups.length) {
    legend.innerHTML = `<span class="muted small">Nothing priced yet.</span>`;
    return;
  }
  const cx = 100, cy = 100, R = 84, r = 54;
  let angle = -Math.PI / 2, out = "";
  groups.slice(0, 8).forEach((g, i) => {
    const frac = g.share;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
    const col = COLORS[i % COLORS.length];
    out += `<path d="M${x0} ${y0} A${R} ${R} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${big} 0 ${x3} ${y3} Z"
      fill="${col}" stroke="#07090e" stroke-width="2.5"><title>${esc(g.name)} — ${pct(frac)}</title></path>`;
    legend.innerHTML += `<div><i style="background:${col}"></i><span>${esc(g.name)} <span class="muted">(${pct(frac)})</span></span></div>`;
  });
  svg.innerHTML = out;
}

/* ---------- Data Refresh ---------- */
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
    if (!res.ok && !book.positions) throw new Error(book.error || "Pricing evaluation failed");
    lastRaw = book;
    if (isDemo && demoPositions.length === 0) demoPositions = book.positions || [];
    render(book);
  } catch (e) {
    $("#flags").innerHTML = `<div class="flag high"><div class="flag-icon">⚠️</div><div class="flag-body"><div class="t">Could not price portfolio</div><div class="d">${esc(e.message)}</div></div></div>`;
  }
}

/* ---------- Search & Add Position ---------- */
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
        (t, i) => `
        <div class="res" data-i="${i}">
          <span class="k">${esc(t.kind)}</span>
          <b>${esc(t.symbol)}</b>
          <span class="muted small">${esc(t.name)}</span>
          ${t.issuer_name ? `<span class="pill issuer">${esc(t.issuer_name)}</span>` : ""}
        </div>
      `
      )
      .join("") || `<p class="muted small" style="margin:8px">No match found.</p>`;

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
    results.innerHTML = `<p class="muted small" style="margin:8px">Search query error: ${esc(e.message)}</p>`;
  }
});

function qtyAndCost(t) {
  const holder = $("#addPanel");
  holder.innerHTML = `
    <div class="add-panel" id="ap">
      <div class="add-token">
        <b>Add ${esc(t.symbol)}</b>
        <span class="muted small">${esc(t.name || "")}</span>
        ${t.issuer_name ? `<span class="pill issuer">${esc(t.issuer_name)}</span>` : ""}
      </div>
      <label>Quantity<input id="apQty" type="number" min="0" step="any" value="1"></label>
      <label>Avg USD paid<input id="apCost" type="number" min="0" step="any" placeholder="optional"></label>
      <button id="apSave" class="primary">Add position</button>
      <button id="apCancel" class="ghost">Cancel</button>
    </div>
  `;
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

/* ---------- Demo Book ---------- */
$("#demoBtn").addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  positions = [];
  demoPositions = [];
  history.replaceState(null, "", location.pathname);
  toast("Loaded demo institutional multi-wrapper book");
  refresh();
  document.getElementById("holdings").scrollIntoView({ behavior: "smooth" });
});

/* ---------- Stress Test Simulation Toggle ---------- */
$("#stressToggleBtn").addEventListener("click", () => {
  isStressSimulated = !isStressSimulated;
  const btn = $("#stressToggleBtn");
  btn.classList.toggle("active", isStressSimulated);
  btn.textContent = isStressSimulated ? "🔄 Reset Stress Test" : "⚡ Simulate Issuer Freeze";
  if (lastRaw) {
    render(lastRaw);
  }
  toast(isStressSimulated ? "Simulated Backed Finance redemption halt: collateral frozen." : "Stress test reset to normal market conditions.");
});

/* ---------- Segmented Table Filter Tabs ---------- */
$$(".filter-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".filter-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    if (lastRaw) {
      renderPositions(lastRaw.positions || [], lastRaw.totals);
    }
  });
});

/* ---------- CSV Import ---------- */
$("#importBtn").addEventListener("click", () => {
  const holder = $("#addPanel");
  holder.innerHTML = `
    <div class="add-panel" id="imp">
      <div class="add-token">
        <b>Paste Holdings (CSV)</b>
        <span class="muted small">Format: SYMBOL,QUANTITY,AVG_COST — one per line.</span>
      </div>
      <textarea id="impText" rows="6" spellcheck="false">NVDAX,90,178.40
NVDAon,40,181.10
NVDA.D,30,175.00
COINX,45,210.00
BTC,0.18,64100.00</textarea>
      <button id="impGo" class="primary">Price these</button>
      <button id="impCancel" class="ghost">Cancel</button>
      <div id="impNote" class="small muted" style="flex:1 1 100%"></div>
    </div>
  `;
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
    btn.textContent = "Resolving via CMC…";
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
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
        (bad.length ? `<span class="down">Could not resolve ${bad.length}: ${esc(bad.map(b => b.symbol).join(", "))}.</span>` : "");
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
    toast("No positions in book to export.");
    return;
  }
  const headers = ["Symbol", "Name", "Type", "Quantity", "Price_USD", "Value_USD", "Cost_Basis_USD", "PnL_USD", "Issuer_Counterparty", "Underlying_Asset", "SEC_CIK", "Basis_Spread_BPS", "Chain"];
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
    r.spread_bps ?? "",
    `"${r.chain || ""}"`,
  ]);
  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const uri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", uri);
  link.setAttribute("download", `underlying_rwa_institutional_audit_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast("Institutional CSV Audit Report exported.");
});

/* ---------- Share Link ---------- */
$("#shareBtn").addEventListener("click", () => {
  syncHash();
  navigator.clipboard.writeText(location.href).then(() => {
    toast("Shareable portfolio link copied to clipboard!");
  }).catch(() => {
    toast("Link: " + location.href);
  });
});

/* ---------- EVM Wallet Scanner ---------- */
$("#scanBtn").addEventListener("click", () => {
  const holder = $("#addPanel");
  holder.innerHTML = `
    <div class="add-panel" id="wScan">
      <div class="add-token">
        <b>Scan On-Chain EVM Wallet or Load Curated Preset</b>
        <span class="muted small">Reads tokenised RWA balances on Ethereum &amp; Arbitrum. Zero wallet connection required (Privacy-First).</span>
      </div>
      <div class="preset-group">
        <button class="preset-btn" data-preset="treasury">🏛️ Institutional Treasury (T-Bills &amp; Gold)</button>
        <button class="preset-btn" data-preset="whale">📈 Tech Equity Multi-Wrapper</button>
      </div>
      <label style="flex:1 1 100%">
        Or enter an Ethereum / Arbitrum Address:
        <input id="wAddr" type="text" placeholder="0x..." style="width:100%">
      </label>
      <button id="wGo" class="primary">Scan On-Chain</button>
      <button id="wCancel" class="ghost">Cancel</button>
      <div id="wNote" class="small muted" style="flex:1 1 100%"></div>
    </div>
  `;
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
    btn.textContent = "Querying RPC…";
    try {
      const res = await fetch("/api/scan-wallet?address=" + encodeURIComponent(addr));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      if (data.positions && data.positions.length > 0) {
        positions = data.positions;
        save();
        toast(`Detected ${data.detected} RWA positions on-chain!`);
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

/* ---------- Live CMC Developer Terminal ---------- */
async function loadCapabilitiesAndExplorer() {
  // 1. Live Capabilities Probe
  try {
    const res = await fetch("/api/capabilities");
    const data = await res.json();
    const eps = data.endpoints || {};
    $("#endpointList").innerHTML = Object.entries(eps)
      .map(
        ([name, r]) => `
          <li>
            <span class="${r.ok ? "ok" : "no"}">${r.ok ? "●" : "○"}</span>
            <span>${esc(name)}</span>
          </li>
        `
      )
      .join("");
  } catch (e) {
    $("#endpointList").innerHTML = `<li class="no">● Offline verified mode</li>`;
  }

  // 2. Interactive Endpoint Explorer
  try {
    const res = await fetch("/api/evidence/sample");
    const data = await res.json();
    apiEndpointsData = data.endpoints || [];
    const tabsContainer = $("#apiTabs");
    tabsContainer.innerHTML = apiEndpointsData
      .map((ep, i) => `<button class="api-tab ${i === 0 ? "active" : ""}" data-idx="${i}">${esc(ep.name)}</button>`)
      .join("");

    let currentSelectedEp = null;

    const showEndpoint = (idx) => {
      const ep = apiEndpointsData[idx];
      if (!ep) return;
      currentSelectedEp = ep;
      tabsContainer.querySelectorAll(".api-tab").forEach((b, i) => b.classList.toggle("active", i === idx));
      $("#apiEndpointPurpose").textContent = ep.purpose;
      $("#apiEndpointPath").textContent = ep.path;
      $("#apiEndpointPayload").textContent = JSON.stringify(ep.sample, null, 2);
    };

    tabsContainer.querySelectorAll(".api-tab").forEach((b) => {
      b.addEventListener("click", () => showEndpoint(+b.dataset.idx));
    });

    if (apiEndpointsData.length > 0) showEndpoint(0);

    // Copy cURL command button
    $("#copyCurlBtn").addEventListener("click", () => {
      if (!currentSelectedEp) return;
      const curlCmd = `curl -X GET "https://pro-api.coinmarketcap.com${currentSelectedEp.path}" -H "X-CMC_PRO_API_KEY: \${CMC_API_KEY}" -H "Accept: application/json"`;
      navigator.clipboard.writeText(curlCmd).then(() => {
        toast("cURL command copied to clipboard!");
      }).catch(() => {
        toast(curlCmd);
      });
    });
  } catch (e) {}
}

/* ---------- Modals (Methodology & CMC Feedback) ---------- */
function openModal(id) {
  const m = $("#" + id);
  if (m) m.classList.remove("hidden");
}
function closeModal(id) {
  const m = $("#" + id);
  if (m) m.classList.add("hidden");
}
function closeAllModals() {
  $$(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
}

$("#navMethodologyBtn")?.addEventListener("click", () => openModal("methodologyModal"));
$("#openMathBtn")?.addEventListener("click", () => openModal("methodologyModal"));
$("#navFeedbackBtn")?.addEventListener("click", () => openModal("feedbackModal"));
$("#openFeedbackBtn")?.addEventListener("click", () => openModal("feedbackModal"));
$("#viewFeedbackInTerminalBtn")?.addEventListener("click", () => openModal("feedbackModal"));

$$(".modal-close-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.close;
    if (id) closeModal(id);
    else closeAllModals();
  });
});

$$(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeAllModals();
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllModals();
});

/* ---------- Tweet Submission with #BuildwithCMC ---------- */
$("#tweetBtn")?.addEventListener("click", () => {
  const text = encodeURIComponent("Auditing tokenised RWAs past the ticker down to the SEC CIK and legal collateral custodian. Check out Underlying built for the @CoinMarketCap API Hackathon on @DoraHacks! #BuildwithCMC");
  const url = encodeURIComponent("https://github.com/sissokocheick/underlying");
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "noopener,noreferrer");
});

/* ---------- Print Audit Report ---------- */
$("#printAuditBtn")?.addEventListener("click", () => {
  window.print();
});

refresh();
loadCapabilitiesAndExplorer();
