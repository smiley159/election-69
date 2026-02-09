#!/usr/bin/env python3
import glob
import json
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st


st.set_page_config(page_title="Election69 Dashboard", layout="wide")


@st.cache_data(show_spinner=False)
def load_data(base_dir: str = "."):
    base = Path(base_dir)

    common = json.loads((base / "common-data.json").read_text(encoding="utf-8"))
    parties = json.loads((base / "party-data.json").read_text(encoding="utf-8"))["parties"]
    candidates = json.loads((base / "candidate-data.json").read_text(encoding="utf-8"))["candidates"]

    summary_path = base / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else None

    area_meta = pd.DataFrame(common["areas"])[["code", "name", "number", "provinceCode"]].rename(
        columns={"code": "areaCode", "name": "areaName", "number": "areaNo"}
    )
    province_df = pd.DataFrame(common["provinces"])[["code", "name"]].rename(
        columns={"code": "provinceCode", "name": "provinceName"}
    )
    area_meta = area_meta.merge(province_df, on="provinceCode", how="left")

    party_df = pd.DataFrame(parties)[["code", "number", "name", "colorPrimary"]].rename(
        columns={"code": "partyCode", "number": "partyNo", "name": "partyName", "colorPrimary": "partyColor"}
    )

    rows = []
    for fp in glob.glob(str(base / "area-candidates" / "AREA-*.json")):
        d = json.loads(Path(fp).read_text(encoding="utf-8"))
        for e in d.get("entries", []):
            rows.append(
                {
                    "areaCode": d.get("areaCode"),
                    "partyCode": e.get("partyCode"),
                    "voteTotal": e.get("voteTotal") or 0,
                    "votePercent": e.get("votePercent") or 0,
                    "rank": e.get("rank"),
                    "totalVotes": d.get("totalVotes") or 0,
                    "goodVotes": d.get("goodVotes") or 0,
                    "badVotes": d.get("badVotes") or 0,
                    "noVotes": d.get("noVotes") or 0,
                    "voteProgressPercent": d.get("voteProgressPercent"),
                }
            )

    votes = pd.DataFrame(rows)
    votes = votes.merge(party_df, on="partyCode", how="left").merge(area_meta, on="areaCode", how="left")

    cand = pd.DataFrame(candidates)[
        ["areaCode", "partyCode", "number", "prefix", "specialPrefix", "firstName", "lastName"]
    ].rename(columns={"number": "candidateNo", "partyCode": "candidatePartyCode"})
    cand = cand.merge(
        party_df[["partyCode", "partyNo", "partyName"]].rename(
            columns={"partyCode": "candidatePartyCode", "partyNo": "candidatePartyNo", "partyName": "candidatePartyName"}
        ),
        on="candidatePartyCode",
        how="left",
    )
    cand["candidateName"] = (
        cand["prefix"].fillna("")
        + cand["specialPrefix"].fillna("")
        + cand["firstName"].fillna("")
        + " "
        + cand["lastName"].fillna("")
    ).str.strip()

    return votes, cand, party_df, area_meta, summary


def build_alignment(votes: pd.DataFrame, cand: pd.DataFrame, min_no: int, max_no: int, base_party_nos: list[int]):
    small_rows = votes[(votes["partyNo"] >= min_no) & (votes["partyNo"] <= max_no)].copy()
    small_rows = small_rows.rename(
        columns={
            "partyCode": "smallPartyCode",
            "partyNo": "smallPartyNo",
            "partyName": "smallPartyName",
            "voteTotal": "smallPartyVotes",
            "votePercent": "smallPartyVotePercent",
        }
    )

    aligned = small_rows.merge(
        cand[["areaCode", "candidateNo", "candidatePartyCode", "candidatePartyNo", "candidatePartyName", "candidateName"]],
        left_on=["areaCode", "smallPartyNo"],
        right_on=["areaCode", "candidateNo"],
        how="left",
    )

    if base_party_nos:
        aligned = aligned[aligned["candidatePartyNo"].isin(base_party_nos)]

    aligned["isMatched"] = aligned["candidatePartyCode"].notna()
    return aligned


votes, cand, party_df, area_meta, summary = load_data()

st.title("Election 69 Interactive Dashboard")
st.caption("Data source in workspace: area-candidates + common/party/candidate/summary JSON")

with st.sidebar:
    st.header("Filters")
    provinces = ["ทั้งหมด"] + sorted(votes["provinceName"].dropna().unique().tolist())
    selected_province = st.selectbox("จังหวัด", provinces, index=0)

    min_party_no = int(party_df["partyNo"].min())
    max_party_no = int(party_df["partyNo"].max())
    party_range = st.slider("ช่วงหมายเลขพรรคที่ใช้วิเคราะห์ alignment", min_value=min_party_no, max_value=max_party_no, value=(1, 9))

    default_base = [7, 9, 22, 26, 29, 31, 37]
    available = sorted(party_df["partyNo"].dropna().astype(int).unique().tolist())
    default_base = [x for x in default_base if x in available]
    selected_base = st.multiselect("พรรคฐาน (พรรคที่ต้องการดูว่าเลขไปชนผู้สมัครของพรรคนี้ไหม)", options=available, default=default_base)


filtered_votes = votes.copy()
if selected_province != "ทั้งหมด":
    filtered_votes = filtered_votes[filtered_votes["provinceName"] == selected_province]

area_count = filtered_votes["areaCode"].nunique()
party_count = filtered_votes["partyCode"].nunique()

col1, col2, col3, col4 = st.columns(4)
col1.metric("เขตที่อยู่ในตัวกรอง", f"{area_count:,}")
col2.metric("จำนวนพรรค", f"{party_count:,}")
col3.metric("คะแนนรวม (party-list)", f"{int(filtered_votes[['areaCode','totalVotes']].drop_duplicates()['totalVotes'].sum()):,}")
col4.metric("คะแนนดีรวม", f"{int(filtered_votes[['areaCode','goodVotes']].drop_duplicates()['goodVotes'].sum()):,}")

if summary is not None:
    with st.expander("Summary check"):
        st.write(
            {
                "lastUpdatedAt": summary.get("lastUpdatedAt"),
                "voteProgressPercent": summary.get("voteProgressPercent"),
                "statisticsPartyList": summary.get("statisticsPartyList", {}),
            }
        )


tab1, tab2, tab3 = st.tabs(["ภาพรวมประเทศ/จังหวัด", "เจาะรายเขต", "วิเคราะห์เลขชน (alignment)"])

with tab1:
    top_n = st.slider("Top N พรรค", 5, 30, 15)
    party_agg = (
        filtered_votes.groupby(["partyCode", "partyNo", "partyName"], as_index=False)["voteTotal"].sum().sort_values("voteTotal", ascending=False)
    )
    party_agg["share"] = party_agg["voteTotal"] / party_agg["voteTotal"].sum()

    fig_top = px.bar(
        party_agg.head(top_n),
        x="partyName",
        y="voteTotal",
        color="partyName",
        text="voteTotal",
        title=f"Top {top_n} พรรคตามคะแนนรวม",
    )
    fig_top.update_layout(showlegend=False, xaxis_title="พรรค", yaxis_title="คะแนน")
    st.plotly_chart(fig_top, use_container_width=True)

    province_agg = (
        filtered_votes[["provinceName", "areaCode", "totalVotes", "goodVotes", "badVotes", "noVotes"]]
        .drop_duplicates()
        .groupby("provinceName", as_index=False)
        .sum(numeric_only=True)
        .sort_values("totalVotes", ascending=False)
    )
    st.dataframe(province_agg, use_container_width=True, hide_index=True)

with tab2:
    area_list_df = filtered_votes[["areaCode", "areaName", "provinceName"]].drop_duplicates().sort_values(["provinceName", "areaCode"])
    area_label_map = {f"{r.provinceName} | {r.areaName} ({r.areaCode})": r.areaCode for r in area_list_df.itertuples()}
    selected_area_label = st.selectbox("เลือกเขต", options=list(area_label_map.keys()))
    selected_area = area_label_map[selected_area_label]

    area_party = (
        filtered_votes[filtered_votes["areaCode"] == selected_area][["partyNo", "partyName", "voteTotal", "votePercent", "rank"]]
        .sort_values("rank")
        .reset_index(drop=True)
    )

    fig_area = px.bar(area_party.head(20), x="partyName", y="voteTotal", color="partyName", title="ผลคะแนนรายพรรคในเขต (Top 20)")
    fig_area.update_layout(showlegend=False, xaxis_title="พรรค", yaxis_title="คะแนน")
    st.plotly_chart(fig_area, use_container_width=True)

    st.dataframe(area_party, use_container_width=True, hide_index=True)

    area_cand = (
        cand[cand["areaCode"] == selected_area][["candidateNo", "candidatePartyNo", "candidatePartyName", "candidateName"]]
        .sort_values("candidateNo")
        .reset_index(drop=True)
    )
    st.write("ผู้สมัครในเขต")
    st.dataframe(area_cand, use_container_width=True, hide_index=True)

with tab3:
    aligned = build_alignment(filtered_votes, cand, party_range[0], party_range[1], selected_base)

    st.caption(
        "แต่ละแถว = คะแนนพรรคในช่วงหมายเลขที่เลือก (small-party proxy) ต่อ 1 เขต แล้วดูว่าเบอร์นั้นไปตรงกับผู้สมัครพรรคไหน"
    )

    c1, c2, c3 = st.columns(3)
    c1.metric("จำนวนแถวที่วิเคราะห์", f"{len(aligned):,}")
    c2.metric("match rate", f"{aligned['isMatched'].mean() * 100:.2f}%")
    c3.metric("คะแนน proxy รวม", f"{int(aligned['smallPartyVotes'].sum()):,}")

    by_matched_party = (
        aligned.groupby(["candidatePartyCode", "candidatePartyNo", "candidatePartyName"], dropna=False, as_index=False)
        .agg(totalProxyVotes=("smallPartyVotes", "sum"), districts=("areaCode", "nunique"), rows=("areaCode", "count"))
        .sort_values("totalProxyVotes", ascending=False)
    )
    by_matched_party["share"] = by_matched_party["totalProxyVotes"] / by_matched_party["totalProxyVotes"].sum()

    fig_align = px.bar(
        by_matched_party.head(20),
        x="candidatePartyName",
        y="totalProxyVotes",
        color="candidatePartyName",
        title="คะแนน proxy ที่ map ไปยังพรรคของผู้สมัคร (Top 20)",
        text="totalProxyVotes",
    )
    fig_align.update_layout(showlegend=False, xaxis_title="พรรคที่เลขชน", yaxis_title="คะแนน proxy")
    st.plotly_chart(fig_align, use_container_width=True)

    st.dataframe(by_matched_party, use_container_width=True, hide_index=True)

    st.write("Top outlier เขตที่มีคะแนน proxy สูง")
    outlier = (
        aligned[["provinceName", "areaName", "areaCode", "smallPartyNo", "smallPartyName", "smallPartyVotes", "candidatePartyName", "candidateNo"]]
        .sort_values("smallPartyVotes", ascending=False)
        .head(200)
    )
    st.dataframe(outlier, use_container_width=True, hide_index=True)

st.markdown("---")
st.caption("Run: streamlit run dashboard_app.py")
