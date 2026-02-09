#!/usr/bin/env python3
"""Normalize election 69 constituency + party-list JSON into district-party rows."""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_text(s: str | None) -> str:
    return "" if s is None else str(s).strip().replace("\u200b", "")


def normalize_province(name: str, aliases: dict[str, str]) -> str:
    x = normalize_text(name)
    x = "".join(x.split())
    return aliases.get(x, x)


def normalize_party_name(name: str) -> str:
    x = normalize_text(name)
    x = "".join(x.split())
    x = x.replace("(มหาชน)", "")
    return x


def main() -> int:
    ap = argparse.ArgumentParser(description="Normalize election69 json files")
    ap.add_argument("--common", default="common-data.json")
    ap.add_argument("--parties", default="party-data.json")
    ap.add_argument("--const-dir", default="area-constituency")
    ap.add_argument("--plist-dir", default="area-candidates")
    ap.add_argument("--province-aliases", default="config/province-aliases.json")
    ap.add_argument("--out", default="data/normalized/election69_normalized.json")
    args = ap.parse_args()

    aliases = json.loads(Path(args.province_aliases).read_text(encoding="utf-8")) if Path(args.province_aliases).exists() else {}

    common = load_json(Path(args.common))
    party_data = load_json(Path(args.parties))["parties"]

    parties_by_code = {p["code"]: p for p in party_data}
    areas_by_code = {a["code"]: a for a in common["areas"]}
    provinces_by_code = {p["code"]: p for p in common["provinces"]}

    plist_map = {Path(p).stem: p for p in glob.glob(f"{args.plist_dir}/AREA-*.json")}
    const_files = sorted(glob.glob(f"{args.const_dir}/AREA-*.json"))

    rows = []

    for cf in const_files:
        c = load_json(Path(cf))
        stem = Path(cf).stem
        if stem not in plist_map:
            continue
        p = load_json(Path(plist_map[stem]))

        area_code = c["areaCode"]
        area = areas_by_code.get(area_code, {})
        province = provinces_by_code.get(area.get("provinceCode"), {})
        province_norm = normalize_province(province.get("name", ""), aliases)
        district_no = area.get("number")

        c_total = c.get("totalVotes") or 0
        p_total = p.get("totalVotes") or 0

        c_by_party = {e.get("partyCode"): e for e in c.get("entries", [])}
        p_by_party = {e.get("partyCode"): e for e in p.get("entries", [])}

        party_codes = sorted(set(c_by_party) | set(p_by_party))

        for code in party_codes:
            ce = c_by_party.get(code, {})
            pe = p_by_party.get(code, {})
            party = parties_by_code.get(code, {})

            c_votes = ce.get("voteTotal", 0) or 0
            p_votes = pe.get("voteTotal", 0) or 0
            c_share = (c_votes / c_total) if c_total else 0.0
            p_share = (p_votes / p_total) if p_total else 0.0
            c_rank = ce.get("rank")
            p_rank = pe.get("rank")

            rows.append(
                {
                    "election_year": 69,
                    "province_name_raw": province.get("name"),
                    "province_name_norm": province_norm,
                    "district_no": district_no,
                    "district_key": f"{province_norm}__{district_no}" if province_norm and district_no is not None else None,
                    "area_code": area_code,
                    "party_key_69": code,
                    "party_name_raw": party.get("name"),
                    "party_name_norm": normalize_party_name(party.get("name", "")),
                    "party_no_raw": party.get("number"),
                    "party_id_raw": code,
                    "candidate_no": None,
                    "candidate_id_raw": ce.get("candidateCode"),
                    "constituency_votes": c_votes,
                    "partylist_votes": p_votes,
                    "constituency_rank": c_rank,
                    "partylist_rank": p_rank,
                    "constituency_total_votes": c_total,
                    "partylist_total_votes": p_total,
                    "constituency_share": c_share,
                    "partylist_share": p_share,
                    "gap_raw": c_share - p_share,
                    "gap_rank_shift": ((c_rank if c_rank is not None else 999) - (p_rank if p_rank is not None else 999)),
                    "district_match_confidence": "high",
                    "mapping_notes": "native_69",
                    "win66_party_code": area.get("win66PartyCode"),
                }
            )

    out = {
        "meta": {
            "source_const_dir": args.const_dir,
            "source_partylist_dir": args.plist_dir,
            "row_count": len(rows),
            "district_count": len({r["district_key"] for r in rows if r.get("district_key")}),
        },
        "rows": rows,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path} rows={len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
