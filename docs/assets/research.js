const state = {
  data: null,
  metadata: null,
  topN: 10,
  rangeMin: 1,
  rangeMax: 10,
  excludeTop: 6,
  originProvince: "ALL",
  originSmallPartyCode: "ALL",
  originTopN: 4,
  originWinnerOnly: false,
  hotspotTopN: 30,
  sorts: {},
};

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

function renderKpis(containerId, kpis) {
  const root = document.getElementById(containerId);
  root.innerHTML = kpis
    .map((k) => `<div class="kpi"><div class="k">${escapeHtml(k.label)}</div><div class="v">${escapeHtml(k.value)}</div></div>`)
    .join("");
}

function renderSortableTable({ tableId, columns, rows, sortId, defaultKey, defaultDir = "desc", onSortChange, totalRow = null }) {
  const table = document.getElementById(tableId);
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

  renderKpis("overview-kpis", [
    { label: "จำนวนเขต", value: fmtNum(state.data.areas?.length || 0) },
    { label: "คะแนนรวม (บัญชีรายชื่อ)", value: fmtNum(n.totalVotes || 0) },
    { label: "คะแนนรวม (แบ่งเขต)", value: fmtNum(c.totalVotes || 0) },
    { label: "บัตรดี (บัญชีรายชื่อ)", value: fmtNum(n.goodVotes || 0) },
    { label: "บัตรดี (แบ่งเขต)", value: fmtNum(c.goodVotes || 0) },
    { label: "บัตรเสีย (บัญชีรายชื่อ)", value: fmtNum(n.badVotes || 0) },
    { label: "บัตรเสีย (แบ่งเขต)", value: fmtNum(c.badVotes || 0) },
  ]);

  const partyListRows = [...(overview.party_totals || [])].sort((a, b) => (b.voteTotal || 0) - (a.voteTotal || 0));
  const constituencyByCode = new Map((overview.constituency_party_totals || []).map((p) => [p.partyCode, p]));
  const topRows = partyListRows.slice(0, 10).map((p) => ({
    ...p,
    constituencyVoteTotal: Number((constituencyByCode.get(p.partyCode) || {}).voteTotal || 0),
  }));

  Plotly.newPlot(
    "party-top-chart",
    [
      {
        type: "bar",
        name: "คะแนนบัญชีรายชื่อ",
        x: topRows.map((p) => partyLabel(p)),
        y: topRows.map((p) => Number(p.voteTotal || 0)),
        marker: { color: "#ca6702" },
      },
      {
        type: "bar",
        name: "คะแนนแบ่งเขต",
        x: topRows.map((p) => partyLabel(p)),
        y: topRows.map((p) => Number(p.constituencyVoteTotal || 0)),
        marker: { color: "#005f73" },
      },
    ],
    {
      title: "คะแนนพรรค Top 10: บัญชีรายชื่อ เทียบ แบ่งเขต",
      margin: { t: 50, r: 12, b: 150, l: 58 },
      barmode: "group",
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "party-top-table",
    columns: [
      { key: "rank", label: "อันดับ" },
      { key: "partyNo", label: "หมายเลขพรรค" },
      { key: "partyName", label: "ชื่อพรรค" },
      { key: "voteTotal", label: "คะแนนบัญชีรายชื่อ", format: (v) => fmtNum(v) },
      { key: "constituencyVoteTotal", label: "คะแนนแบ่งเขต", format: (v) => fmtNum(v) },
    ],
    rows: topRows,
    sortId: "party-top",
    defaultKey: "voteTotal",
    onSortChange: renderOverview,
  });

  const overviewSummary = document.getElementById("overview-summary");
  const top1 = topRows[0];
  const topGap = top1 ? Number(top1.voteTotal || 0) - Number(top1.constituencyVoteTotal || 0) : 0;
  const partyListTotal = Number(n.totalVotes || 0);
  const constituencyTotal = Number(c.totalVotes || 0);
  overviewSummary.innerHTML =
    `ภาพรวมทั้งประเทศ: บัตรเลือกตั้งแบบบัญชีรายชื่อมี ${fmtNum(partyListTotal)} เสียง ` +
    `และแบบแบ่งเขตมี ${fmtNum(constituencyTotal)} เสียง ` +
    `ถ้าดูพรรคที่คะแนนบัญชีรายชื่อสูงสุดตอนนี้คือ ${escapeHtml(top1 ? partyLabel(top1) : "ไม่ทราบ")} ` +
    `ซึ่งต่างจากคะแนนแบ่งเขตของพรรคเดียวกัน ${fmtNum(topGap)} เสียง ` +
    `(ส่วนนี้ยังเป็นข้อสังเกต ไม่ได้สรุปสาเหตุทันที)`;
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

function renderHypothesis1() {
  const rows = getH1Rows();
  Plotly.newPlot(
    "party-number-trend-chart",
    [
      {
        type: "bar",
        name: "คะแนนบัญชีรายชื่อ (ดิบ)",
        x: rows.map((p) => p.partyNo),
        y: rows.map((p) => Number(p.voteTotal || 0)),
        text: rows.map((p) => partyLabel(p)),
        marker: { color: "#ca6702" },
      },
      {
        type: "bar",
        name: "คะแนน สส.แบบแบ่งเขต (ดิบ)",
        x: rows.map((p) => p.partyNo),
        y: rows.map((p) => Number(p.constituencyVoteTotal || 0)),
        text: rows.map((p) => partyLabel(p)),
        marker: { color: "#005f73" },
      },
    ],
    {
      title: "เทียบคะแนนดิบรายพรรค: บัญชีรายชื่อ vs แบ่งเขต (ตามหมายเลขพรรค)",
      margin: { t: 50, r: 16, b: 48, l: 68 },
      xaxis: { title: "หมายเลขพรรค" },
      yaxis: { title: "คะแนนดิบ (เสียง)" },
      barmode: "group",
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "h1-party-table",
    columns: [
      { key: "partyNo", label: "เบอร์พรรค" },
      { key: "partyName", label: "ชื่อพรรค" },
      { key: "voteTotal", label: "คะแนนบัญชีรายชื่อ (ดิบ)", format: (v) => fmtNum(v) },
      { key: "constituencyVoteTotal", label: "คะแนนแบ่งเขต (ดิบ)", format: (v) => fmtNum(v) },
      { key: "rank", label: "อันดับรวมประเทศ" },
    ],
    rows: rows.map((p) => ({ ...p })),
    sortId: "h1-table",
    defaultKey: "partyNo",
    defaultDir: "asc",
    onSortChange: renderHypothesis1,
  });

  const avgPartyList = rows.length ? rows.reduce((s, r) => s + Number(r.voteTotal || 0), 0) / rows.length : 0;
  const avgConstituency = rows.length ? rows.reduce((s, r) => s + Number(r.constituencyVoteTotal || 0), 0) / rows.length : 0;
  const summary = document.getElementById("h1-summary");
  summary.innerHTML =
    `ในช่วงพรรคเบอร์ ${state.rangeMin}-${state.rangeMax} (หลังตัดพรรคอันดับต้น ${state.excludeTop} พรรค) ` +
    `มีพรรคเข้าเกณฑ์ ${fmtNum(rows.length)} พรรค, คะแนนบัญชีรายชื่อเฉลี่ย ${fmtNum(avgPartyList)} เสียง, ` +
    `และคะแนนแบ่งเขตเฉลี่ย ${fmtNum(avgConstituency)} เสียง ` +
    `ใช้เพื่อ “ตั้งคำถาม” เบื้องต้นว่าเลขพรรคสัมพันธ์กับระดับคะแนนหรือไม่ ก่อนวิเคราะห์เชิงเหตุผลในรอบถัดไป`;
}

function getOriginEligibleSmallPartyCodes() {
  return new Set(getH1Rows().map((p) => p.partyCode));
}

function getHotspotRows() {
  const eligibleSmallPartyCodes = getOriginEligibleSmallPartyCodes();
  const big4 = (state.data?.overview?.constituency_party_totals || [])
    .slice(0, 4)
    .map((p) => ({ partyCode: p.partyCode, partyNo: p.partyNo, partyName: p.partyName }));
  const big4CodeSet = new Set(big4.map((p) => p.partyCode));
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
      winnerInBig4: big4CodeSet.has(winner.partyCode),
    });
  }
  out.sort((a, b) => Number(b.smallVoteShare || 0) - Number(a.smallVoteShare || 0));
  return { rows: out, big4 };
}

function renderHotspots() {
  const { rows: allRows, big4 } = getHotspotRows();
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

  const winnerMap = new Map(big4.map((p) => [p.partyCode, { ...p, winCount: 0 }]));
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
    partyName: "อื่นๆ (นอกพรรคใหญ่ 4)",
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

function getEvidenceModelRows() {
  const { min, max } = getEvidenceSmallPartyRange();
  const rows = [];
  for (const area of state.data?.areas || []) {
    const totalVotes = Number(area?.totals?.totalVotes || 0);
    const constituencyTotalVotes = Number(area?.constituencyTotals?.totalVotes || 0);
    if (totalVotes <= 0 || constituencyTotalVotes <= 0) continue;
    const candidatesByNo = new Map((area.candidates || []).map((c) => [c.candidateNo, c]));
    const constituencyByParty = new Map((area.constituencyPartyResults || []).map((r) => [r.partyCode, r]));
    for (const pr of area.partyResults || []) {
      const no = Number(pr.partyNo || 0);
      if (no < min || no > max) continue;
      const candidate = candidatesByNo.get(no);
      if (!candidate) continue;
      const sourceConstituency = constituencyByParty.get(candidate.candidatePartyCode) || {};
      const sourceVotes = Number(sourceConstituency.voteTotal || 0);
      rows.push({
        areaCode: area.areaCode,
        provinceCode: area.provinceCode,
        provinceName: area.provinceName,
        smallPartyVotes: Number(pr.voteTotal || 0),
        smallPartyShare: Number(pr.votePercent || 0) / 100,
        sourcePartyCode: candidate.candidatePartyCode,
        sourcePartyNo: candidate.candidatePartyNo,
        sourcePartyName: candidate.candidatePartyName,
        sourceConstituencyVotes: sourceVotes,
        sourceConstituencyShare: constituencyTotalVotes > 0 ? sourceVotes / constituencyTotalVotes : 0,
        isSuspicious: Boolean(area?.derivedMetrics?.isSuspiciousAreaResidualTop10),
      });
    }
  }
  return rows;
}

function renderEvidence() {
  const evidence = state.data?.analysisEvidence || {};
  const evA = evidence.withinProvinceComparisons || {};
  const evB = evidence.fixedEffectsResults || {};
  const evC = evidence.placeboResults || {};
  const evD = evidence.peoplePartyComparisons || {};

  const modelRows = getEvidenceModelRows();
  const suspiciousRows = modelRows.filter((r) => r.isSuspicious);
  const controlRows = modelRows.filter((r) => !r.isSuspicious);

  renderKpis("evidence-a-kpis", [
    { label: "เขตน่าสงสัย (Residual Top 10%)", value: fmtNum(evA.suspiciousAreaCount || 0) },
    { label: "เขตปกติ", value: fmtNum(evA.controlAreaCount || 0) },
    { label: "ต่างกันของสัดส่วนพรรคเล็ก (S-C)", value: fmtPct(evA?.overall?.diffSmallPartyShare || 0, 2) },
    {
      label: "ช่วงเชื่อมั่น 95%",
      value: `${fmtPct(evA?.overall?.diffSmallPartyShareBootstrapCi95?.[0] || 0, 2)} ถึง ${fmtPct(
        evA?.overall?.diffSmallPartyShareBootstrapCi95?.[1] || 0,
        2
      )}`,
    },
  ]);

  Plotly.newPlot(
    "evidence-a-box",
    [
      {
        type: "box",
        name: "เขตน่าสงสัย",
        y: suspiciousRows.map((r) => Number(r.smallPartyShare || 0) * 100),
        marker: { color: "#ae2012" },
        boxpoints: false,
      },
      {
        type: "box",
        name: "เขตปกติ",
        y: controlRows.map((r) => Number(r.smallPartyShare || 0) * 100),
        marker: { color: "#0a9396" },
        boxpoints: false,
      },
    ],
    {
      title: "เปรียบเทียบคะแนนพรรคเล็ก: เขตน่าสงสัย vs เขตปกติ (หน่วยเป็น %)",
      margin: { t: 50, r: 16, b: 46, l: 66 },
      yaxis: { title: "สัดส่วนคะแนนพรรคเล็ก (%)" },
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "evidence-a-table",
    columns: [
      { key: "provinceName", label: "จังหวัด" },
      { key: "suspiciousCount", label: "จำนวนเขตน่าสงสัย", format: (v) => fmtNum(v) },
      { key: "controlCount", label: "จำนวนเขตปกติ", format: (v) => fmtNum(v) },
      { key: "meanSmallPartyShareSuspicious", label: "เฉลี่ยเขตน่าสงสัย", format: (v) => fmtPct(v, 2) },
      { key: "meanSmallPartyShareControl", label: "เฉลี่ยเขตปกติ", format: (v) => fmtPct(v, 2) },
      { key: "diffSmallPartyShare", label: "ส่วนต่าง (S-C)", format: (v) => fmtPct(v, 2) },
      { key: "diffWinnerShare", label: "ส่วนต่าง proxy โอกาสชนะ", format: (v) => fmtPct(v, 2) },
    ],
    rows: evA.byProvince || [],
    sortId: "evidence-a",
    defaultKey: "diffSmallPartyShare",
    onSortChange: renderEvidence,
  });

  const evASummary = document.getElementById("evidence-a-summary");
  const diffA = Number(evA?.overall?.diffSmallPartyShare || 0) * 100;
  evASummary.innerHTML =
    `อ่านแบบง่าย: เมื่อเทียบ “จังหวัดเดียวกัน” เขตน่าสงสัยมีคะแนนพรรคเล็กสูงกว่าเขตปกติเฉลี่ย ${fmtNum(diffA, 2)} จุดเปอร์เซ็นต์ ` +
    `ซึ่งจัดว่า${describeDiffMagnitude(diffA)}. ` +
    `จุดนี้ช่วยลดข้อโต้แย้งว่าเกิดจากความต่างเชิงพื้นที่ใหญ่ๆ เพียงอย่างเดียว`;

  const keyCoef = evB.keyCoefficients || {};
  renderKpis("evidence-b-kpis", [
    { label: "จำนวนแถวที่ใช้ใน FE", value: fmtNum(evB.nobs || 0) },
    { label: "R²", value: fmtNum(evB.r2 || 0, 3) },
    {
      label: "ค่าสัมประสิทธิ์ interaction",
      value: `${fmtPct(keyCoef?.source_share_x_suspicious?.coef || 0, 2)}`,
    },
    {
      label: "ช่วงเชื่อมั่น 95% (interaction)",
      value: `${fmtPct(keyCoef?.source_share_x_suspicious?.ci95Low || 0, 2)} ถึง ${fmtPct(
        keyCoef?.source_share_x_suspicious?.ci95High || 0,
        2
      )}`,
    },
  ]);

  const xValues = modelRows.map((r) => Number(r.sourceConstituencyShare || 0) * 100);
  const b0 = Number((evB.allCoefficients || []).find((c) => c.name === "intercept")?.coef || 0);
  const b1 = Number(keyCoef?.source_share?.coef || 0);
  const b2 = Number(keyCoef?.suspicious?.coef || 0);
  const b3 = Number(keyCoef?.source_share_x_suspicious?.coef || 0);
  const xLine = [0, Math.max(...xValues, 1)];
  Plotly.newPlot(
    "evidence-b-scatter",
    [
      {
        type: "scatter",
        mode: "markers",
        name: "เขตปกติ",
        x: controlRows.map((r) => Number(r.sourceConstituencyShare || 0) * 100),
        y: controlRows.map((r) => Number(r.smallPartyShare || 0) * 100),
        marker: { color: "#0a9396", size: 6, opacity: 0.6 },
      },
      {
        type: "scatter",
        mode: "markers",
        name: "เขตน่าสงสัย",
        x: suspiciousRows.map((r) => Number(r.sourceConstituencyShare || 0) * 100),
        y: suspiciousRows.map((r) => Number(r.smallPartyShare || 0) * 100),
        marker: { color: "#ae2012", size: 6, opacity: 0.6 },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "เส้นแนวโน้ม FE (เขตปกติ)",
        x: xLine,
        y: xLine.map((x) => (b0 + b1 * (x / 100)) * 100),
        line: { color: "#005f73", width: 3 },
      },
      {
        type: "scatter",
        mode: "lines",
        name: "เส้นแนวโน้ม FE (เขตน่าสงสัย)",
        x: xLine,
        y: xLine.map((x) => (b0 + b2 + (b1 + b3) * (x / 100)) * 100),
        line: { color: "#9b2226", width: 3, dash: "dash" },
      },
    ],
    {
      title: "ความสัมพันธ์หลังคุมจังหวัดและพรรคต้นทาง (FE)",
      margin: { t: 50, r: 16, b: 54, l: 66 },
      xaxis: { title: "สัดส่วนคะแนน สส.เขตของพรรคต้นทางในเขต (%)" },
      yaxis: { title: "สัดส่วนคะแนนพรรคเล็ก (%)" },
    },
    { responsive: true }
  );

  const coefRows = ["source_share", "suspicious", "source_share_x_suspicious"].map((name) => {
    const c = keyCoef[name] || {};
    return {
      coefName: name,
      coef: Number(c.coef || 0),
      stdErr: Number(c.stdErr || 0),
      ci95Low: Number(c.ci95Low || 0),
      ci95High: Number(c.ci95High || 0),
      tStat: Number(c.tStat || 0),
    };
  });
  renderSortableTable({
    tableId: "evidence-b-table",
    columns: [
      { key: "coefName", label: "ตัวแปร" },
      { key: "coef", label: "ค่าสัมประสิทธิ์", format: (v) => fmtPct(v, 2) },
      { key: "stdErr", label: "Std. Error", format: (v) => fmtPct(v, 2) },
      { key: "ci95Low", label: "CI95 ต่ำ", format: (v) => fmtPct(v, 2) },
      { key: "ci95High", label: "CI95 สูง", format: (v) => fmtPct(v, 2) },
      { key: "tStat", label: "t-stat", format: (v) => fmtNum(v, 3) },
    ],
    rows: coefRows,
    sortId: "evidence-b",
    defaultKey: "coefName",
    defaultDir: "asc",
    onSortChange: renderEvidence,
  });

  const evBSummary = document.getElementById("evidence-b-summary");
  const b3Pct = Number(keyCoef?.source_share_x_suspicious?.coef || 0) * 100;
  const b3Low = Number(keyCoef?.source_share_x_suspicious?.ci95Low || 0) * 100;
  const b3High = Number(keyCoef?.source_share_x_suspicious?.ci95High || 0) * 100;
  evBSummary.innerHTML =
    `อ่านแบบง่าย: โมเดลนี้พยายาม “คุมความต่างของจังหวัดและพรรคต้นทาง” ก่อนค่อยดูผล. ` +
    `ค่า interaction ตอนนี้อยู่ที่ ${fmtNum(b3Pct, 2)} จุดเปอร์เซ็นต์ (ช่วงประมาณ ${fmtNum(b3Low, 2)} ถึง ${fmtNum(b3High, 2)}). ` +
    `ถ้าช่วงคร่อมศูนย์ แปลว่ายังสรุปเชิงเด็ดขาดไม่ได้ แต่ใช้เป็นหลักฐานประกอบกับส่วนอื่นได้`;

  renderKpis("evidence-c-kpis", [
    { label: "รอบสุ่ม Placebo", value: fmtNum(evidence?.definition?.placeboRounds || 0) },
    { label: "ค่า effect จริง", value: fmtPct(evC.realInteractionEffect || 0, 2) },
    { label: "ค่าเฉลี่ย effect โลกสุ่ม", value: fmtPct(evC.placeboMean || 0, 2) },
    { label: "Empirical p-value (สองด้าน)", value: fmtNum(evC.empiricalPValueTwoSided || 0, 4) },
  ]);

  Plotly.newPlot(
    "evidence-c-hist",
    [
      {
        type: "histogram",
        x: (evC.placeboEffects || []).map((v) => Number(v || 0) * 100),
        marker: { color: "#94d2bd" },
        nbinsx: 45,
        name: "โลกสุ่ม (placebo)",
      },
    ],
    {
      title: "การกระจาย effect จากการสุ่มเลขผู้สมัคร (Placebo)",
      margin: { t: 50, r: 16, b: 54, l: 66 },
      xaxis: { title: "interaction effect (%)" },
      yaxis: { title: "ความถี่" },
      shapes: [
        {
          type: "line",
          x0: Number(evC.realInteractionEffect || 0) * 100,
          x1: Number(evC.realInteractionEffect || 0) * 100,
          y0: 0,
          y1: 1,
          yref: "paper",
          line: { color: "#bb3e03", width: 3 },
        },
      ],
      annotations: [
        {
          x: Number(evC.realInteractionEffect || 0) * 100,
          y: 1,
          yref: "paper",
          text: "ค่า effect จริง",
          showarrow: false,
          xanchor: "left",
          font: { color: "#bb3e03" },
        },
      ],
    },
    { responsive: true }
  );

  const evCSummary = document.getElementById("evidence-c-summary");
  const pval = Number(evC.empiricalPValueTwoSided || 0);
  evCSummary.innerHTML =
    `อ่านแบบง่าย: เราจำลองโลกสุ่ม ${fmtNum(evidence?.definition?.placeboRounds || 0)} รอบแล้วถามว่า “ได้ผลแรงเท่าของจริงบ่อยแค่ไหน”. ` +
    `คำตอบคือ p-value = ${fmtNum(pval, 4)} ซึ่งหมายถึง ${describePValue(pval)}.`;

  const people = evD.peopleParty || {};
  renderKpis("evidence-d-kpis", [
    { label: "จำนวนเขตน่าสงสัยที่ใช้เทียบ", value: fmtNum(evD.suspiciousAreas || 0) },
    { label: "จำนวนแถวจับคู่ในเขตน่าสงสัย", value: fmtNum(evD.suspiciousRows || 0) },
    { label: "อันดับพรรคประชาชน (normalized)", value: people?.rankByNormalizedEffect ? `อันดับ ${fmtNum(people.rankByNormalizedEffect)}` : "ไม่พบ" },
    { label: "Normalized ของพรรคประชาชน", value: people ? fmtPct(people.normalizedEffect || 0, 2) : "-" },
  ]);

  const suspiciousOnly = modelRows.filter((r) => r.isSuspicious);
  const heatMapAgg = new Map();
  for (const r of suspiciousOnly) {
    const key = `${r.provinceCode}__${r.sourcePartyCode}`;
    if (!heatMapAgg.has(key)) {
      heatMapAgg.set(key, {
        provinceName: r.provinceName,
        sourcePartyName: r.sourcePartyName,
        smallVotes: 0,
        sourceVotes: 0,
      });
    }
    const x = heatMapAgg.get(key);
    x.smallVotes += Number(r.smallPartyVotes || 0);
    x.sourceVotes += Number(r.sourceConstituencyVotes || 0);
  }
  const heatRows = Array.from(heatMapAgg.values()).map((r) => ({
    provinceName: r.provinceName,
    sourcePartyName: r.sourcePartyName,
    value: r.sourceVotes > 0 ? (r.smallVotes / r.sourceVotes) * 100 : 0,
  }));
  const topParties = [...new Set((evD.rows || []).slice(0, 8).map((r) => r.sourcePartyName))];
  const provinces = [...new Set(heatRows.map((r) => r.provinceName))].sort((a, b) => String(a).localeCompare(String(b), "th"));
  const z = provinces.map((p) =>
    topParties.map((party) => {
      const found = heatRows.find((r) => r.provinceName === p && r.sourcePartyName === party);
      return found ? found.value : 0;
    })
  );

  Plotly.newPlot(
    "evidence-d-heatmap",
    [
      {
        type: "heatmap",
        x: topParties,
        y: provinces,
        z,
        colorscale: "YlOrRd",
        colorbar: { title: "Normalized (%)" },
      },
    ],
    {
      title: "Heatmap จังหวัด x พรรคต้นทาง (เขตน่าสงสัยเท่านั้น)",
      margin: { t: 50, r: 16, b: 120, l: 140 },
    },
    { responsive: true }
  );

  renderSortableTable({
    tableId: "evidence-d-table",
    columns: [
      { key: "rankByNormalizedEffect", label: "อันดับ" },
      { key: "sourcePartyNo", label: "หมายเลขพรรค" },
      { key: "sourcePartyName", label: "ชื่อพรรค" },
      { key: "relatedVotes", label: "คะแนนที่เกี่ยวข้อง", format: (v) => fmtNum(v) },
      { key: "sourceConstituencyVotesInMatchedAreas", label: "คะแนน สส.เขต (เฉพาะเขตชน)", format: (v) => fmtNum(v) },
      { key: "normalizedEffect", label: "Normalized", format: (v) => fmtPct(v, 2) },
      { key: "winsInSuspiciousAreas", label: "จำนวนเขตน่าสงสัยที่ชนะ", format: (v) => fmtNum(v) },
      { key: "areaCount", label: "จำนวนเขตที่เกี่ยวข้อง", format: (v) => fmtNum(v) },
      { key: "rows", label: "จำนวนแถว", format: (v) => fmtNum(v) },
    ],
    rows: evD.rows || [],
    sortId: "evidence-d",
    defaultKey: "normalizedEffect",
    onSortChange: renderEvidence,
  });

  const evDSummary = document.getElementById("evidence-d-summary");
  const topD = (evD.rows || [])[0];
  evDSummary.innerHTML =
    `อ่านแบบง่าย: ในกลุ่มเขตน่าสงสัย พรรคที่มีค่า normalized สูงสุดตอนนี้คือ ` +
    `${escapeHtml(topD ? `พรรคเบอร์ ${topD.sourcePartyNo} ${topD.sourcePartyName}` : "ไม่พบ")} ` +
    `ส่วนพรรคประชาชนอยู่${people?.rankByNormalizedEffect ? `อันดับ ${fmtNum(people.rankByNormalizedEffect)}` : "ในกลุ่มที่ยังไม่เด่น"} ` +
    `ของตารางนี้ (เปรียบเทียบเฉพาะเขตน่าสงสัยชุดเดียวกันเท่านั้น)`;
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
        candidatePartyNo: candidate.candidatePartyNo,
        candidatePartyName: candidate.candidatePartyName,
        candidateName: candidate.candidateName,
        sourcePartyWonArea: candidate.candidatePartyCode === winnerPartyCode,
        sourceConstituencyVotesInArea,
        sourceConstituencyShareInArea: constituencyTotalVotes > 0 ? sourceConstituencyVotesInArea / constituencyTotalVotes : 0,
      });
    }
  }
  if (state.originWinnerOnly) {
    rows = rows.filter((r) => r.sourcePartyWonArea);
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

function refreshOriginSmallPartyFilter() {
  const smallPartySel = document.getElementById("origin-small-party-filter");
  if (!smallPartySel) return;

  const eligible = getH1Rows()
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
  const top = rows.slice(0, state.originTopN);
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
        marker: { color: "#9b2226" },
      },
    ],
    {
      title:
        state.originSmallPartyCode === "ALL"
          ? `คะแนนที่คาดว่าเกิดจากการกาเลขเดียวกัน แยกตามพรรคต้นทาง (Top ${state.originTopN})`
          : `พรรคเล็กเบอร์ ${selectedSmallPartyNo ?? "?"} ${selectedSmallParty || ""}: คะแนนที่คาดว่าโยงจากพรรคต้นทาง (Top ${state.originTopN})`,
      margin: { t: 50, r: 14, b: 120, l: 70 },
      yaxis: { title: "คะแนนที่คาดว่าไหลจากการกาเลขเดียวกัน (เสียง)" },
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
    relationTraces.push({
      type: "scatter",
      mode: "markers",
      name: `เบอร์ ${g.sourcePartyNo ?? "?"} ${g.sourcePartyName || "ไม่ทราบ"}`,
      x: xs,
      y: ys,
      text: g.points.map((p) => `${p.provinceName} | ${p.areaName}`),
      hovertemplate: "%{text}<br>โอกาสชนะเขต (proxy): %{x:.2f}%<br>คะแนนพรรคเล็ก: %{y:.2f}%<extra></extra>",
      marker: { size: 8, opacity: 0.75 },
    });
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
      title: "ความสัมพันธ์รายเขต: โอกาสชนะเขต (proxy) vs คะแนนพรรคเล็ก",
      margin: { t: 50, r: 14, b: 58, l: 70 },
      xaxis: { title: "โอกาสชนะเขต (proxy จากสัดส่วนคะแนน สส.เขตของพรรคต้นทาง, %)" },
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
      { key: "avgWinChanceProxy", label: "โอกาสชนะเขตเฉลี่ย (proxy)", format: (v) => `${fmtNum(v, 2)}%` },
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
      { key: "normalizedByConstituency", label: "สัดส่วน Normalize", format: (v) => fmtPct(v, 3) },
      { key: "shareOfProxyVotes", label: "สัดส่วนต่อทั้งหมด", format: (v) => fmtPct(v, 2) },
      { key: "areaCount", label: "จำนวนเขตที่พบ", format: (v) => fmtNum(v) },
      { key: "rows", label: "จำนวนแถวที่จับคู่ได้", format: (v) => fmtNum(v) },
    ],
    rows: top,
    sortId: "origin-source",
    defaultKey: "proxyVotes",
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
    `เมื่อไล่จากพรรคเล็กที่เลือก พบว่าพรรคต้นทางอันดับ 1 คือ ` +
    `พรรคเบอร์ ${top1.sourcePartyNo ?? "?"} ${escapeHtml(top1.sourcePartyName || "ไม่ทราบ")} ` +
    `มีคะแนนที่เกี่ยวข้อง ${fmtNum(top1.proxyVotes)} เสียง ` +
    `คิดเป็น ${fmtPct(top1.shareOfProxyVotes, 2)} ของคะแนนในกลุ่มนี้ ` +
    `(รวมทั้งหมด ${fmtNum(totalProxyVotes)} เสียง จาก ${fmtNum(areaRows.length)} แถวเขต${state.originWinnerOnly ? " เฉพาะเขตที่พรรคต้นทางชนะ" : ""})`;
}

function setupControls() {
  document.getElementById("range-min").addEventListener("change", (e) => {
    state.rangeMin = Math.max(1, Math.min(99, Number(e.target.value || 1)));
    renderHypothesis1();
    renderHotspots();
    refreshOriginSmallPartyFilter();
    renderOriginAnalysis();
  });
  document.getElementById("range-max").addEventListener("change", (e) => {
    state.rangeMax = Math.max(1, Math.min(99, Number(e.target.value || 10)));
    renderHypothesis1();
    renderHotspots();
    refreshOriginSmallPartyFilter();
    renderOriginAnalysis();
  });
  document.getElementById("exclude-top").addEventListener("change", (e) => {
    state.excludeTop = Math.max(0, Math.min(10, Number(e.target.value || 6)));
    renderHypothesis1();
    renderHotspots();
    refreshOriginSmallPartyFilter();
    renderOriginAnalysis();
  });

  document.getElementById("hotspot-topn-input").addEventListener("change", (e) => {
    state.hotspotTopN = Math.max(10, Math.min(100, Number(e.target.value || 30)));
    e.target.value = String(state.hotspotTopN);
    renderHotspots();
  });

  const provinceSel = document.getElementById("origin-province-filter");
  const provinces = ["ALL", ...new Set((state.data?.areas || []).map((a) => a.provinceName).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "th")
  );
  provinceSel.innerHTML = provinces.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p === "ALL" ? "ทุกจังหวัด" : p)}</option>`).join("");
  provinceSel.addEventListener("change", (e) => {
    state.originProvince = e.target.value;
    renderOriginAnalysis();
  });

  const smallPartySel = document.getElementById("origin-small-party-filter");
  smallPartySel.addEventListener("change", (e) => {
    state.originSmallPartyCode = e.target.value;
    renderOriginAnalysis();
  });

  document.getElementById("origin-topn-input").addEventListener("change", (e) => {
    state.originTopN = Math.max(4, Math.min(30, Number(e.target.value || 4)));
    e.target.value = String(state.originTopN);
    renderOriginAnalysis();
  });

  document.getElementById("origin-winner-only").addEventListener("change", (e) => {
    state.originWinnerOnly = Boolean(e.target.checked);
    renderOriginAnalysis();
  });
}

function initHypothesisText() {
  const txt = `
## สมมติฐานที่ใช้ในรอบแรก
1. ระบบบัตรเลือกตั้ง 2 ใบ อาจทำให้พรรคเบอร์ต้นๆบางพรรคได้คะแนนบัญชีรายชื่อเพิ่ม
2. การโฟกัสที่เบอร์ผู้สมัครแบบแบ่งเขต อาจทำให้มีการกาเลขเดียวกันทั้ง 2 ใบ
3. หากเลขผู้สมัครตรงเลขพรรค อาจเกิดคะแนนบัญชีรายชื่อเพิ่มจากพฤติกรรมการกาแบบเดียวกัน

หมายเหตุ: รอบนี้ยังไม่ฟันธงเชิงเหตุและผล เป็นการดูรูปแบบข้อมูลตั้งต้นก่อน
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
  renderHypothesis1();
  renderHotspots();
  renderEvidence();
  refreshOriginSmallPartyFilter();
  renderOriginAnalysis();
  setupTocActive();
}

init().catch((err) => {
  console.error(err);
  alert("โหลดข้อมูลหน้า dashboard ไม่สำเร็จ");
});
