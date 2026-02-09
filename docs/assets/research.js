const state = {
  data: null,
  metadata: null,
  topN: 10,
  rangeMin: 1,
  rangeMax: 10,
  excludeTop: 6,
  originProvince: "ALL",
  originSmallPartyCode: "ALL",
  hotspotTopN: 30,
  sorts: {},
};

const EVIDENCE_MAJOR_PARTY_NOS = new Set([9, 27, 37, 42, 46]);
const MAJOR_PARTY_COLORS = {
  9: "#d62828", // เพื่อไทย - แดง
  27: "#4cc9f0", // ประชาธิปัตย์ - ฟ้า
  37: "#1d4ed8", // ภูมิใจไทย - น้ำเงิน
  42: "#2f9e44", // กล้าธรรม - เขียว
  46: "#f77f00", // ประชาชน - ส้ม
};
const ORIGIN_BASE_SMALL_RANGE_MIN = 1;
const ORIGIN_BASE_SMALL_RANGE_MAX = 10;
const ORIGIN_BASE_EXCLUDE_TOP = 6;

function fmtNum(v, digits = 0) {
  const n = Number(v || 0);
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(v, digits = 2) {
  return `${fmtNum(Number(v || 0) * 100, digits)}%`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function partyLabel(p) {
  if (p.partyNo != null && p.partyName) return `พรรคเบอร์ ${p.partyNo} ${p.partyName}`;
  if (p.partyName) return `พรรค ${p.partyName}`;
  return p.partyCode || "ไม่ทราบพรรค";
}

function getSort(sortId, defaultKey, defaultDir = "desc") {
  if (!state.sorts[sortId]) {
    state.sorts[sortId] = { key: defaultKey, dir: defaultDir };
  }
  return state.sorts[sortId];
}

function sortRows(rows, sortState) {
  const out = [...rows];
  out.sort((a, b) => {
    const av = a?.[sortState.key];
    const bv = b?.[sortState.key];
    const dir = sortState.dir === "asc" ? 1 : -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av ?? "").localeCompare(String(bv ?? ""), "th") * dir;
  });
  return out;
}

function pearsonCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.reduce((s, v) => s + Number(v || 0), 0) / n;
  const my = ys.reduce((s, v) => s + Number(v || 0), 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = Number(xs[i] || 0) - mx;
    const dy = Number(ys[i] || 0) - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 <= 0 || dy2 <= 0) return 0;
  return num / Math.sqrt(dx2 * dy2);
}

function linearTrend(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xMean = xs.reduce((s, v) => s + Number(v || 0), 0) / n;
  const yMean = ys.reduce((s, v) => s + Number(v || 0), 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = Number(xs[i] || 0) - xMean;
    const dy = Number(ys[i] || 0) - yMean;
    num += dx * dy;
    den += dx * dx;
  }
  if (Math.abs(den) < 1e-12) return null;
  const slope = num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function partyColorByNo(no, fallback = "#6b7280") {
  return MAJOR_PARTY_COLORS[Number(no || 0)] || fallback;
}

function describeDiffMagnitude(pctPoint) {
  const a = Math.abs(pctPoint);
  if (a < 1) return "ต่างกันน้อย";
  if (a < 3) return "ต่างกันพอเห็นได้";
  if (a < 7) return "ต่างกันชัดเจน";
  return "ต่างกันมาก";
}

function describePValue(p) {
  const v = Number(p || 0);
  if (v < 0.01) return "โอกาสเกิดจากความบังเอิญต่ำมาก";
  if (v < 0.05) return "โอกาสเกิดจากความบังเอิญค่อนข้างต่ำ";
  if (v < 0.1) return "เริ่มมีสัญญาณ แต่ยังไม่แน่น";
  return "ยังแยกจากความบังเอิญได้ไม่ชัด";
}

function quantileNumbers(values, q) {
  const arr = (values || []).map((v) => Number(v || 0)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  if (q <= 0) return arr[0];
  if (q >= 1) return arr[arr.length - 1];
  const pos = (arr.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return arr[low];
  const frac = pos - low;
  return arr[low] * (1 - frac) + arr[high] * frac;
}

function renderKpis(containerId, kpis) {
  const root = document.getElementById(containerId);
  root.innerHTML = kpis
    .map((k) => `<div class="kpi"><div class="k">${escapeHtml(k.label)}</div><div class="v">${escapeHtml(k.value)}</div></div>`)
    .join("");
}

function renderSortableTable({ tableId, columns, rows, sortId, defaultKey, defaultDir = "desc", onSortChange, totalRow = null }) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const sort = getSort(sortId, defaultKey, defaultDir);
  const sorted = sortRows(rows, sort);

  if (!sorted.length) {
    table.innerHTML = "<tbody><tr><td>ไม่มีข้อมูล</td></tr></tbody>";
    return;
  }

  const head = `<thead><tr>${columns
    .map((c) => {
      const arrow = sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
      return `<th data-key="${escapeHtml(c.key)}">${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("")}</tr></thead>`;

  const renderRows = totalRow ? [...sorted, totalRow] : sorted;
  const body = `<tbody>${renderRows
    .map((r) => `<tr>${columns.map((c) => `<td>${escapeHtml(c.format ? c.format(r[c.key], r) : r[c.key] ?? "")}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  table.innerHTML = head + body;

  table.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sort.key === key) sort.dir = sort.dir === "asc" ? "desc" : "asc";
      else {
        sort.key = key;
        sort.dir = "desc";
      }
      onSortChange();
    });
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`โหลดไม่สำเร็จ: ${url}`);
  return res.json();
}

function markdownToHtml(md) {
  const lines = String(md || "").split(/\r?\n/);
  const out = [];
  let listType = null;

  function closeList() {
    if (listType === "ol") out.push("</ol>");
    if (listType === "ul") out.push("</ul>");
    listType = null;
  }

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      out.push(`<h3>${escapeHtml(line.slice(2))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      out.push(`<h3>${escapeHtml(line.slice(3))}</h3>`);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${escapeHtml(ol[1])}</li>`);
      continue;
    }
    const ul = line.match(/^-\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${escapeHtml(ul[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return out.join("");
}

function setupTocActive() {
  const links = [...document.querySelectorAll("#toc a")];
  const map = new Map(links.map((a) => [a.getAttribute("href")?.slice(1), a]));
  const sections = [...document.querySelectorAll("main.article section[id]")];
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.remove("is-active"));
        map.get(entry.target.id)?.classList.add("is-active");
      });
    },
    { threshold: 0.25, rootMargin: "-20% 0px -55% 0px" }
  );
  sections.forEach((s) => io.observe(s));
}

function renderHeaderMeta() {
  document.getElementById("meta-time").textContent = state.metadata?.generatedAt || "-";
  document.getElementById("meta-areas").textContent = fmtNum(state.metadata?.input?.areaFileCount || state.data?.areas?.length || 0);
}

function renderOverview() {
  const overview = state.data.overview || {};
  const n = overview.national_totals || {};
  const cOverview = overview.constituency_national_totals || {};
  const cAreas = (state.data.areas || []).reduce(
    (acc, a) => {
      const t = a.constituencyTotals || {};
      acc.totalVotes += Number(t.totalVotes || 0);
      acc.goodVotes += Number(t.goodVotes || 0);
      acc.badVotes += Number(t.badVotes || 0);
      acc.noVotes += Number(t.noVotes || 0);
      return acc;
    },
    { totalVotes: 0, goodVotes: 0, badVotes: 0, noVotes: 0 }
  );
  const c = (Number(cOverview.totalVotes || 0) > 0 ? cOverview : cAreas);

  renderKpis("overview-kpis-constituency", [
    { label: "คะแนนรวม (แบ่งเขต)", value: fmtNum(c.totalVotes || 0) },
    { label: "บัตรดี (แบ่งเขต)", value: fmtNum(c.goodVotes || 0) },
    { label: "บัตรเสีย (แบ่งเขต)", value: fmtNum(c.badVotes || 0) },
    { label: "ไม่ประสงค์ลงคะแนน (แบ่งเขต)", value: fmtNum(c.noVotes || 0) },
  ]);

  renderKpis("overview-kpis-partylist", [
    { label: "คะแนนรวม (บัญชีรายชื่อ)", value: fmtNum(n.totalVotes || 0) },
    { label: "บัตรดี (บัญชีรายชื่อ)", value: fmtNum(n.goodVotes || 0) },
    { label: "บัตรเสีย (บัญชีรายชื่อ)", value: fmtNum(n.badVotes || 0) },
    { label: "ไม่ประสงค์ลงคะแนน (บัญชีรายชื่อ)", value: fmtNum(n.noVotes || 0) },
  ]);

  const partyListRows = [...(overview.party_totals || [])].sort((a, b) => (b.voteTotal || 0) - (a.voteTotal || 0));
  const constituencyByCode = new Map((overview.constituency_party_totals || []).map((p) => [p.partyCode, p]));
  const majorRows = partyListRows
    .filter((r) => EVIDENCE_MAJOR_PARTY_NOS.has(Number(r.partyNo || 0)))
    .map((p) => ({
      ...p,
      constituencyVoteTotal: Number((constituencyByCode.get(p.partyCode) || {}).voteTotal || 0),
    }));
  const smallRows = getOriginBaseSmallPartyRows().map((p) => ({
    ...p,
    constituencyVoteTotal: Number((constituencyByCode.get(p.partyCode) || {}).voteTotal || 0),
  }));

  Plotly.newPlot(
    "overview-major-chart",
    [
      {
        type: "bar",
        name: "คะแนนบัญชีรายชื่อ",
        x: majorRows.map((p) => partyLabel(p)),
        y: majorRows.map((p) => Number(p.voteTotal || 0)),
        marker: { color: "#ca6702" },
      },
      {
        type: "bar",
        name: "คะแนนแบ่งเขต",
        x: majorRows.map((p) => partyLabel(p)),
        y: majorRows.map((p) => Number(p.constituencyVoteTotal || 0)),
        marker: { color: "#005f73" },
      },
    ],
    {
      title: "คะแนนพรรคใหญ่: บัญชีรายชื่อ เทียบ แบ่งเขต",
      margin: { t: 50, r: 12, b: 120, l: 58 },
      barmode: "group",
    },
    { responsive: true }
  );

  Plotly.newPlot(
    "overview-small-chart",
    [
      {
        type: "bar",
        name: "คะแนนบัญชีรายชื่อ",
        x: smallRows.map((p) => partyLabel(p)),
        y: smallRows.map((p) => Number(p.voteTotal || 0)),
        marker: { color: "#ca6702" },
      },
      {
        type: "bar",
        name: "คะแนนแบ่งเขต",
        x: smallRows.map((p) => partyLabel(p)),
        y: smallRows.map((p) => Number(p.constituencyVoteTotal || 0)),
        marker: { color: "#005f73" },
      },
    ],
    {
      title: "คะแนนพรรคเล็ก: บัญชีรายชื่อ เทียบ แบ่งเขต",
      margin: { t: 50, r: 12, b: 150, l: 58 },
      barmode: "group",
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "overview-major-table",
    columns: [
      { key: "partyNo", label: "หมายเลขพรรค" },
      { key: "partyName", label: "ชื่อพรรค" },
      { key: "voteTotal", label: "คะแนนบัญชีรายชื่อ", format: (v) => fmtNum(v) },
      { key: "constituencyVoteTotal", label: "คะแนนแบ่งเขต", format: (v) => fmtNum(v) },
      { key: "share", label: "สัดส่วนบัญชีรายชื่อ", format: (v) => fmtPct(v, 2) },
    ],
    rows: majorRows,
    sortId: "overview-major",
    defaultKey: "voteTotal",
    onSortChange: renderOverview,
  });

  renderSortableTable({
    tableId: "overview-small-table",
    columns: [
      { key: "partyNo", label: "หมายเลขพรรค" },
      { key: "partyName", label: "ชื่อพรรค" },
      { key: "voteTotal", label: "คะแนนบัญชีรายชื่อ", format: (v) => fmtNum(v) },
      { key: "constituencyVoteTotal", label: "คะแนนแบ่งเขต", format: (v) => fmtNum(v) },
      { key: "share", label: "สัดส่วนบัญชีรายชื่อ", format: (v) => fmtPct(v, 2) },
    ],
    rows: smallRows,
    sortId: "overview-small",
    defaultKey: "partyNo",
    defaultDir: "asc",
    onSortChange: renderOverview,
  });

  const overviewSummary = document.getElementById("overview-summary");
  const avgPartyList = smallRows.length ? smallRows.reduce((s, r) => s + Number(r.voteTotal || 0), 0) / smallRows.length : 0;
  const avgConstituency = smallRows.length ? smallRows.reduce((s, r) => s + Number(r.constituencyVoteTotal || 0), 0) / smallRows.length : 0;
  const ratio = avgConstituency > 0 ? avgPartyList / avgConstituency : 0;
  overviewSummary.innerHTML =
    `สังเกตได้ว่าในช่วงพรรคเบอร์ 1-10 (หลังตัดพรรคอันดับต้น 6 พรรค) ` +
    `มีพรรคเข้าเกณฑ์ ${fmtNum(smallRows.length)} พรรค, คะแนนบัญชีรายชื่อเฉลี่ย ${fmtNum(avgPartyList)} เสียง, ` +
    `และคะแนนแบ่งเขตเฉลี่ย ${fmtNum(avgConstituency)} เสียง แสดงให้เห็นว่าคะแนน สส เขตไม่สอดคล้องกับคะแนนบัญชีรายชื่อในกลุ่มพรรคเล็กนี้อย่างชัดเจน ` +
    `อัตราส่วนเฉลี่ยอยู่ที่ประมาณ 1:${ratio ? ratio.toFixed(0) : "N/A"} (แบ่งเขต / บัญชีรายชื่อ)`;
}

function getH1Rows() {
  const overview = state.data.overview || {};
  const all = [...(overview.party_totals || [])].sort((a, b) => (b.voteTotal || 0) - (a.voteTotal || 0));
  const constituencyByCode = new Map(
    (overview.constituency_party_totals || []).map((p) => [p.partyCode, p])
  );
  const majorCodes = new Set(all.slice(0, state.excludeTop).map((p) => p.partyCode));

  return all
    .filter((p) => (p.partyNo || 0) >= state.rangeMin && (p.partyNo || 0) <= state.rangeMax)
    .filter((p) => !majorCodes.has(p.partyCode))
    .map((p) => {
      const c = constituencyByCode.get(p.partyCode) || {};
      return {
        ...p,
        constituencyVoteTotal: Number(c.voteTotal || 0),
      };
    })
    .sort((a, b) => (a.partyNo || 999) - (b.partyNo || 999));
}

function getOriginBaseSmallPartyRows() {
  const overview = state.data.overview || {};
  const all = [...(overview.party_totals || [])].sort((a, b) => (b.voteTotal || 0) - (a.voteTotal || 0));
  const majorCodes = new Set(all.slice(0, ORIGIN_BASE_EXCLUDE_TOP).map((p) => p.partyCode));
  return all
    .filter((p) => (p.partyNo || 0) >= ORIGIN_BASE_SMALL_RANGE_MIN && (p.partyNo || 0) <= ORIGIN_BASE_SMALL_RANGE_MAX)
    .filter((p) => !majorCodes.has(p.partyCode))
    .sort((a, b) => (a.partyNo || 999) - (b.partyNo || 999));
}

function renderHypothesis1() {
  return;
}

function getOriginEligibleSmallPartyCodes() {
  return new Set(getOriginBaseSmallPartyRows().map((p) => p.partyCode));
}

function getHotspotRows() {
  const eligibleSmallPartyCodes = getOriginEligibleSmallPartyCodes();
  const partyDimByNo = new Map((state.data?.dimensions?.parties || []).map((p) => [Number(p.partyNo || 0), p]));
  const majorParties = [...EVIDENCE_MAJOR_PARTY_NOS]
    .map((no) => {
      const p = partyDimByNo.get(no) || {};
      return { partyCode: p.partyCode, partyNo: no, partyName: p.partyName };
    })
    .filter((p) => !!p.partyCode);
  const majorCodeSet = new Set(majorParties.map((p) => p.partyCode));
  const out = [];
  for (const area of state.data?.areas || []) {
    const partyRows = (area.partyResults || []).filter((r) => eligibleSmallPartyCodes.has(r.partyCode));
    const smallVoteTotal = partyRows.reduce((s, r) => s + Number(r.voteTotal || 0), 0);
    const areaTotalVotes = Number(area?.totals?.totalVotes || 0);
    const smallVoteShare = areaTotalVotes > 0 ? smallVoteTotal / areaTotalVotes : 0;
    const topParty = [...partyRows].sort((a, b) => Number(b.voteTotal || 0) - Number(a.voteTotal || 0))[0];
    const winner = (area.constituencyPartyResults || []).find((r) => r.rank === 1) || {};
    out.push({
      areaCode: area.areaCode,
      provinceName: area.provinceName,
      areaName: area.areaName,
      smallVoteTotal,
      areaTotalVotes,
      smallVoteShare,
      smallPartyCountInArea: partyRows.length,
      topSmallPartyNo: topParty?.partyNo,
      topSmallPartyName: topParty?.partyName,
      topSmallPartyVotes: Number(topParty?.voteTotal || 0),
      winnerPartyCode: winner.partyCode,
      winnerPartyNo: winner.partyNo,
      winnerPartyName: winner.partyName,
      winnerInMajor: majorCodeSet.has(winner.partyCode),
    });
  }
  out.sort((a, b) => Number(b.smallVoteShare || 0) - Number(a.smallVoteShare || 0));
  return { rows: out, majorParties };
}

function renderHotspots() {
  const { rows: allRows, majorParties } = getHotspotRows();
  const rows = allRows.slice(0, state.hotspotTopN);

  Plotly.newPlot(
    "hotspot-chart",
    [
      {
        type: "bar",
        x: rows.map((r) => `${r.provinceName} | ${r.areaName}`),
        y: rows.map((r) => Number(r.smallVoteShare || 0) * 100),
        marker: { color: "#bb3e03" },
      },
    ],
    {
      title: `${state.hotspotTopN} เขตที่คะแนนพรรคเล็กสูงผิดปกติ (วัดจากสัดส่วนคะแนนพรรคเล็กในเขต)`,
      margin: { t: 50, r: 14, b: 160, l: 68 },
      yaxis: { title: "สัดส่วนคะแนนพรรคเล็กในเขต (%)" },
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "hotspot-table",
    columns: [
      { key: "provinceName", label: "จังหวัด" },
      { key: "areaName", label: "เขต" },
      { key: "smallVoteTotal", label: "คะแนนรวมพรรคเล็กในเขต", format: (v) => fmtNum(v) },
      { key: "areaTotalVotes", label: "คะแนนรวมทั้งเขต", format: (v) => fmtNum(v) },
      { key: "smallVoteShare", label: "สัดส่วนพรรคเล็กในเขต", format: (v) => fmtPct(v, 2) },
      { key: "topSmallPartyNo", label: "พรรคเล็กอันดับ 1 (เบอร์)" },
      { key: "topSmallPartyName", label: "พรรคเล็กอันดับ 1 (ชื่อ)" },
      { key: "topSmallPartyVotes", label: "คะแนนพรรคเล็กอันดับ 1", format: (v) => fmtNum(v) },
      { key: "winnerPartyNo", label: "ผู้ชนะเขต (เบอร์พรรค)" },
      { key: "winnerPartyName", label: "ผู้ชนะเขต (ชื่อพรรค)" },
    ],
    rows,
    sortId: "hotspot-table",
    defaultKey: "smallVoteShare",
    onSortChange: renderHotspots,
    totalRow: {
      provinceName: "รวม",
      areaName: `Top ${fmtNum(state.hotspotTopN)} เขต`,
      smallVoteTotal: rows.reduce((s, r) => s + Number(r.smallVoteTotal || 0), 0),
      areaTotalVotes: rows.reduce((s, r) => s + Number(r.areaTotalVotes || 0), 0),
      smallVoteShare:
        rows.reduce((s, r) => s + Number(r.areaTotalVotes || 0), 0) > 0
          ? rows.reduce((s, r) => s + Number(r.smallVoteTotal || 0), 0) /
            rows.reduce((s, r) => s + Number(r.areaTotalVotes || 0), 0)
          : 0,
      topSmallPartyNo: "-",
      topSmallPartyName: "-",
      topSmallPartyVotes: rows.reduce((s, r) => s + Number(r.topSmallPartyVotes || 0), 0),
      winnerPartyNo: "-",
      winnerPartyName: "-",
    },
  });

  const winnerMap = new Map(majorParties.map((p) => [p.partyCode, { ...p, winCount: 0 }]));
  let otherWin = 0;
  for (const r of rows) {
    if (winnerMap.has(r.winnerPartyCode)) {
      winnerMap.get(r.winnerPartyCode).winCount += 1;
    } else {
      otherWin += 1;
    }
  }
  const winnerRows = Array.from(winnerMap.values())
    .map((r) => ({
      partyNo: r.partyNo,
      partyName: r.partyName,
      winCount: r.winCount,
      winShare: rows.length > 0 ? r.winCount / rows.length : 0,
    }))
    .sort((a, b) => b.winCount - a.winCount);
  winnerRows.push({
    partyNo: "-",
    partyName: "อื่นๆ (นอกพรรคใหญ่ 5)",
    winCount: otherWin,
    winShare: rows.length > 0 ? otherWin / rows.length : 0,
  });

  renderSortableTable({
    tableId: "hotspot-winner-table",
    columns: [
      { key: "partyNo", label: "หมายเลขพรรค" },
      { key: "partyName", label: "ชื่อพรรค" },
      { key: "winCount", label: "จำนวนเขตที่ชนะ", format: (v) => fmtNum(v) },
      { key: "winShare", label: "สัดส่วนในชุดเขตนี้", format: (v) => fmtPct(v, 2) },
    ],
    rows: winnerRows,
    sortId: "hotspot-winner",
    defaultKey: "winCount",
    onSortChange: renderHotspots,
  });

  const top1 = rows[0];
  const summary = document.getElementById("hotspot-summary");
  if (!top1) {
    summary.textContent = "ไม่พบข้อมูลสำหรับจัดอันดับเขต";
    return;
  }
  const topWinner = winnerRows
    .filter((r) => r.partyNo !== "-")
    .sort((a, b) => Number(b.winCount || 0) - Number(a.winCount || 0))[0];
  summary.innerHTML =
    `เขตที่มีสัดส่วนคะแนนพรรคเล็กสูงสุดตอนนี้คือ ${escapeHtml(top1.provinceName || "")} ${escapeHtml(top1.areaName || "")} ` +
    `คิดเป็น ${fmtPct(top1.smallVoteShare, 2)} ของคะแนนรวมในเขต ` +
    `โดยพรรคเล็กที่ได้คะแนนสูงสุดในเขตนี้คือ เบอร์ ${top1.topSmallPartyNo ?? "?"} ${escapeHtml(top1.topSmallPartyName || "ไม่ทราบ")} ` +
    `และถ้าดูภาพรวม Top ${fmtNum(state.hotspotTopN)} เขต พรรคใหญ่ที่ชนะมากสุดคือ ` +
    `เบอร์ ${topWinner?.partyNo ?? "?"} ${escapeHtml(topWinner?.partyName || "ไม่ทราบ")} (${fmtNum(topWinner?.winCount || 0)} เขต)`;
}

function getEvidenceSmallPartyRange() {
  const def = state.data?.analysisEvidence?.definition?.smallPartyRangeFromConfig || [1, 9];
  return { min: Number(def[0] || 1), max: Number(def[1] || 9) };
}

function getEvidenceSwapRows() {
  const { min, max } = getEvidenceSmallPartyRange();
  const rows = [];
  for (const area of state.data?.areas || []) {
    const constituencyTotalVotes = Number(area?.constituencyTotals?.totalVotes || 0);
    if (constituencyTotalVotes <= 0) continue;
    const candidatesByNo = new Map((area.candidates || []).map((c) => [c.candidateNo, c]));
    const constituencyByParty = new Map((area.constituencyPartyResults || []).map((r) => [r.partyCode, r]));
    const winner = (area.constituencyPartyResults || []).find((r) => r.rank === 1) || {};
    const winnerPartyCode = winner.partyCode;
    for (const pr of area.partyResults || []) {
      const no = Number(pr.partyNo || 0);
      if (no < min || no > max) continue;
      const inSmallPartySet = getOriginEligibleSmallPartyCodes().has(pr.partyCode);
      if (!inSmallPartySet) continue;
      const candidate = candidatesByNo.get(no);
      if (!candidate) continue;
      const sourcePartyNo = Number(candidate.candidatePartyNo || 0);
      if (!EVIDENCE_MAJOR_PARTY_NOS.has(sourcePartyNo)) continue;
      const sourceConstituency = constituencyByParty.get(candidate.candidatePartyCode) || {};
      const sourceVotes = Number(sourceConstituency.voteTotal || 0);
      rows.push({
        areaCode: area.areaCode,
        smallPartyVotes: Number(pr.voteTotal || 0),
        sourcePartyCode: candidate.candidatePartyCode,
        sourcePartyNo,
        sourcePartyName: candidate.candidatePartyName,
        sourceConstituencyVotes: sourceVotes,
        sourcePartyWonArea: candidate.candidatePartyCode === winnerPartyCode,
      });
    }
  }
  return rows;
}

function renderEvidence() {
  const rawRows = getEvidenceSwapRows();
  const byParty = new Map();
  for (const r of rawRows) {
    const key = r.sourcePartyCode || "UNKNOWN";
    if (!byParty.has(key)) {
      byParty.set(key, {
        sourcePartyCode: r.sourcePartyCode,
        sourcePartyNo: r.sourcePartyNo,
        sourcePartyName: r.sourcePartyName,
        proxyVotesWin: 0,
        sourceVotesWin: 0,
        matchedRowsWin: 0,
        areaSetWin: new Set(),
        proxyVotesLose: 0,
        sourceVotesLose: 0,
        matchedRowsLose: 0,
        areaSetLose: new Set(),
      });
    }
    const x = byParty.get(key);
    if (r.sourcePartyWonArea) {
      x.proxyVotesWin += Number(r.smallPartyVotes || 0);
      x.sourceVotesWin += Number(r.sourceConstituencyVotes || 0);
      x.matchedRowsWin += 1;
      x.areaSetWin.add(r.areaCode);
    } else {
      x.proxyVotesLose += Number(r.smallPartyVotes || 0);
      x.sourceVotesLose += Number(r.sourceConstituencyVotes || 0);
      x.matchedRowsLose += 1;
      x.areaSetLose.add(r.areaCode);
    }
  }

  const rows = Array.from(byParty.values())
    .map((r) => {
      const winRate = r.sourceVotesWin > 0 ? r.proxyVotesWin / r.sourceVotesWin : 0;
      const loseRate = r.sourceVotesLose > 0 ? r.proxyVotesLose / r.sourceVotesLose : 0;
      return {
        sourcePartyCode: r.sourcePartyCode,
        sourcePartyNo: r.sourcePartyNo,
        sourcePartyName: r.sourcePartyName,
        winSwapRate: winRate,
        loseSwapRate: loseRate,
        diffSwapRate: winRate - loseRate,
        proxyVotesWin: r.proxyVotesWin,
        sourceVotesWin: r.sourceVotesWin,
        winAreaCount: r.areaSetWin.size,
        matchedRowsWin: r.matchedRowsWin,
        proxyVotesLose: r.proxyVotesLose,
        sourceVotesLose: r.sourceVotesLose,
        loseAreaCount: r.areaSetLose.size,
        matchedRowsLose: r.matchedRowsLose,
        totalMatchedRows: r.matchedRowsWin + r.matchedRowsLose,
      };
    })
    .filter((r) => r.totalMatchedRows > 0)
    .sort((a, b) => Number(b.diffSwapRate || 0) - Number(a.diffSwapRate || 0));

  const chartRows = rows
    .slice()
    .sort((a, b) => Number(b.totalMatchedRows || 0) - Number(a.totalMatchedRows || 0))
    .slice(0, 10);

  const totalWinProxy = rows.reduce((s, r) => s + Number(r.proxyVotesWin || 0), 0);
  const totalWinSource = rows.reduce((s, r) => s + Number(r.sourceVotesWin || 0), 0);
  const totalLoseProxy = rows.reduce((s, r) => s + Number(r.proxyVotesLose || 0), 0);
  const totalLoseSource = rows.reduce((s, r) => s + Number(r.sourceVotesLose || 0), 0);
  const overallWinRate = totalWinSource > 0 ? totalWinProxy / totalWinSource : 0;
  const overallLoseRate = totalLoseSource > 0 ? totalLoseProxy / totalLoseSource : 0;

  renderKpis("evidence-kpis", [
    { label: "พรรคใหญ่ที่ใช้นิยาม", value: "9, 27, 37, 42, 46" },
    { label: "จำนวนพรรคที่เปรียบเทียบได้", value: fmtNum(rows.length) },
    { label: "% กาสลับโดยประมาณ (เขตที่พรรคชนะ)", value: fmtPct(overallWinRate, 2) },
    { label: "% กาสลับโดยประมาณ (เขตที่พรรคไม่ชนะ)", value: fmtPct(overallLoseRate, 2) },
    { label: "ส่วนต่าง (ชนะ - ไม่ชนะ)", value: fmtPct(overallWinRate - overallLoseRate, 2) },
  ]);

  Plotly.newPlot(
    "evidence-winlose-chart",
    [
      {
        type: "bar",
        name: "เขตที่พรรคชนะ",
        x: chartRows.map((r) => `เบอร์ ${r.sourcePartyNo ?? "?"} ${r.sourcePartyName || "ไม่ทราบ"}`),
        y: chartRows.map((r) => Number(r.winSwapRate || 0) * 100),
        marker: { color: "#ca6702" },
      },
      {
        type: "bar",
        name: "เขตที่พรรคไม่ชนะ",
        x: chartRows.map((r) => `เบอร์ ${r.sourcePartyNo ?? "?"} ${r.sourcePartyName || "ไม่ทราบ"}`),
        y: chartRows.map((r) => Number(r.loseSwapRate || 0) * 100),
        marker: { color: "#005f73" },
      },
    ],
    {
      title: "เทียบ % กาสลับโดยประมาณ: เขตที่พรรคชนะ vs ไม่ชนะ (Top 10 พรรคที่มีข้อมูลมากสุด)",
      margin: { t: 52, r: 14, b: 150, l: 70 },
      yaxis: { title: "% กาสลับโดยประมาณ" },
      barmode: "group",
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "evidence-winlose-table",
    columns: [
      { key: "sourcePartyNo", label: "หมายเลขพรรค" },
      { key: "sourcePartyName", label: "ชื่อพรรค" },
      { key: "winSwapRate", label: "% กาสลับ (เขตชนะ)", format: (v) => fmtPct(v, 2) },
      { key: "loseSwapRate", label: "% กาสลับ (เขตไม่ชนะ)", format: (v) => fmtPct(v, 2) },
      { key: "diffSwapRate", label: "ส่วนต่าง (ชนะ-ไม่ชนะ)", format: (v) => fmtPct(v, 2) },
      { key: "winAreaCount", label: "จำนวนเขตที่ชนะ (เข้าเงื่อนไขชนเลข)", format: (v) => fmtNum(v) },
      { key: "loseAreaCount", label: "จำนวนเขตที่ไม่ชนะ (เข้าเงื่อนไขชนเลข)", format: (v) => fmtNum(v) },
      { key: "matchedRowsWin", label: "แถวจับคู่ฝั่งชนะ", format: (v) => fmtNum(v) },
      { key: "matchedRowsLose", label: "แถวจับคู่ฝั่งไม่ชนะ", format: (v) => fmtNum(v) },
    ],
    rows,
    sortId: "evidence-winlose",
    defaultKey: "diffSwapRate",
    onSortChange: renderEvidence,
  });

  const summary = document.getElementById("evidence-summary");
  const topPos = rows.filter((r) => r.diffSwapRate > 0).length;
  summary.innerHTML =
    `สรุปอ่านง่าย: นิยามส่วนนี้นับเฉพาะพรรคใหญ่ 5 พรรค (เบอร์ 9, 27, 37, 42, 46). ` +
    `ถ้ารวมทุกพรรคที่มีข้อมูลในชุดนี้ ` +
    `ค่าเฉลี่ยแบบถ่วงน้ำหนักของ % กาสลับโดยประมาณอยู่ที่ ${fmtPct(overallWinRate, 2)} ในเขตที่พรรคชนะ ` +
    `เทียบกับ ${fmtPct(overallLoseRate, 2)} ในเขตที่พรรคไม่ชนะ ` +
    `(ต่างกัน ${fmtPct(overallWinRate - overallLoseRate, 2)}). ` +
    `ในตารางมี ${fmtNum(topPos)} พรรคจาก ${fmtNum(rows.length)} พรรคที่ค่าฝั่ง “ชนะ” สูงกว่า “ไม่ชนะ”.`;
}

function getOriginRows() {
  const eligibleSmallPartyCodes = getOriginEligibleSmallPartyCodes();
  let rows = [];
  const areas = state.data?.areas || [];
  for (const area of areas) {
    if (state.originProvince !== "ALL" && area.provinceName !== state.originProvince) continue;
    const candidatesByNo = new Map((area.candidates || []).map((c) => [c.candidateNo, c]));
    const constituencyByParty = new Map((area.constituencyPartyResults || []).map((r) => [r.partyCode, r]));
    const constituencyTotalVotes = Number(area?.constituencyTotals?.totalVotes || 0);
    const winnerEntry = (area.constituencyPartyResults || []).find((x) => x.rank === 1);
    const winnerPartyCode = winnerEntry?.partyCode;
    for (const pr of area.partyResults || []) {
      if (!eligibleSmallPartyCodes.has(pr.partyCode)) continue;
      if (state.originSmallPartyCode !== "ALL" && pr.partyCode !== state.originSmallPartyCode) continue;
      const candidate = candidatesByNo.get(pr.partyNo);
      if (!candidate) continue;
      const sourceConstituency = constituencyByParty.get(candidate.candidatePartyCode) || {};
      const sourceConstituencyVotesInArea = Number(sourceConstituency.voteTotal || 0);
      const sourcePartyWonArea = candidate.candidatePartyCode === winnerPartyCode;
      const sourcePartyNo = Number(candidate.candidatePartyNo || 0);
      if (!EVIDENCE_MAJOR_PARTY_NOS.has(sourcePartyNo)) continue;

      rows.push({
        areaCode: area.areaCode,
        areaName: area.areaName,
        provinceCode: area.provinceCode,
        provinceName: area.provinceName,
        smallPartyCode: pr.partyCode,
        smallPartyNo: pr.partyNo,
        smallPartyName: pr.partyName,
        smallPartyVotes: Number(pr.voteTotal || 0),
        smallPartyVotePercent: Number(pr.votePercent || 0),
        candidateNo: pr.partyNo,
        matched: true,
        candidatePartyCode: candidate.candidatePartyCode,
        candidatePartyNo: sourcePartyNo,
        candidatePartyName: candidate.candidatePartyName,
        candidateName: candidate.candidateName,
        sourcePartyWonArea,
        sourceConstituencyVotesInArea,
        sourceConstituencyShareInArea: constituencyTotalVotes > 0 ? sourceConstituencyVotesInArea / constituencyTotalVotes : 0,
      });
    }
  }

  const areaConstituencyVoteMap = new Map();
  for (const a of state.data?.areas || []) {
    const byParty = new Map();
    for (const pr of a.constituencyPartyResults || []) {
      byParty.set(pr.partyCode, Number(pr.voteTotal || 0));
    }
    areaConstituencyVoteMap.set(a.areaCode, byParty);
  }

  const bySource = new Map();
  let totalProxyVotes = 0;
  for (const r of rows) {
    const key = r.candidatePartyCode || "UNKNOWN";
    if (!bySource.has(key)) {
      bySource.set(key, {
        sourcePartyCode: r.candidatePartyCode,
        sourcePartyNo: r.candidatePartyNo,
        sourcePartyName: r.candidatePartyName,
        proxyVotes: 0,
        rows: 0,
        areaSet: new Set(), // เขตที่พบเลขชนของพรรคเล็ก (ภายใต้ filter ปัจจุบัน)
      });
    }
    const x = bySource.get(key);
    const v = Number(r.smallPartyVotes || 0);
    x.proxyVotes += v;
    x.rows += 1;
    x.areaSet.add(r.areaCode);
    totalProxyVotes += v;
  }

  const out = Array.from(bySource.values()).map((r) => ({
    ...r,
    areaCount: r.areaSet.size,
    shareOfProxyVotes: totalProxyVotes > 0 ? r.proxyVotes / totalProxyVotes : 0,
    sourceConstituencyVotes: Array.from(r.areaSet).reduce((acc, areaCode) => {
      const byParty = areaConstituencyVoteMap.get(areaCode);
      const v = byParty ? Number(byParty.get(r.sourcePartyCode) || 0) : 0;
      return acc + v;
    }, 0),
    normalizedByConstituency: 0,
  }));
  for (const r of out) {
    r.normalizedByConstituency = r.sourceConstituencyVotes > 0 ? r.proxyVotes / r.sourceConstituencyVotes : 0;
  }
  out.sort((a, b) => b.proxyVotes - a.proxyVotes);
  return { rows: out, totalProxyVotes, areaRows: rows };
}

function aggregateOriginFromAreaRows(areaRows) {
  const bySource = new Map();
  let totalProxyVotes = 0;
  for (const r of areaRows) {
    const key = r.candidatePartyCode || "UNKNOWN";
    if (!bySource.has(key)) {
      bySource.set(key, {
        sourcePartyCode: r.candidatePartyCode,
        sourcePartyNo: r.candidatePartyNo,
        sourcePartyName: r.candidatePartyName,
        proxyVotes: 0,
        rows: 0,
        areaSet: new Set(),
        areaDenominator: new Map(),
      });
    }
    const x = bySource.get(key);
    const v = Number(r.smallPartyVotes || 0);
    x.proxyVotes += v;
    x.rows += 1;
    x.areaSet.add(r.areaCode);
    if (!x.areaDenominator.has(r.areaCode)) {
      x.areaDenominator.set(r.areaCode, Number(r.sourceConstituencyVotesInArea || 0));
    }
    totalProxyVotes += v;
  }

  const out = Array.from(bySource.values()).map((r) => {
    const sourceConstituencyVotes = Array.from(r.areaDenominator.values()).reduce((s, v) => s + Number(v || 0), 0);
    return {
      sourcePartyCode: r.sourcePartyCode,
      sourcePartyNo: r.sourcePartyNo,
      sourcePartyName: r.sourcePartyName,
      proxyVotes: r.proxyVotes,
      rows: r.rows,
      areaCount: r.areaSet.size,
      sourceConstituencyVotes,
      normalizedByConstituency: sourceConstituencyVotes > 0 ? r.proxyVotes / sourceConstituencyVotes : 0,
      shareOfProxyVotes: totalProxyVotes > 0 ? r.proxyVotes / totalProxyVotes : 0,
    };
  });
  out.sort((a, b) => Number(b.proxyVotes || 0) - Number(a.proxyVotes || 0));
  return { rows: out, totalProxyVotes };
}

function getOriginModeLabel() {
  return "ทุกเขต (พรรคต้นทางเฉพาะพรรคใหญ่ 5 พรรค)";
}

function refreshOriginSmallPartyFilter() {
  const smallPartySel = document.getElementById("origin-small-party-filter");
  if (!smallPartySel) return;

  const eligible = getOriginBaseSmallPartyRows()
    .map((p) => ({ partyCode: p.partyCode, partyNo: p.partyNo, partyName: p.partyName }))
    .sort((a, b) => (a.partyNo || 999) - (b.partyNo || 999));

  smallPartySel.innerHTML =
    `<option value="ALL">ทุกพรรคเล็กในช่วงที่เลือก</option>` +
    eligible
      .map((p) => `<option value="${escapeHtml(p.partyCode)}">เบอร์ ${escapeHtml(p.partyNo)} ${escapeHtml(p.partyName || "ไม่ทราบ")}</option>`)
      .join("");

  const stillExists = eligible.some((p) => p.partyCode === state.originSmallPartyCode);
  if (!stillExists) {
    state.originSmallPartyCode = "ALL";
  }
  smallPartySel.value = state.originSmallPartyCode;
}

function renderOriginAnalysis() {
  const { rows, totalProxyVotes, areaRows } = getOriginRows();
  const selectedSmallParty = areaRows[0]?.smallPartyName;
  const selectedSmallPartyNo = areaRows[0]?.smallPartyNo;
  const filtered = rows
    .filter((r) => EVIDENCE_MAJOR_PARTY_NOS.has(Number(r.sourcePartyNo || 0)))
    .slice();
  const top = filtered.slice().sort((a, b) => Number(b.proxyVotes || 0) - Number(a.proxyVotes || 0));
  const topNormalized = filtered
    .slice()
    .sort((a, b) => Number(b.normalizedByConstituency || 0) - Number(a.normalizedByConstituency || 0));
  const topProxySum = top.reduce((s, r) => s + Number(r.proxyVotes || 0), 0);
  const topDenomSum = top.reduce((s, r) => s + Number(r.sourceConstituencyVotes || 0), 0);
  const topShareSum = top.reduce((s, r) => s + Number(r.shareOfProxyVotes || 0), 0);

  Plotly.newPlot(
    "origin-source-chart",
    [
      {
        type: "bar",
        x: top.map((r) => `เบอร์ ${r.sourcePartyNo ?? "?"} ${r.sourcePartyName || "ไม่ทราบ"}`),
        y: top.map((r) => Number(r.proxyVotes || 0)),
        marker: { color: top.map((r) => partyColorByNo(r.sourcePartyNo)) },
      },
    ],
    {
      title:
        state.originSmallPartyCode === "ALL"
          ? `คะแนนดิบที่เกี่ยวข้อง แยกตามพรรคต้นทาง (พรรคใหญ่ 5 พรรค)`
          : `พรรคเล็กเบอร์ ${selectedSmallPartyNo ?? "?"} ${selectedSmallParty || ""}: คะแนนดิบที่เกี่ยวข้องตามพรรคต้นทาง (พรรคใหญ่ 5 พรรค)`,
      margin: { t: 50, r: 14, b: 120, l: 70 },
      yaxis: { title: "คะแนนดิบที่เกี่ยวข้อง (เสียง)" },
    },
    { responsive: true }
  );

  Plotly.newPlot(
    "origin-source-normalized-chart",
    [
      {
        type: "bar",
        x: topNormalized.map((r) => `เบอร์ ${r.sourcePartyNo ?? "?"} ${r.sourcePartyName || "ไม่ทราบ"}`),
        y: topNormalized.map((r) => Number(r.normalizedByConstituency || 0) * 100),
        marker: { color: topNormalized.map((r) => partyColorByNo(r.sourcePartyNo)) },
      },
    ],
    {
      title: "เปอร์เซ็นต์ของคะแนน สส.เขตของพรรคต้นทาง",
      margin: { t: 50, r: 14, b: 120, l: 70 },
      yaxis: { title: "เปอร์เซ็นต์ของคะแนน สส.เขต (%)" },
    },
    { responsive: true }
  );

  const topCodes = new Set(top.map((r) => r.sourcePartyCode));
  const relationRows = areaRows.filter((r) => topCodes.has(r.candidatePartyCode));
  const byParty = new Map();
  for (const r of relationRows) {
    const code = r.candidatePartyCode;
    if (!byParty.has(code)) {
      byParty.set(code, {
        sourcePartyNo: r.candidatePartyNo,
        sourcePartyName: r.candidatePartyName,
        points: [],
      });
    }
    byParty.get(code).points.push(r);
  }

  const relationTraces = [];
  const relationSummaryRows = [];
  for (const g of byParty.values()) {
    const xs = g.points.map((p) => Number(p.sourceConstituencyShareInArea || 0) * 100);
    const ys = g.points.map((p) => Number(p.smallPartyVotePercent || 0));
    const partyName = `เบอร์ ${g.sourcePartyNo ?? "?"} ${g.sourcePartyName || "ไม่ทราบ"}`;
    relationTraces.push({
      type: "scatter",
      mode: "markers",
      name: partyName,
      x: xs,
      y: ys,
      text: g.points.map((p) => `${p.provinceName} | ${p.areaName}`),
      hovertemplate: "%{text}<br>สัดส่วนคะแนน สส.เขตของพรรคต้นทาง: %{x:.2f}%<br>คะแนนพรรคเล็ก: %{y:.2f}%<extra></extra>",
      marker: { size: 8, opacity: 0.75, color: partyColorByNo(g.sourcePartyNo) },
    });
    const trend = linearTrend(xs, ys);
    if (trend) {
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      relationTraces.push({
        type: "scatter",
        mode: "lines",
        name: `${partyName} (trend)`,
        x: [minX, maxX],
        y: [trend.intercept + trend.slope * minX, trend.intercept + trend.slope * maxX],
        line: { width: 2, dash: "dot", color: partyColorByNo(g.sourcePartyNo) },
        hovertemplate: `${partyName}<br>trend line<extra></extra>`,
      });
    }
    relationSummaryRows.push({
      sourcePartyNo: g.sourcePartyNo,
      sourcePartyName: g.sourcePartyName,
      pointCount: g.points.length,
      avgWinChanceProxy: xs.reduce((s, v) => s + v, 0) / Math.max(xs.length, 1),
      avgSmallPartyShare: ys.reduce((s, v) => s + v, 0) / Math.max(ys.length, 1),
      corr: pearsonCorrelation(xs, ys),
    });
  }
  relationSummaryRows.sort((a, b) => b.pointCount - a.pointCount);

  Plotly.newPlot(
    "origin-relation-chart",
    relationTraces,
    {
      title: "ความสัมพันธ์รายเขต: สัดส่วนคะแนน สส.เขตของพรรคต้นทาง vs คะแนนพรรคเล็ก",
      height: 675,
      margin: { t: 50, r: 14, b: 58, l: 70 },
      xaxis: { title: "สัดส่วนคะแนน สส.เขตของพรรคต้นทาง (%)" },
      yaxis: { title: "สัดส่วนคะแนนพรรคเล็กในเขต (%)" },
      legend: { orientation: "h" },
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "origin-relation-table",
    columns: [
      { key: "sourcePartyNo", label: "หมายเลขพรรคต้นทาง" },
      { key: "sourcePartyName", label: "ชื่อพรรคต้นทาง" },
      { key: "pointCount", label: "จำนวนเขต (จุด)", format: (v) => fmtNum(v) },
      { key: "avgWinChanceProxy", label: "สัดส่วนคะแนน สส.เขตเฉลี่ย", format: (v) => `${fmtNum(v, 2)}%` },
      { key: "avgSmallPartyShare", label: "คะแนนพรรคเล็กเฉลี่ย", format: (v) => `${fmtNum(v, 2)}%` },
      { key: "corr", label: "ค่าสหสัมพันธ์ (r)", format: (v) => fmtNum(v, 3) },
    ],
    rows: relationSummaryRows,
    sortId: "origin-relation",
    defaultKey: "pointCount",
    onSortChange: renderOriginAnalysis,
  });

  const relationSummaryEl = document.getElementById("origin-relation-summary");
  const strongest = [...relationSummaryRows].sort((a, b) => Math.abs(Number(b.corr || 0)) - Math.abs(Number(a.corr || 0)))[0];
  relationSummaryEl.innerHTML =
    relationSummaryRows.length === 0
      ? "ยังไม่มีข้อมูลพอสำหรับอ่านความสัมพันธ์ในส่วนนี้"
      : `อ่านแบบง่าย: ตารางนี้บอกว่าถ้าเขตไหนพรรคต้นทางได้คะแนน สส.เขตมากขึ้น ` +
        `คะแนนพรรคเล็กในเขตเดียวกันเพิ่มตามไหม. ` +
        `ตอนนี้พรรคที่เห็นความสัมพันธ์ชัดสุดในชุดที่แสดงคือ เบอร์ ${strongest?.sourcePartyNo ?? "?"} ${escapeHtml(
          strongest?.sourcePartyName || "ไม่ทราบ"
        )} (r = ${fmtNum(strongest?.corr || 0, 3)}).`;

  renderSortableTable({
    tableId: "origin-source-table",
    columns: [
      { key: "sourcePartyNo", label: "หมายเลขพรรคต้นทาง" },
      { key: "sourcePartyName", label: "ชื่อพรรคต้นทาง" },
      { key: "proxyVotes", label: "คะแนนที่เกี่ยวข้อง (เสียง)", format: (v) => fmtNum(v) },
      { key: "sourceConstituencyVotes", label: "คะแนน สส.เขตของพรรคต้นทาง (เฉพาะเขตที่ชน)", format: (v) => fmtNum(v) },
      { key: "normalizedByConstituency", label: "เปอร์เซ็นต์ของคะแนน สส.เขต", format: (v) => fmtPct(v, 3) },
      { key: "shareOfProxyVotes", label: "สัดส่วนต่อทั้งหมด", format: (v) => fmtPct(v, 2) },
      { key: "areaCount", label: "จำนวนเขตที่พบ", format: (v) => fmtNum(v) },
      { key: "rows", label: "จำนวนแถวที่จับคู่ได้", format: (v) => fmtNum(v) },
    ],
    rows: top,
    sortId: "origin-source",
    defaultKey: "normalizedByConstituency",
    onSortChange: renderOriginAnalysis,
    totalRow: {
      sourcePartyNo: "-",
      sourcePartyName: "รวม (เฉพาะที่แสดง)",
      proxyVotes: topProxySum,
      sourceConstituencyVotes: topDenomSum,
      normalizedByConstituency: topDenomSum > 0 ? topProxySum / topDenomSum : 0,
      shareOfProxyVotes: topShareSum,
      areaCount: "-",
      rows: top.reduce((s, r) => s + Number(r.rows || 0), 0),
    },
  });

  renderSortableTable({
    tableId: "origin-area-table",
    columns: [
      { key: "provinceName", label: "จังหวัด" },
      { key: "areaName", label: "เขต" },
      { key: "smallPartyNo", label: "หมายเลขพรรคเล็ก" },
      { key: "smallPartyName", label: "ชื่อพรรคเล็ก" },
      { key: "smallPartyVotes", label: "คะแนนพรรคเล็กในเขตนี้", format: (v) => fmtNum(v) },
      { key: "candidateNo", label: "หมายเลขผู้สมัครที่เลขชน" },
      { key: "candidatePartyNo", label: "หมายเลขพรรคต้นทาง" },
      { key: "candidatePartyName", label: "ชื่อพรรคต้นทาง" },
      { key: "sourcePartyWonArea", label: "พรรคต้นทางชนะเขต?", format: (v) => (v ? "ใช่" : "ไม่ใช่") },
      { key: "candidateName", label: "ชื่อผู้สมัคร สส.เขต" },
    ],
    rows: areaRows,
    sortId: "origin-area",
    defaultKey: "smallPartyVotes",
    onSortChange: renderOriginAnalysis,
    totalRow: {
      provinceName: "รวม",
      areaName: `ทั้งหมด ${fmtNum(areaRows.length)} แถว`,
      smallPartyNo: "-",
      smallPartyName: "-",
      smallPartyVotes: areaRows.reduce((s, r) => s + Number(r.smallPartyVotes || 0), 0),
      candidateNo: "-",
      candidatePartyNo: "-",
      candidatePartyName: "-",
      sourcePartyWonArea: "-",
      candidateName: "-",
    },
  });

  const top1 = rows[0];
  const summary = document.getElementById("origin-summary");
  if (!top1) {
    summary.textContent = "ยังไม่มีข้อมูลจับคู่เพียงพอสำหรับสรุปพรรคต้นทาง";
    return;
  }
  summary.innerHTML =
    `เราพบว่าพรรคต้นทางที่แจกคะแนนมากเป็นอันดับ 1 คือ ` +
    `พรรคเบอร์ ${top1.sourcePartyNo ?? "?"} ${escapeHtml(top1.sourcePartyName || "ไม่ทราบ")} ` +
    `มีคะแนนของพรรคเล็กที่เกี่ยวข้อง ${fmtNum(top1.proxyVotes)} เสียง ` +
    `คิดเป็น ${fmtPct(top1.shareOfProxyVotes, 2)} ของคะแนนกลุ่มที่จับคู่ได้ ` +
    `เทียบเป็นสัดส่วน ${fmtPct(top1.normalizedByConstituency, 3)} ของคะแนน สส.เขต`

  const winOnlyAreaRows = areaRows.filter((r) => r.sourcePartyWonArea);
  const winOnlyAgg = aggregateOriginFromAreaRows(winOnlyAreaRows);
  const winRows = winOnlyAgg.rows
    .filter((r) => EVIDENCE_MAJOR_PARTY_NOS.has(Number(r.sourcePartyNo || 0)))
    .sort((a, b) => Number(b.proxyVotes || 0) - Number(a.proxyVotes || 0));
  const winRowsNormalized = winRows
    .slice()
    .sort((a, b) => Number(b.normalizedByConstituency || 0) - Number(a.normalizedByConstituency || 0));

  Plotly.newPlot(
    "origin-win-source-chart",
    [
      {
        type: "bar",
        x: winRows.map((r) => `เบอร์ ${r.sourcePartyNo ?? "?"} ${r.sourcePartyName || "ไม่ทราบ"}`),
        y: winRows.map((r) => Number(r.proxyVotes || 0)),
        marker: { color: winRows.map((r) => partyColorByNo(r.sourcePartyNo)) },
      },
    ],
    {
      title: "คะแนนดิบที่เกี่ยวข้อง (เฉพาะเขตที่พรรคต้นทางชนะเขต)",
      margin: { t: 50, r: 14, b: 120, l: 70 },
      yaxis: { title: "คะแนนดิบที่เกี่ยวข้อง (เสียง)" },
    },
    { responsive: true }
  );

  Plotly.newPlot(
    "origin-win-source-normalized-chart",
    [
      {
        type: "bar",
        x: winRowsNormalized.map((r) => `เบอร์ ${r.sourcePartyNo ?? "?"} ${r.sourcePartyName || "ไม่ทราบ"}`),
        y: winRowsNormalized.map((r) => Number(r.normalizedByConstituency || 0) * 100),
        marker: { color: winRowsNormalized.map((r) => partyColorByNo(r.sourcePartyNo)) },
      },
    ],
    {
      title: "เปอร์เซ็นต์ของคะแนน สส.เขตของพรรคต้นทาง (เฉพาะเขตที่ชนะ)",
      margin: { t: 50, r: 14, b: 120, l: 70 },
      yaxis: { title: "เปอร์เซ็นต์ของคะแนน สส.เขต (%)" },
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "origin-win-source-table",
    columns: [
      { key: "sourcePartyNo", label: "หมายเลขพรรคต้นทาง" },
      { key: "sourcePartyName", label: "ชื่อพรรคต้นทาง" },
      { key: "proxyVotes", label: "คะแนนดิบที่เกี่ยวข้อง (เสียง)", format: (v) => fmtNum(v) },
      { key: "normalizedByConstituency", label: "เปอร์เซ็นต์ของคะแนน สส.เขต", format: (v) => fmtPct(v, 3) },
      { key: "shareOfProxyVotes", label: "สัดส่วนต่อทั้งหมด", format: (v) => fmtPct(v, 2) },
      { key: "areaCount", label: "จำนวนเขตที่ชนะที่พบ", format: (v) => fmtNum(v) },
      { key: "rows", label: "จำนวนแถวที่จับคู่ได้", format: (v) => fmtNum(v) },
    ],
    rows: winRows,
    sortId: "origin-win-source",
    defaultKey: "proxyVotes",
    onSortChange: renderOriginAnalysis,
  });

  const winSummary = document.getElementById("origin-win-summary");
  const winTop = winRows[0];
  if (!winTop) {
    winSummary.textContent = "ยังไม่มีข้อมูลเพียงพอสำหรับสรุปเฉพาะเขตที่พรรคต้นทางชนะ";
  } else {
    const winNormAllDen = winRows.reduce((s, r) => s + Number(r.sourceConstituencyVotes || 0), 0);
    const winNormAllNum = winRows.reduce((s, r) => s + Number(r.proxyVotes || 0), 0);
    winSummary.innerHTML =
      `เมื่อจำกัดเฉพาะเขตที่พรรคต้นทางชนะเขต พบพรรคต้นทางอันดับ 1 คือ ` +
      `พรรคเบอร์ ${winTop.sourcePartyNo ?? "?"} ${escapeHtml(winTop.sourcePartyName || "ไม่ทราบ")} ` +
      `มีคะแนนดิบที่เกี่ยวข้อง ${fmtNum(winTop.proxyVotes)} เสียง ` +
      `และเปอร์เซ็นต์ของคะแนน สส.เขต ${fmtPct(winTop.normalizedByConstituency, 3)} ` +
      `(รวมทั้งกลุ่ม ${fmtNum(winOnlyAgg.totalProxyVotes)} เสียง, เปอร์เซ็นต์ของคะแนน สส.เขตรวม ${fmtPct(winNormAllDen > 0 ? winNormAllNum / winNormAllDen : 0, 3)})`;
  }
}

function setupControls() {
  const hotspotInput = document.getElementById("hotspot-topn-input");
  hotspotInput?.addEventListener("change", (e) => {
    state.hotspotTopN = Math.max(10, Math.min(400, Number(e.target.value || 30)));
    e.target.value = String(state.hotspotTopN);
    renderHotspots();
  });

  const provinceSel = document.getElementById("origin-province-filter");
  const provinces = ["ALL", ...new Set((state.data?.areas || []).map((a) => a.provinceName).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "th")
  );
  provinceSel.innerHTML = provinces.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p === "ALL" ? "ทุกจังหวัด" : p)}</option>`).join("");
  provinceSel.value = state.originProvince;
  provinceSel.addEventListener("change", (e) => {
    state.originProvince = e.target.value;
    renderOriginAnalysis();
  });

  const smallPartySel = document.getElementById("origin-small-party-filter");
  smallPartySel?.addEventListener("change", (e) => {
    state.originSmallPartyCode = e.target.value;
    renderOriginAnalysis();
  });

}

function initHypothesisText() {
  const txt = `
## สมมติฐาน 2 ข้อ (ที่อาจจะไม่เป็นจริง)
1. ระบบบัตรเลือกตั้ง 2 ใบ อาจทำให้พรรคบางพรรคได้คะแนนบัญชีรายชื่อเพิ่ม จากการที่ผู้มีสิทธิ์เลือกตั้งกาเบอร์เดียวกันทั้ง 2 ใบ หรือกาสลับใบ
2. การซื้อเสียงมีผลต่อพฤติกรรมการกาเลือกตั้งในลักษณะนี้ เพราะการซื้อเสียงนิยมซื้อเป็นเขต และผู้มีสิทธิ์เลือกถูกชักจูงให้กาเบอร์ผู้สมัครนั้นๆ
`;
  document.getElementById("hypothesis-content").innerHTML = markdownToHtml(txt);
}

async function init() {
  state.data = await fetchJson("data/dashboard-data.json");
  state.metadata = await fetchJson("data/metadata.json");

  renderHeaderMeta();
  initHypothesisText();
  setupControls();
  renderOverview();
  renderHotspots();
  refreshOriginSmallPartyFilter();
  renderOriginAnalysis();
  setupTocActive();
}

init().catch((err) => {
  console.error(err);
  alert("โหลดข้อมูลหน้า dashboard ไม่สำเร็จ");
});
