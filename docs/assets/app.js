let DATA = null;

const state = {
  overviewProvince: "ALL",
  overviewTopN: 20,
  areaProvince: "ALL",
  areaCode: null,
  alignProvince: "ALL",
  alignPercentile: null,
  alignBasePartyCodes: new Set(),
  overviewProvinceSort: { key: "totalVotes", dir: "desc" },
  overviewProvinceSearch: "",
};

function fmtNum(n) {
  return Number(n || 0).toLocaleString("th-TH");
}

function byText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "th");
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

function setMeta() {
  fetch("data/metadata.json")
    .then((r) => r.json())
    .then((m) => {
      document.getElementById("meta-hash").textContent = (m.dataSha256 || "-").slice(0, 12);
      document.getElementById("meta-time").textContent = m.generatedAt || "-";
      document.getElementById("meta-areas").textContent = fmtNum(m?.input?.areaFileCount || 0);
    })
    .catch(() => {
      document.getElementById("meta-hash").textContent = "ไม่มีข้อมูล";
      document.getElementById("meta-time").textContent = "ไม่มีข้อมูล";
      document.getElementById("meta-areas").textContent = "ไม่มีข้อมูล";
    });
}

function setupOverviewControls() {
  const provinces = ["ALL", ...DATA.dimensions.provinces.map((x) => x.provinceName).filter(Boolean).sort(byText)];
  const sel = document.getElementById("overview-province-filter");
  sel.innerHTML = provinces.map((p) => `<option value="${p}">${p === "ALL" ? "ทุกจังหวัด" : p}</option>`).join("");
  sel.value = state.overviewProvince;
  sel.addEventListener("change", (e) => {
    state.overviewProvince = e.target.value;
    renderOverview();
  });

  const topn = document.getElementById("overview-topn");
  topn.value = DATA.config_used?.top_n_default || 20;
  state.overviewTopN = Number(topn.value);
  topn.addEventListener("change", (e) => {
    state.overviewTopN = Number(e.target.value || 20);
    renderOverview();
  });

  const search = document.getElementById("overview-province-search");
  search.addEventListener("input", (e) => {
    state.overviewProvinceSearch = (e.target.value || "").trim().toLowerCase();
    renderOverviewProvinceTable();
  });
}

function setupAreaControls() {
  const provinces = ["ALL", ...DATA.dimensions.provinces.map((x) => x.provinceName).filter(Boolean).sort(byText)];
  const pSel = document.getElementById("area-province-filter");
  pSel.innerHTML = provinces.map((p) => `<option value="${p}">${p === "ALL" ? "ทุกจังหวัด" : p}</option>`).join("");
  pSel.value = state.areaProvince;
  pSel.addEventListener("change", (e) => {
    state.areaProvince = e.target.value;
    populateAreaOptions();
    renderArea();
  });

  const aSel = document.getElementById("area-area-filter");
  aSel.addEventListener("change", (e) => {
    state.areaCode = e.target.value;
    renderArea();
  });

  populateAreaOptions();
}

function populateAreaOptions() {
  const aSel = document.getElementById("area-area-filter");
  let areas = DATA.areas;
  if (state.areaProvince !== "ALL") {
    areas = areas.filter((x) => x.provinceName === state.areaProvince);
  }
  areas = [...areas].sort((a, b) => byText(a.areaName, b.areaName));
  aSel.innerHTML = areas
    .map((a) => `<option value="${a.areaCode}">${a.provinceName} | ${a.areaName} (${a.areaCode})</option>`)
    .join("");
  if (!state.areaCode || !areas.find((x) => x.areaCode === state.areaCode)) {
    state.areaCode = areas.length ? areas[0].areaCode : null;
  }
  aSel.value = state.areaCode;
}

function setupAlignmentControls() {
  const provinces = ["ALL", ...DATA.dimensions.provinces.map((x) => x.provinceName).filter(Boolean).sort(byText)];
  const pSel = document.getElementById("align-province-filter");
  pSel.innerHTML = provinces.map((p) => `<option value="${p}">${p === "ALL" ? "ทุกจังหวัด" : p}</option>`).join("");
  pSel.value = state.alignProvince;
  pSel.addEventListener("change", (e) => {
    state.alignProvince = e.target.value;
    renderAlignment();
  });

  const percentiles = Object.keys(DATA.alignment.outliers).sort((a, b) => Number(b) - Number(a));
  state.alignPercentile = percentiles[0];
  const qSel = document.getElementById("align-percentile-filter");
  qSel.innerHTML = percentiles.map((q) => `<option value="${q}">${q}</option>`).join("");
  qSel.value = state.alignPercentile;
  qSel.addEventListener("change", (e) => {
    state.alignPercentile = e.target.value;
    renderAlignment();
  });

  const baseSel = document.getElementById("align-base-party-filter");
  const baseNumbers = new Set(DATA.config_used.base_party_numbers || []);
  const baseOptions = DATA.dimensions.parties
    .filter((p) => p.partyCode && baseNumbers.has(p.partyNo))
    .sort((a, b) => (a.partyNo || 999) - (b.partyNo || 999));

  baseSel.innerHTML = baseOptions
    .map((p) => `<option value="${p.partyCode}" selected>#${p.partyNo} ${p.partyName}</option>`)
    .join("");

  state.alignBasePartyCodes = new Set(baseOptions.map((p) => p.partyCode));

  baseSel.addEventListener("change", () => {
    state.alignBasePartyCodes = new Set(Array.from(baseSel.selectedOptions).map((o) => o.value));
    renderAlignment();
  });
}

function renderKpis(containerId, kpis) {
  const root = document.getElementById(containerId);
  root.innerHTML = kpis
    .map((k) => `<div class="kpi"><div class="k">${k.label}</div><div class="v">${k.value}</div></div>`)
    .join("");
}

function renderSimpleTable(tableId, columns, rows) {
  const table = document.getElementById(tableId);
  const head = `<thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((r) => `<tr>${columns.map((c) => `<td>${c.format ? c.format(r[c.key], r) : r[c.key] ?? ""}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  table.innerHTML = head + body;
}

function renderSortableProvinceTable(rows) {
  const columns = [
    { key: "provinceName", label: "จังหวัด" },
    { key: "areaCount", label: "จำนวนเขต" },
    { key: "totalVotes", label: "คะแนนรวม (บัญชีรายชื่อ)" },
    { key: "goodVotes", label: "บัตรดี (บัญชีรายชื่อ)" },
    { key: "badVotes", label: "บัตรเสีย (บัญชีรายชื่อ)" },
    { key: "noVotes", label: "ไม่ประสงค์ลงคะแนน (บัญชีรายชื่อ)" },
  ];

  const table = document.getElementById("overview-province-table");

  let filtered = rows;
  if (state.overviewProvinceSearch) {
    filtered = filtered.filter((r) => String(r.provinceName || "").toLowerCase().includes(state.overviewProvinceSearch));
  }

  filtered = [...filtered].sort((a, b) => {
    const key = state.overviewProvinceSort.key;
    const dir = state.overviewProvinceSort.dir === "asc" ? 1 : -1;
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return byText(av, bv) * dir;
  });

  table.innerHTML =
    `<thead><tr>${columns
      .map((c) => `<th data-key="${c.key}">${c.label}${state.overviewProvinceSort.key === c.key ? (state.overviewProvinceSort.dir === "asc" ? " ▲" : " ▼") : ""}</th>`)
      .join("")}</tr></thead>` +
    `<tbody>${filtered
      .map(
        (r) =>
          `<tr><td>${r.provinceName || ""}</td><td>${fmtNum(r.areaCount)}</td><td>${fmtNum(r.totalVotes)}</td><td>${fmtNum(r.goodVotes)}</td><td>${fmtNum(r.badVotes)}</td><td>${fmtNum(r.noVotes)}</td></tr>`
      )
      .join("")}</tbody>`;

  table.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.overviewProvinceSort.key === key) {
        state.overviewProvinceSort.dir = state.overviewProvinceSort.dir === "asc" ? "desc" : "asc";
      } else {
        state.overviewProvinceSort.key = key;
        state.overviewProvinceSort.dir = "desc";
      }
      renderOverviewProvinceTable();
    });
  });
}

function getOverviewScope() {
  let areas = DATA.areas;
  if (state.overviewProvince !== "ALL") {
    areas = areas.filter((a) => a.provinceName === state.overviewProvince);
  }
  return areas;
}

function renderOverviewProvinceTable() {
  let rows = DATA.overview.province_totals;
  if (state.overviewProvince !== "ALL") {
    rows = rows.filter((r) => r.provinceName === state.overviewProvince);
  }
  renderSortableProvinceTable(rows);
}

function renderOverview() {
  const areas = getOverviewScope();

  const totals = areas.reduce(
    (acc, a) => {
      acc.totalVotes += a.totals.totalVotes || 0;
      acc.goodVotes += a.totals.goodVotes || 0;
      acc.badVotes += a.totals.badVotes || 0;
      acc.noVotes += a.totals.noVotes || 0;
      return acc;
    },
    { totalVotes: 0, goodVotes: 0, badVotes: 0, noVotes: 0 }
  );

  renderKpis("overview-kpis", [
    { label: "จำนวนเขต", value: fmtNum(areas.length) },
    { label: "คะแนนรวม (บัญชีรายชื่อ)", value: fmtNum(totals.totalVotes) },
    { label: "บัตรดี (บัญชีรายชื่อ)", value: fmtNum(totals.goodVotes) },
    { label: "บัตรเสีย (บัญชีรายชื่อ)", value: fmtNum(totals.badVotes) },
    { label: "ไม่ประสงค์ลงคะแนน (บัญชีรายชื่อ)", value: fmtNum(totals.noVotes) },
  ]);

  const partyMap = new Map();
  areas.forEach((a) => {
    a.partyResults.forEach((p) => {
      if (!partyMap.has(p.partyCode)) {
        partyMap.set(p.partyCode, {
          partyCode: p.partyCode,
          partyNo: p.partyNo,
          partyName: p.partyName,
          voteTotal: 0,
        });
      }
      partyMap.get(p.partyCode).voteTotal += p.voteTotal || 0;
    });
  });

  const topParties = Array.from(partyMap.values())
    .sort((a, b) => b.voteTotal - a.voteTotal)
    .slice(0, state.overviewTopN);

  Plotly.newPlot(
    "overview-party-chart",
    [
      {
        type: "bar",
        x: topParties.map((x) => `${x.partyNo ?? "?"} ${x.partyName || "ไม่ทราบ"}`),
        y: topParties.map((x) => x.voteTotal),
        marker: { color: "#0a9396" },
      },
    ],
    {
      title: `พรรคคะแนนสูงสุด ${state.overviewTopN} อันดับแรก (บัญชีรายชื่อ)`,
      margin: { t: 48, r: 18, b: 120, l: 60 },
    },
    { responsive: true }
  );

  renderOverviewProvinceTable();
}

function renderArea() {
  const area = DATA.areas.find((a) => a.areaCode === state.areaCode);
  if (!area) {
    return;
  }

  const partyRows = [...area.partyResults].sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
  Plotly.newPlot(
    "area-party-chart",
    [
      {
        type: "bar",
        x: partyRows.slice(0, 20).map((x) => `${x.partyNo ?? "?"} ${x.partyName || "ไม่ทราบ"}`),
        y: partyRows.slice(0, 20).map((x) => x.voteTotal),
        marker: { color: "#ee9b00" },
      },
    ],
    {
      title: `${area.provinceName} | ${area.areaName} (${area.areaCode}) - 20 พรรคคะแนนสูงสุด (บัญชีรายชื่อ)`,
      margin: { t: 56, r: 18, b: 120, l: 60 },
    },
    { responsive: true }
  );

  renderSimpleTable(
    "area-party-table",
    [
      { key: "rank", label: "อันดับ" },
      { key: "partyNo", label: "หมายเลขพรรค" },
      { key: "partyName", label: "พรรค" },
      { key: "voteTotal", label: "คะแนน (บัญชีรายชื่อ)", format: (v) => fmtNum(v) },
      { key: "votePercent", label: "ร้อยละคะแนน (บัญชีรายชื่อ)" },
    ],
    partyRows
  );

  renderSimpleTable(
    "area-candidate-table",
    [
      { key: "candidateNo", label: "หมายเลขผู้สมัคร สส. แบบแบ่งเขต" },
      { key: "candidateName", label: "ผู้สมัคร สส. แบบแบ่งเขต" },
      { key: "candidatePartyNo", label: "หมายเลขพรรค" },
      { key: "candidatePartyName", label: "พรรค" },
    ],
    area.candidates
  );
}

function renderAlignment() {
  let rows = DATA.alignment.rows;
  if (state.alignProvince !== "ALL") {
    rows = rows.filter((r) => r.provinceName === state.alignProvince);
  }

  if (state.alignBasePartyCodes.size > 0) {
    rows = rows.filter((r) => r.matched && state.alignBasePartyCodes.has(r.candidatePartyCode));
  }

  const matchedRows = rows.filter((r) => r.matched);
  const proxyVotes = rows.reduce((acc, r) => acc + (r.smallPartyVotes || 0), 0);

  renderKpis("alignment-kpis", [
    { label: "จำนวนแถววิเคราะห์", value: fmtNum(rows.length) },
    { label: "จำนวนแถวที่จับคู่ได้", value: fmtNum(matchedRows.length) },
    { label: "อัตราการจับคู่", value: `${((matchedRows.length / Math.max(rows.length, 1)) * 100).toFixed(2)}%` },
    { label: "คะแนนพร็อกซี (บัญชีรายชื่อ)", value: fmtNum(proxyVotes) },
  ]);

  const partyMap = new Map();
  matchedRows.forEach((r) => {
    if (!partyMap.has(r.candidatePartyCode)) {
      partyMap.set(r.candidatePartyCode, {
        candidatePartyCode: r.candidatePartyCode,
        candidatePartyNo: r.candidatePartyNo,
        candidatePartyName: r.candidatePartyName,
        totalProxyVotes: 0,
      });
    }
    partyMap.get(r.candidatePartyCode).totalProxyVotes += r.smallPartyVotes || 0;
  });

  const partyRows = Array.from(partyMap.values()).sort((a, b) => b.totalProxyVotes - a.totalProxyVotes).slice(0, 20);

  Plotly.newPlot(
    "alignment-party-chart",
    [
      {
        type: "bar",
        x: partyRows.map((x) => `${x.candidatePartyNo ?? "?"} ${x.candidatePartyName || "ไม่ทราบ"}`),
        y: partyRows.map((x) => x.totalProxyVotes),
        marker: { color: "#bb3e03" },
      },
    ],
    {
      title: "คะแนนพร็อกซี (บัญชีรายชื่อ) แยกตามพรรคของผู้สมัคร สส. แบบแบ่งเขตที่ชนเลข",
      margin: { t: 48, r: 18, b: 120, l: 60 },
    },
    { responsive: true }
  );

  const percentile = state.alignPercentile;
  const outlierSource = DATA.alignment.outliers[percentile]?.rows || [];
  let outliers = outlierSource;
  if (state.alignProvince !== "ALL") {
    outliers = outliers.filter((r) => r.provinceName === state.alignProvince);
  }
  if (state.alignBasePartyCodes.size > 0) {
    outliers = outliers.filter((r) => r.matched && state.alignBasePartyCodes.has(r.candidatePartyCode));
  }

  renderSimpleTable(
    "alignment-outlier-table",
    [
      { key: "provinceName", label: "จังหวัด" },
      { key: "areaName", label: "เขต" },
      { key: "smallPartyNo", label: "หมายเลขพรรคพร็อกซี (บัญชีรายชื่อ)" },
      { key: "smallPartyName", label: "พรรคพร็อกซี (บัญชีรายชื่อ)" },
      { key: "smallPartyVotes", label: "คะแนนพร็อกซี (บัญชีรายชื่อ)", format: (v) => fmtNum(v) },
      { key: "candidateNo", label: "หมายเลขผู้สมัคร สส. แบบแบ่งเขตที่ชนเลข" },
      { key: "candidatePartyName", label: "พรรคของผู้สมัคร สส. แบบแบ่งเขตที่ชนเลข" },
      { key: "candidateName", label: "ชื่อผู้สมัคร สส. แบบแบ่งเขตที่ชนเลข" },
    ],
    outliers.slice(0, 300)
  );

  const summaryRows = DATA.alignment.summary_by_base_party.filter(
    (r) => state.alignBasePartyCodes.size === 0 || state.alignBasePartyCodes.has(r.candidatePartyCode)
  );
  renderSimpleTable(
    "alignment-summary-table",
    [
      { key: "candidatePartyNo", label: "หมายเลขพรรค" },
      { key: "candidatePartyName", label: "พรรคของผู้สมัคร สส. แบบแบ่งเขตที่ชนเลข" },
      { key: "rows", label: "จำนวนแถววิเคราะห์", format: (v) => fmtNum(v) },
      { key: "areaCount", label: "จำนวนเขต", format: (v) => fmtNum(v) },
      { key: "totalProxyVotes", label: "คะแนนพร็อกซีรวม (บัญชีรายชื่อ)", format: (v) => fmtNum(v) },
    ],
    summaryRows
  );
}

async function init() {
  initTabs();
  setMeta();

  const resp = await fetch("data/dashboard-data.json");
  DATA = await resp.json();

  setupOverviewControls();
  setupAreaControls();
  setupAlignmentControls();

  renderOverview();
  renderArea();
  renderAlignment();
}

init().catch((err) => {
  console.error(err);
  alert("โหลดข้อมูลแดชบอร์ดไม่สำเร็จ กรุณาตรวจสอบไฟล์ docs/data/dashboard-data.json");
});
