#!/usr/bin/env python3
import argparse
import glob
import json
from collections import defaultdict
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def mean(vals):
    return sum(vals) / len(vals) if vals else 0.0


def std(vals):
    if not vals:
        return 0.0
    m = mean(vals)
    var = sum((x - m) ** 2 for x in vals) / len(vals)
    return var ** 0.5


def quantile(values, q):
    if not values:
        return 0.0
    arr = sorted(values)
    if q <= 0:
        return arr[0]
    if q >= 1:
        return arr[-1]
    pos = (len(arr) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(arr) - 1)
    frac = pos - lo
    return arr[lo] * (1 - frac) + arr[hi] * frac


def main():
    ap = argparse.ArgumentParser(description='Build constituency vs party-list gap analysis')
    ap.add_argument('--common', default='common-data.json')
    ap.add_argument('--parties', default='party-data.json')
    ap.add_argument('--const-dir', default='area-constituency')
    ap.add_argument('--plist-dir', default='area-candidates')
    ap.add_argument('--out-features', default='analysis_features.json')
    ap.add_argument('--out-summary', default='analysis_summary.json')
    ap.add_argument('--out-tests', default='hypothesis_tests.json')
    args = ap.parse_args()

    common = load_json(Path(args.common))
    parties = load_json(Path(args.parties))['parties']

    areas = {a['code']: a for a in common['areas']}
    provinces = {p['code']: p for p in common['provinces']}
    party_by_code = {p['code']: p for p in parties}

    const_files = sorted(glob.glob(f"{args.const_dir}/AREA-*.json"))
    plist_files = sorted(glob.glob(f"{args.plist_dir}/AREA-*.json"))
    plist_map = {Path(p).stem: p for p in plist_files}

    features = []
    winner_rows = []

    for cf in const_files:
        c = load_json(Path(cf))
        area_code = c['areaCode']
        stem = Path(cf).stem
        if stem not in plist_map:
            continue
        p = load_json(Path(plist_map[stem]))

        area_meta = areas.get(area_code, {})
        prov_code = area_meta.get('provinceCode')
        prov_name = provinces.get(prov_code, {}).get('name')

        c_total = c.get('totalVotes') or 0
        p_total = p.get('totalVotes') or 0

        c_by_party = {e['partyCode']: e for e in c.get('entries', [])}
        p_by_party = {e['partyCode']: e for e in p.get('entries', [])}
        party_codes = sorted(set(c_by_party) | set(p_by_party))

        winner = None
        for e in c.get('entries', []):
            if e.get('rank') == 1:
                winner = e
                break

        winner_party = winner.get('partyCode') if winner else None
        winner_const_share = (winner.get('voteTotal', 0) / c_total) if (winner and c_total) else 0
        winner_plist_share = (p_by_party.get(winner_party, {}).get('voteTotal', 0) / p_total) if (winner_party and p_total) else 0
        winner_gap = winner_const_share - winner_plist_share

        for pc in party_codes:
            ce = c_by_party.get(pc, {})
            pe = p_by_party.get(pc, {})
            c_votes = ce.get('voteTotal', 0)
            p_votes = pe.get('voteTotal', 0)
            c_share = (c_votes / c_total) if c_total else 0
            p_share = (p_votes / p_total) if p_total else 0
            c_rank = ce.get('rank')
            p_rank = pe.get('rank')

            pr = party_by_code.get(pc, {})
            row = {
                'area_code': area_code,
                'area_name': area_meta.get('name'),
                'province_code': prov_code,
                'province_name': prov_name,
                'party_code': pc,
                'party_no': pr.get('number'),
                'party_name': pr.get('name'),
                'constituency_votes': c_votes,
                'partylist_votes': p_votes,
                'constituency_total_votes': c_total,
                'partylist_total_votes': p_total,
                'constituency_share': c_share,
                'partylist_share': p_share,
                'gap_raw': c_share - p_share,
                'constituency_rank': c_rank,
                'partylist_rank': p_rank,
                'gap_rank_shift': ((c_rank or 999) - (p_rank or 999)),
                'winner_gap': winner_gap,
                'winner_party_code': winner_party,
                'is_constituency_winner_party': pc == winner_party,
                'win66_party_code': area_meta.get('win66PartyCode'),
                'is_same_as_win66': pc == area_meta.get('win66PartyCode'),
            }
            features.append(row)

        winner_rows.append({
            'area_code': area_code,
            'area_name': area_meta.get('name'),
            'province_name': prov_name,
            'winner_party_code': winner_party,
            'winner_gap': winner_gap,
            'winner_constituency_share': winner_const_share,
            'winner_partylist_share': winner_plist_share,
            'is_same_as_win66': winner_party == area_meta.get('win66PartyCode'),
        })

    # residual by (province,party)
    gp = defaultdict(list)
    for r in features:
        gp[(r['province_code'], r['party_code'])].append(r['gap_raw'])

    gp_mean = {k: mean(v) for k, v in gp.items()}
    gp_std = {k: std(v) for k, v in gp.items()}

    for r in features:
        k = (r['province_code'], r['party_code'])
        m = gp_mean.get(k, 0)
        s = gp_std.get(k, 0)
        resid = r['gap_raw'] - m
        r['residual_score'] = resid
        r['residual_zscore'] = (resid / s) if s > 1e-12 else 0.0

    # anomaly threshold top 3% by absolute residual zscore
    absz = [abs(r['residual_zscore']) for r in features]
    z_thr = quantile(absz, 0.97)
    anomaly_rows = [r for r in features if abs(r['residual_zscore']) >= z_thr]

    # party summary
    by_party = defaultdict(lambda: {
        'party_code': None,
        'party_no': None,
        'party_name': None,
        'rows': 0,
        'mean_gap_raw': 0.0,
        'sum_gap_raw': 0.0,
        'anomaly_rows': 0,
        'winner_count': 0,
    })
    for r in features:
        d = by_party[r['party_code']]
        d['party_code'] = r['party_code']
        d['party_no'] = r['party_no']
        d['party_name'] = r['party_name']
        d['rows'] += 1
        d['sum_gap_raw'] += r['gap_raw']
        if r['is_constituency_winner_party']:
            d['winner_count'] += 1

    an_set = {(r['area_code'], r['party_code']) for r in anomaly_rows}
    for r in features:
        if (r['area_code'], r['party_code']) in an_set:
            by_party[r['party_code']]['anomaly_rows'] += 1

    party_summary = []
    for d in by_party.values():
        d['mean_gap_raw'] = d['sum_gap_raw'] / d['rows'] if d['rows'] else 0
        d['anomaly_ratio'] = d['anomaly_rows'] / d['rows'] if d['rows'] else 0
        party_summary.append(d)

    party_summary.sort(key=lambda x: x['anomaly_ratio'], reverse=True)

    winner_gaps = [w['winner_gap'] for w in winner_rows]
    wg_thr = quantile(winner_gaps, 0.97)
    winner_gap_watchlist = sorted([w for w in winner_rows if w['winner_gap'] >= wg_thr], key=lambda x: x['winner_gap'], reverse=True)

    summary = {
        'counts': {
            'areas': len({r['area_code'] for r in features}),
            'rows': len(features),
            'anomaly_rows': len(anomaly_rows),
            'winner_rows': len(winner_rows),
        },
        'thresholds': {
            'residual_abs_z_top3pct': z_thr,
            'winner_gap_top3pct': wg_thr,
        },
        'top_party_by_anomaly_ratio': party_summary[:20],
        'winner_gap_watchlist': winner_gap_watchlist[:100],
        'notes': [
            'gap_raw = constituency_share - partylist_share',
            'residual_zscore computed within (province, party)',
            'anomaly uses top 3% absolute residual z-score',
        ],
    }

    tests = {
        'tests': [
            {
                'name': 'winner_gap_positive_rate',
                'description': 'สัดส่วนเขตที่ winner_gap > 0 (ผู้ชนะเขตได้ share แบ่งเขตมากกว่า share บัญชีรายชื่อของพรรคเดียวกัน)',
                'effect_size': (sum(1 for w in winner_rows if w['winner_gap'] > 0) / len(winner_rows)) if winner_rows else 0,
                'ci': None,
                'p_value': None,
                'decision': 'exploratory_only',
            },
            {
                'name': 'anomaly_ratio_party_ranking',
                'description': 'จัดอันดับพรรคตาม anomaly ratio จาก residual z-score',
                'effect_size': None,
                'ci': None,
                'p_value': None,
                'decision': 'ranking_only',
            },
        ]
    }

    Path(args.out_features).write_text(json.dumps({'rows': features}, ensure_ascii=False), encoding='utf-8')
    Path(args.out_summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    Path(args.out_tests).write_text(json.dumps(tests, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f"rows={len(features)} areas={len({r['area_code'] for r in features})} anomaly_rows={len(anomaly_rows)}")
    print(f"wrote {args.out_features} {args.out_summary} {args.out_tests}")


if __name__ == '__main__':
    main()
