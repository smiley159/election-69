#!/usr/bin/env python3
"""Normalize election-66.xlsx into district-party rows without external xlsx deps."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def normalize_text(s: str | None) -> str:
    if s is None:
        return ""
    return str(s).strip().replace("\u200b", "")


def normalize_province(name: str, aliases: dict[str, str]) -> str:
    x = normalize_text(name)
    x = re.sub(r"\s+", "", x)
    return aliases.get(x, x)


def normalize_party_name(name: str) -> str:
    x = normalize_text(name)
    x = re.sub(r"\s+", "", x)
    x = x.replace("(มหาชน)", "")
    return x


def col_to_idx(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    v = 0
    for ch in letters:
        v = v * 26 + (ord(ch.upper()) - ord("A") + 1)
    return v - 1


def to_int(value: str | None) -> int | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def to_float(value: str | None) -> float | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_xlsx_sheet_rows(xlsx_path: Path, sheet_name: str | None = None):
    ns = {"x": NS_MAIN}
    with zipfile.ZipFile(xlsx_path) as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sst = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sst.findall("x:si", ns):
                txt = "".join((t.text or "") for t in si.findall(".//x:t", ns))
                shared_strings.append(txt)

        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {
            r.attrib.get("Id"): r.attrib.get("Target")
            for r in rels.findall(f"{{{NS_PKG_REL}}}Relationship")
        }

        sheet_elem = None
        for s in wb.findall("x:sheets/x:sheet", ns):
            if sheet_name is None or s.attrib.get("name") == sheet_name:
                sheet_elem = s
                break
        if sheet_elem is None:
            raise RuntimeError("sheet not found")

        rid = sheet_elem.attrib.get(f"{{{NS_REL}}}id")
        target = rel_map.get(rid)
        if not target:
            raise RuntimeError("worksheet relationship missing")

        ws_path = "xl/" + target
        ws = ET.fromstring(zf.read(ws_path))

        def read_cell(c):
            ctype = c.attrib.get("t")
            if ctype == "inlineStr":
                t = c.find("x:is/x:t", ns)
                return t.text if t is not None else ""
            v = c.find("x:v", ns)
            if v is None:
                return ""
            raw = v.text or ""
            if ctype == "s":
                idx = int(raw)
                return shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
            return raw

        for row in ws.findall("x:sheetData/x:row", ns):
            cells = row.findall("x:c", ns)
            if not cells:
                continue
            values_by_idx = {}
            max_idx = 0
            for c in cells:
                ref = c.attrib.get("r", "")
                idx = col_to_idx(ref)
                values_by_idx[idx] = read_cell(c)
                max_idx = max(max_idx, idx)
            yield [values_by_idx.get(i, "") for i in range(max_idx + 1)]


def main() -> int:
    ap = argparse.ArgumentParser(description="Normalize election-66.xlsx")
    ap.add_argument("--input", default="election-66.xlsx")
    ap.add_argument("--sheet", default="Sheet1")
    ap.add_argument("--province-aliases", default="config/province-aliases.json")
    ap.add_argument("--out", default="data/normalized/election66_normalized.json")
    args = ap.parse_args()

    aliases = json.loads(Path(args.province_aliases).read_text(encoding="utf-8")) if Path(args.province_aliases).exists() else {}

    rows_iter = parse_xlsx_sheet_rows(Path(args.input), args.sheet)
    header_raw = next(rows_iter)
    headers = [normalize_text(h) for h in header_raw]

    # drop leading index blank if present
    if headers and headers[0] == "":
        headers = headers[1:]
        trim_first = True
    else:
        trim_first = False

    norm_rows = []
    for row in rows_iter:
        if trim_first and row:
            row = row[1:]

        rec = {headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))}

        province = normalize_province(rec.get("province_name", ""), aliases)
        cons_id = normalize_text(rec.get("cons_id", ""))
        m = re.search(r"_(\d+)$", cons_id)
        district_no = int(m.group(1)) if m else None

        party_name_raw = normalize_text(rec.get("party_name", ""))

        constituency_votes = to_int(rec.get("zone_vote")) or 0
        partylist_votes = to_int(rec.get("party_list_vote")) or 0

        out = {
            "election_year": 66,
            "source_sheet": args.sheet,
            "province_name_raw": normalize_text(rec.get("province_name", "")),
            "province_name_norm": province,
            "district_no": district_no,
            "district_key": f"{province}__{district_no}" if province and district_no is not None else None,
            "cons_id_raw": cons_id,
            "party_name_raw": party_name_raw,
            "party_name_norm": normalize_party_name(party_name_raw),
            "party_no_raw": to_int(rec.get("party_no")),
            "party_id_raw": normalize_text(rec.get("party_id", "")),
            "candidate_no": to_int(rec.get("no")),
            "candidate_id_raw": normalize_text(rec.get("mp_app_id", "")),
            "constituency_votes": constituency_votes,
            "partylist_votes": partylist_votes,
            "constituency_rank": to_int(rec.get("mp_app_rank")),
            "partylist_rank": None,
            "constituency_total_votes": None,
            "partylist_total_votes": None,
            "constituency_share": None,
            "partylist_share": None,
            "gap_raw": None,
            "gap_rank_shift": None,
        }

        norm_rows.append(out)

    # Fill district totals + shares + gaps from available rows in same district
    by_district = {}
    for r in norm_rows:
        key = r["district_key"]
        if not key:
            continue
        if key not in by_district:
            by_district[key] = {"const": 0, "plist": 0}
        by_district[key]["const"] += r["constituency_votes"]
        by_district[key]["plist"] += r["partylist_votes"]

    for r in norm_rows:
        key = r["district_key"]
        if not key or key not in by_district:
            continue
        c_total = by_district[key]["const"]
        p_total = by_district[key]["plist"]
        r["constituency_total_votes"] = c_total
        r["partylist_total_votes"] = p_total
        r["constituency_share"] = (r["constituency_votes"] / c_total) if c_total else 0.0
        r["partylist_share"] = (r["partylist_votes"] / p_total) if p_total else 0.0
        r["gap_raw"] = r["constituency_share"] - r["partylist_share"]
        c_rank = r.get("constituency_rank")
        p_rank = r.get("partylist_rank")
        r["gap_rank_shift"] = ((c_rank if c_rank is not None else 999) - (p_rank if p_rank is not None else 999))

    out = {
        "meta": {
            "source": str(args.input),
            "sheet": args.sheet,
            "row_count": len(norm_rows),
            "district_count": len({r["district_key"] for r in norm_rows if r.get("district_key")}),
        },
        "rows": norm_rows,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path} rows={len(norm_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
