(() => {
  "use strict";
  const app = document.getElementById("app");
  const cache = {};
  const ui = { q: "", state: "", party: "", ballot: false, sort: "state" };
  // Stock trades are paused: the Senate disclosure site blocks automated downloads from cloud servers.
  // Flip to true once trade data is loading again; all the trade views below are kept for that.
  const TRADES_ENABLED = false;
  const EFD = "https://efdsearch.senate.gov/search/";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pc = (p) => (p || "?")[0];
  const fmtPct = (v) => (v == null ? "—" : `${v}%`);
  const fmtMoney = (v) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
  const fmtDate = (d) => { if (!d) return "—"; const t = new Date(d + "T12:00:00"); return isNaN(t) ? esc(d) : t.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };
  const year = new Date().getFullYear();
  const ELECTION_YEAR = year % 2 === 0 ? year : year + 1;

  async function get(path) {
    if (!cache[path]) cache[path] = fetch(path, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(path); return r.json(); });
    return cache[path];
  }

  /* ---------- Shared pieces for the 2026-11 redesign ---------- */
  const PC = { D: "var(--dem)", R: "var(--rep)", I: "var(--ind)" };
  const watch = {
    all() { try { return (store.get("otr_watch") || "").split(",").filter(Boolean); } catch { return []; } },
    has(id) { return watch.all().includes(id); },
    toggle(id) { const a = watch.all(); const i = a.indexOf(id); i < 0 ? a.push(id) : a.splice(i, 1); store.set("otr_watch", a.join(",")); return i < 0; },
  };
  function spark(vals, color) {
    const v = (vals || []).filter((x) => x != null);
    if (v.length < 2) return `<svg class="spark" aria-hidden="true"></svg>`;
    const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
    const pts = vals.map((x, i) => (x == null ? null : [(i / (vals.length - 1)) * 96, 31 - ((x - lo) / r) * 28])).filter(Boolean);
    return `<svg class="spark" viewBox="0 0 96 34" preserveAspectRatio="none" aria-hidden="true"><path d="M${pts.map((q) => q.map((n) => n.toFixed(1)).join(",")).join("L")}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function srow(s, vals, pill, sub) {
    const p = pc(s.party);
    return `<a class="row p-${p}" href="#/s/${esc(s.bioguide)}">${photo(s)}
      <div style="min-width:0"><div class="nm">${esc(s.name)}</div><div class="sub">${sub || `${PARTY_NAME[p] || esc(s.party)} · ${esc(STATES[s.state] || s.state)}`}</div></div>
      ${spark(vals, PC[p] || "var(--faint)")}<span class="pill">${pill}</span></a>`;
  }
  // Line chart you can scrub: moving along it updates the big number, like a stock chart.
  function lineChart(el, labels, vals, color, onScrub) {
    const W = 800, H = 250, pad = 6;
    const pts = vals.map((v, i) => (v == null ? null : { i, v })).filter(Boolean);
    if (pts.length < 2) { el.innerHTML = `<div class="nodata">Not enough votes in this period to chart.</div>`; onScrub(null); return; }
    const lo = Math.min(...pts.map((q) => q.v)), hi = Math.max(...pts.map((q) => q.v));
    const span = Math.max(hi - lo, 4), y0 = lo - span * 0.15, y1 = hi + span * 0.15;
    const X = (i) => pad + (i / Math.max(1, vals.length - 1)) * (W - pad * 2);
    const Y = (v) => H - ((v - y0) / (y1 - y0)) * H;
    const d = pts.map((q, k) => `${k ? "L" : "M"}${X(q.i).toFixed(1)},${Y(q.v).toFixed(1)}`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chart">
      <line x1="0" x2="${W}" y1="${Y(pts[0].v)}" y2="${Y(pts[0].v)}" stroke="#2a2e35" stroke-width="1.5" stroke-dasharray="2 6" vector-effect="non-scaling-stroke"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <line class="xh" y1="0" y2="${H}" stroke="#3a3f47" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
      <circle class="dot" r="5" fill="${color}" stroke="#000" stroke-width="2" visibility="hidden"/></svg><div class="tip" hidden></div>`;
    const svg = el.querySelector("svg"), xh = svg.querySelector(".xh"), dot = svg.querySelector(".dot"), tip = el.querySelector(".tip");
    const move = (cx) => {
      const r = svg.getBoundingClientRect(), fx = ((cx - r.left) / r.width) * W;
      let b = pts[0]; for (const q of pts) if (Math.abs(X(q.i) - fx) < Math.abs(X(b.i) - fx)) b = q;
      xh.setAttribute("x1", X(b.i)); xh.setAttribute("x2", X(b.i)); xh.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(b.i)); dot.setAttribute("cy", Y(b.v)); dot.setAttribute("visibility", "visible");
      tip.hidden = false; tip.style.left = `${Math.min(92, Math.max(8, (X(b.i) / W) * 100))}%`; tip.textContent = labels[b.i];
      onScrub(b.v, labels[b.i]);
    };
    const leave = () => { xh.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; onScrub(null); };
    svg.addEventListener("pointermove", (e) => move(e.clientX));
    svg.addEventListener("pointerdown", (e) => move(e.clientX));
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") leave(); });
  }
  function nrow(i, names, parties = {}) {
    const k = KIND[i.kind];
    const who = (i.senators || []).slice(0, 3).map((id) => id.startsWith("elect:")
      ? `<a class="chip p-${parties[id] || "X"}" href="#/elections/${esc(id.slice(6))}">${esc(names[id] || id)} <span>elect</span></a>`
      : `<a class="chip p-${parties[id] || "X"}" href="#/s/${esc(id)}">${esc(names[id] || id)}</a>`).join("");
    return `<div class="nrow"><div class="src">${esc(k ? k[0] : i.source)} <span>· ${ago(i.published)}</span></div>
      <a class="hl" href="${esc(i.url)}" target="_blank" rel="noopener" style="display:block;color:inherit">${esc(i.title)}</a>${who ? `<div class="nwho">${who}</div>` : ""}</div>`;
  }
  // Stories per senator per day over the last week, from the news feed.
  function newsCounts(news, days = 7) {
    const out = {}, now = Date.now();
    for (const it of news.items) {
      const age = Math.floor((now - new Date(it.published)) / 864e5);
      if (age < 0 || age >= days) continue;
      for (const id of it.senators || []) { if (id.startsWith("elect:")) continue; (out[id] = out[id] || Array(days).fill(0))[days - 1 - age]++; }
    }
    return out;
  }
  const wkLabel = (iso) => `Week of ${new Date(iso + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  // Header search: jump to a senator or state.
  get("data/index.json").then((d) => {
    const dl = document.getElementById("gnames"), inp = document.getElementById("gsearch");
    if (!dl || !inp) return;
    dl.innerHTML = d.senators.map((x) => `<option value="${esc(x.name)}">${esc(STATES[x.state] || x.state)}</option>`).join("")
      + [...new Set(d.senators.map((x) => x.state))].map((st) => `<option value="${esc(STATES[st] || st)}">State</option>`).join("");
    const go = () => {
      const v = inp.value.trim().toLowerCase(); if (!v) return;
      const sen = d.senators.find((x) => x.name.toLowerCase() === v) || d.senators.find((x) => x.name.toLowerCase().includes(v));
      const st = Object.keys(STATES).find((k) => STATES[k].toLowerCase() === v || k.toLowerCase() === v);
      if (st) location.hash = `#/state/${st}`; else if (sen) location.hash = `#/s/${sen.bioguide}`;
      inp.value = ""; inp.blur();
    };
    inp.addEventListener("change", go);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }).catch(() => {});

  function nav(which) {
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === which));
    window.scrollTo(0, 0);
  }

  function photo(s) {
    const initials = esc((s.name || "").split(" ").filter((w) => /^[A-Z]/.test(w) && !w.endsWith(".")).map((w) => w[0]).slice(0, 1).join("") + (s.last || "")[0]);
    return `<div class="av"><img src="${esc(s.photo)}" alt="" loading="lazy"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'${initials}'}))"></div>`;
  }
  const PARTY_NAME = { D: "Democrat", R: "Republican", I: "Independent" };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  // First three ZIP digits -> state. Ranges from the USPS prefix table; a handful of ZIPs near
  // borders can fall in a neighboring state, so the state picker is always offered too.
  const ZIP_RANGES = [[5,5,"NY"],[10,27,"MA"],[28,29,"RI"],[30,38,"NH"],[39,49,"ME"],[50,54,"VT"],[55,55,"MA"],[56,59,"VT"],[60,69,"CT"],
    [70,89,"NJ"],[100,149,"NY"],[150,196,"PA"],[197,199,"DE"],[200,200,"DC"],[201,201,"VA"],[202,205,"DC"],[206,219,"MD"],[220,246,"VA"],
    [247,268,"WV"],[270,289,"NC"],[290,299,"SC"],[300,319,"GA"],[320,339,"FL"],[341,349,"FL"],[350,369,"AL"],[370,385,"TN"],[386,397,"MS"],
    [398,399,"GA"],[400,427,"KY"],[430,459,"OH"],[460,479,"IN"],[480,499,"MI"],[500,528,"IA"],[530,549,"WI"],[550,567,"MN"],[569,569,"DC"],
    [570,577,"SD"],[580,588,"ND"],[590,599,"MT"],[600,629,"IL"],[630,658,"MO"],[660,679,"KS"],[680,693,"NE"],[700,714,"LA"],[716,729,"AR"],
    [730,732,"OK"],[733,733,"TX"],[734,749,"OK"],[750,799,"TX"],[800,816,"CO"],[820,831,"WY"],[832,838,"ID"],[840,847,"UT"],[850,865,"AZ"],
    [870,884,"NM"],[885,885,"TX"],[889,898,"NV"],[900,961,"CA"],[967,968,"HI"],[970,979,"OR"],[980,994,"WA"],[995,999,"AK"]];
  const zipToState = (zip) => { const p = parseInt(String(zip).slice(0, 3), 10); const r = ZIP_RANGES.find(([a, b]) => p >= a && p <= b); return r ? r[2] : null; };

  function electionNote(e, name) {
    if (!e) return "";
    const by = e.called_by ? ` (called by ${esc(e.called_by)})` : "";
    const txt = {
      reelected: `Won re-election in ${e.year}${by}.`,
      lost: `Lost the ${e.year} election to ${esc(e.winner)}${by}. Serves until the new term begins in January.`,
      not_on_ballot: `Wasn't on the November ${e.year} ballot. ${esc(e.winner)} won the seat${by} and takes office in January.`,
      counting: `Up for election in ${e.year}. The race hasn't been called yet.`,
      not_running_counting: `Wasn't on the November ${e.year} ballot. The race for the seat hasn't been called yet.`,
    }[e.outcome];
    return txt ? `<a class="elect-note ${e.outcome}" href="#/elections/${esc(e.state)}"><span>${txt}</span><span class="go">See the race →</span></a>` : "";
  }
  const ELECTION_TAG = { reelected: ["Re-elected", "win"], lost: ["Lost in 2026", "lost"], not_on_ballot: ["Leaving in January", ""],
    counting: ["Race not called", ""], not_running_counting: ["Leaving in January", ""] };
  function electionTag(e) {
    const t = e && ELECTION_TAG[e.outcome];
    return t ? `<span class="tag ${t[1]}" style="margin-top:6px">${t[0]}</span>` : "";
  }

  /* ---------- Senate dashboard ---------- */
  const TILE = [["AK",0,0],["ME",11,0],["VT",10,1],["NH",11,1],["WA",1,2],["ID",2,2],["MT",3,2],["ND",4,2],["MN",5,2],["IL",6,2],["WI",7,2],["MI",8,2],["NY",9,2],["RI",10,2],["MA",11,2],
    ["OR",1,3],["NV",2,3],["WY",3,3],["SD",4,3],["IA",5,3],["IN",6,3],["OH",7,3],["PA",8,3],["NJ",9,3],["CT",10,3],["CA",1,4],["UT",2,4],["CO",3,4],["NE",4,4],["MO",5,4],["KY",6,4],
    ["WV",7,4],["VA",8,4],["MD",9,4],["DE",10,4],["AZ",2,5],["NM",3,5],["KS",4,5],["AR",5,5],["TN",6,5],["NC",7,5],["SC",8,5],["OK",4,6],["LA",5,6],["MS",6,6],["AL",7,6],["GA",8,6],
    ["HI",0,7],["TX",4,7],["FL",9,7]];
  const PCOLOR = { D: "var(--dem)", R: "var(--rep)", I: "var(--ind)", X: "var(--line-2)" };
  const PORDER = { D: 0, I: 1, X: 2, R: 3 };
  function seatLayout(n, rows, r0, r1, cx = 200, cy = 176) {
    const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
    const tot = radii.reduce((a, r) => a + r, 0);
    const per = radii.map((r) => Math.round((n * r) / tot));
    per[rows - 1] += n - per.reduce((a, b) => a + b, 0);
    const out = [];
    radii.forEach((r, k) => { const m = per[k]; for (let i = 0; i < m; i++) { const a = Math.PI - (Math.PI * i) / (m - 1); out.push({ x: cx + r * Math.cos(a), y: cy - r * Math.sin(a), a }); } });
    return out.sort((p, q) => q.a - p.a);
  }
  const SEATS = (() => {
    const out = [];
    [[14, 84], [17, 104], [20, 124], [23, 144], [26, 164]].forEach(([n, r]) => {
      for (let i = 0; i < n; i++) { const a = Math.PI - (Math.PI * i) / (n - 1); out.push({ x: 200 + r * Math.cos(a), y: 176 - r * Math.sin(a), a }); }
    });
    return out.sort((p, q) => q.a - p.a);
  })();
  const clip = (t, n = 150) => { t = String(t || ""); if (t.length <= n) return t; const c = t.slice(0, n); return c.slice(0, c.lastIndexOf(" ")).replace(/[,;:(]$/, "") + "…"; };
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const GROUPS = {
    state: { label: "State", key: (s) => [s.state], name: (k) => STATES[k] || k },
    party: { label: "Party", key: (s) => [s.party], name: (k) => `${k}s` },
    outcome: { label: "2026 election", key: (s) => [s.election ? s.election.outcome : "not_up"],
      name: (k) => ({ reelected: "Re-elected in 2026", lost: "Lost in 2026", not_on_ballot: "Leaving in January (weren't on the ballot)",
        counting: "Race not called yet", not_running_counting: "Leaving; race not called yet", not_up: "Seat not up in 2026" })[k] || k,
      order: ["reelected", "lost", "not_on_ballot", "counting", "not_running_counting", "not_up"] },
    next: { label: "Next election", key: (s) => [s.election ? "decided" : String(s.next_election)],
      name: (k) => (k === "decided" ? "Seat decided in 2026" : `Up in ${k}`), order: ["decided", "2028", "2030"] },
    committee: { label: "Committee", key: (s) => (s.committees.length ? s.committees : ["No committee listed"]), name: (k) => k },
  };

  async function senatePage() {
    nav("senate");
    const [data, dash, series] = await Promise.all([get("data/index.json"), get("data/dashboard.json").catch(() => null), get("data/series.json").catch(() => null)]);
    document.getElementById("updated").textContent = `Data updated ${new Date(data.updated).toLocaleString()}.`;
    const ss = data.senators;
    const states = [...new Set(ss.map((s) => s.state))].sort();
    const ui = senatePage.ui || (senatePage.ui = { q: "", group: "state", sort: "name", mode: "january" });

    app.innerHTML = `
      <p class="small"><a href="#/">← Congress</a></p>
      <div class="dash-title"><h1>The Senate</h1><p class="lede">Who holds every seat, what changes in January, and what senators promised. All from public records, each linked to its source. <a href="#/votes">Recent Senate votes →</a></p></div>
      ${finder(states, store.get("otr_state"))}
      ${dash ? `<div class="dash">
        <section class="panel chamber-panel">
          <div class="panel-top"><p class="ph">Chamber</p>
            <div class="segtg" id="cmode" role="group" aria-label="Chamber view">${[["now", "Now"], ["january", "January"], ["next", "Next election"], ["attendance", "Attendance"]]
              .map(([v, l]) => `<button type="button" data-v="${v}" class="${ui.mode === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
          <svg id="chamber" viewBox="0 0 400 214" role="img" aria-labelledby="ctitle"><title id="ctitle">Senate seats</title></svg>
          <div class="readout" id="readout"></div>
          <div class="clegend" id="clegend"></div>
        </section>
        <section class="panel promise-panel">${promisePanel(dash.promises)}</section>
        <section class="panel map-panel">
          <div class="panel-top"><p class="ph">By state</p><span class="muted small">Tap a state to compare its senators</span></div>
          <div class="tilemap" id="tilemap"></div>
          <div class="clegend"><span><i style="background:var(--dem)"></i>Democrat</span><span><i style="background:var(--rep)"></i>Republican</span><span><i style="background:var(--ind)"></i>Independent</span><span><i class="flipdot"></i>Seat changes party in January</span></div>
        </section>
        <section class="panel insight-panel"><p class="ph">Insights</p>
          <ol class="insights">${dash.insights.map((x) => `<li>${x.href ? `<a class="ins" href="${esc(x.href)}"><span>${md(x.text)}</span></a>` : `<div class="ins"><span>${md(x.text)}</span></div>`}</li>`).join("")}</ol>
          <p class="muted small" style="margin:8px 0 0">Calculated automatically from the data on this site.</p>
        </section>
        <section class="panel news-panel" id="newspanel" hidden></section>
      </div>` : ""}
      <div class="list-head" id="all"><h2>All senators</h2>
        <div class="controls">
          <input id="q" type="search" placeholder="Search by name, state or committee" value="${esc(ui.q)}" aria-label="Search senators">
          <label class="ctl">Group by <select id="grp">${Object.entries(GROUPS).map(([k, g]) => `<option value="${k}" ${k === ui.group ? "selected" : ""}>${g.label}</option>`).join("")}</select></label>
          <label class="ctl">Sort <select id="so">${[["name", "Name"], ["attendance", "Lowest attendance"], ["unity_low", "Least party-line voting"], ["raised", "Most money raised"]]
            .map(([v, l]) => `<option value="${v}" ${v === ui.sort ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
      </div>
      <div id="groups"></div>`;

    bindFinder();
    if (dash) {
      drawChamber(dash, ss, ui);
      document.querySelectorAll("#cmode button").forEach((b) => b.addEventListener("click", () => {
        ui.mode = b.dataset.v; document.querySelectorAll("#cmode button").forEach((x) => x.classList.toggle("on", x === b)); drawChamber(dash, ss, ui);
      }));
      drawTiles(ss, dash);
      get("data/news.json").then((n) => {
        const el = document.getElementById("newspanel");
        if (!el || !n.items.length) return;
        el.hidden = false;
        el.innerHTML = `<div class="panel-top"><p class="ph">Latest</p><a class="small" href="#/news">All news →</a></div>
          <ul class="newslist">${n.items.slice(0, 8).map((i) => newsItem(i, n.names, n.parties)).join("")}</ul>
          <p class="muted small" style="margin:8px 0 0">Headlines from ${n.sources.length} outlets across the spectrum, plus official Senate and Congress.gov actions. Checked four times a day.</p>`;
      }).catch(() => {});
    }

    // Each row: sparkline and value of whatever the list is sorted by (attendance by default).
    const card = (s) => {
      const ser = series && series.senators[s.bioguide];
      if (ui.sort === "unity_low") return srow(s, ser ? ser.unity.slice(-26) : [], fmtPct(s.metrics.party_unity));
      if (ui.sort === "raised") return srow(s, [], fmtMoney(s.metrics.raised));
      return srow(s, ser ? ser.attendance.slice(-26) : [], fmtPct(s.metrics.attendance));
    };
    const render = () => {
      const q = ui.q.toLowerCase().trim();
      const list = ss.filter((s) => !q || s.name.toLowerCase().includes(q) || s.state.toLowerCase() === q ||
        (STATES[s.state] || "").toLowerCase().includes(q) || s.committees.join(" ").toLowerCase().includes(q));
      const sorters = {
        name: (a, b) => a.last.localeCompare(b.last),
        attendance: (a, b) => (a.metrics.attendance ?? 101) - (b.metrics.attendance ?? 101),
        unity_low: (a, b) => (a.metrics.party_unity ?? 101) - (b.metrics.party_unity ?? 101),
        raised: (a, b) => (b.metrics.raised ?? -1) - (a.metrics.raised ?? -1),
      };
      const G = GROUPS[ui.group];
      const buckets = {};
      list.forEach((s) => G.key(s).forEach((k) => (buckets[k] = buckets[k] || []).push(s)));
      const keys = Object.keys(buckets).sort((a, b) => (G.order ? G.order.indexOf(a) - G.order.indexOf(b) : G.name(a).localeCompare(G.name(b))));
      document.getElementById("groups").innerHTML = keys.map((k) => `
        <section class="group"><div class="group-head"><h3>${esc(G.name(k))}</h3><span class="muted small">${buckets[k].length}</span>
          ${ui.group === "state" ? `<a class="small" href="#/state/${esc(k)}">Compare side by side →</a>` : ""}</div>
          <div>${buckets[k].sort(sorters[ui.sort]).map(card).join("")}</div></section>`).join("")
        || `<div class="empty">No senators match "${esc(ui.q)}".</div>`;
    };
    document.getElementById("q").addEventListener("input", (e) => { ui.q = e.target.value; render(); });
    document.getElementById("grp").addEventListener("change", (e) => { ui.group = e.target.value; render(); });
    document.getElementById("so").addEventListener("change", (e) => { ui.sort = e.target.value; render(); });
    render();
  }

  /* ---------- Home: Congress at a glance ---------- */
  const HOUSE_SEATS = seatLayout(435, 11, 72, 168);
  function miniChamber(seats, layout, r, center, sub) {
    const order = seats.slice().sort((a, b) => PORDER[a.p] - PORDER[b.p] || (a.st || "").localeCompare(b.st || ""));
    return `<svg viewBox="0 0 400 214" class="mini-ch" role="img" aria-label="${esc(sub)}"><title>${esc(sub)}</title>
      <line x1="200" y1="0" x2="200" y2="40" stroke="var(--gold)" stroke-dasharray="2 3" stroke-width="1.2"></line>
      ${order.map((s, i) => `<circle cx="${layout[i].x.toFixed(1)}" cy="${layout[i].y.toFixed(1)}" r="${r}" fill="${PCOLOR[s.p] || "var(--line-2)"}"${s.new ? ` stroke="var(--gold)" stroke-width="1.4"` : ""}></circle>`).join("")}
      <text x="200" y="186" text-anchor="middle" class="ch-num">${esc(center)}</text>
      <text x="200" y="205" text-anchor="middle" class="ch-sub">${esc(sub)}</text></svg>`;
  }

  async function home() {
    nav("home");
    const [data, dash, issues, promises, news, series, votesR] = await Promise.all([get("data/index.json"), get("data/dashboard.json").catch(() => null),
      get("data/issues_index.json").catch(() => ({ issues: [] })), get("data/promises.json").catch(() => ({ promises: [] })), get("data/news.json").catch(() => null),
      get("data/series.json").catch(() => null), get("data/votes_recent.json").catch(() => ({ votes: [] }))]);
    document.getElementById("updated").textContent = `Data updated ${new Date(data.updated).toLocaleString()}.`;
    const states = [...new Set(data.senators.map((s) => s.state))].sort();
    const ui = home.ui || (home.ui = { metric: "attendance" });
    const who = Object.fromEntries(data.senators.map((s) => [s.bioguide, s]));
    const RES = { kept: "Kept", broken: "Broken", compromise: "Compromise", stalled: "Stalled", in_progress: "In progress" };
    const recent = promises.promises.filter((p) => RES[p.status] && who[p.bioguide] && (p.evidence || []).length)
      .map((p) => ({ p, d: p.evidence.map((e) => e.date).sort().pop() })).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 4);
    const j = dash ? dash.count_jan : null, n = dash ? dash.count_now : null;
    const flips = dash ? dash.january.filter((x) => x.flip).length : 0;
    const mySt = store.get("otr_state");
    const mine = mySt ? data.senators.filter((s) => s.state === mySt) : [];
    const watched = watch.all().map((id) => who[id]).filter(Boolean);
    const nc = news ? newsCounts(news) : {};
    const total = (id) => (nc[id] || []).reduce((a, x) => a + x, 0);
    const movers = Object.keys(nc).filter((id) => who[id]).sort((a, b) => total(b) - total(a)).slice(0, 5).map((id) => who[id]);
    const tick = news ? news.items.slice(0, 8) : [];
    const kept = dash && dash.promises ? dash.promises.kept : null;

    app.innerHTML = `
      ${tick.length ? `<div class="ticker tickbar" id="ticker" role="region" aria-roledescription="carousel" aria-label="Latest headlines">
        <a class="tk-label" href="#/news">Latest</a>
        <div class="tk-body" id="tkbody" aria-live="off"></div>
        <div class="tk-ctl"><span class="tk-count" id="tkcount"></span>
          <button type="button" id="tkprev" aria-label="Previous headline">‹</button>
          <button type="button" id="tkplay" aria-label="Pause headlines">❚❚</button>
          <button type="button" id="tknext" aria-label="Next headline">›</button></div></div>` : ""}
      <div class="page"><div style="min-width:0">
        ${j ? `<div class="eyebrow">Senate in January</div>
          <div class="big"><span style="color:var(--dem)">${j.D}</span> <span style="color:var(--faint)">–</span> <span style="color:var(--rep)">${j.R}</span></div>
          <div class="delta"><b>${flips} seats</b> change party after the election${j.X ? ` · ${j.X} ${j.X === 1 ? "race" : "races"} still counting` : ""} · <a href="#/elections">Results</a></div>
          <div class="jbar" role="img" aria-label="${j.D} Democrats, ${j.I} independents, ${j.X || 0} not called, ${j.R} Republicans"><span style="flex:${j.D};background:var(--dem)"></span><span style="flex:${j.I};background:var(--ind)"></span>${j.X ? `<span style="flex:${j.X};background:var(--line-2)"></span>` : ""}<span style="flex:${j.R};background:var(--rep)"></span></div>
          <div class="jlegend"><span><i style="background:var(--dem)"></i>${j.D} Democrats</span><span><i style="background:var(--ind)"></i>${j.I} Independents</span>${j.X ? `<span><i style="background:var(--line-2)"></i>${j.X} not called</span>` : ""}<span><i style="background:var(--rep)"></i>${j.R} Republicans</span><span style="color:var(--faint)">Today: ${n.D} D · ${n.I} I · ${n.R} R</span></div>` : ""}

        <section class="blk"><div class="sh"><h2>${mySt ? `Your senators` : "Find your senators"}</h2>
          ${mine.length ? `<span class="segtg" id="hmetric">${[["attendance", "Attendance"], ["unity", "With party"]].map(([k, l]) => `<button type="button" data-m="${k}" class="${ui.metric === k ? "on" : ""}">${l}</button>`).join("")}</span>` : ""}</div>
          ${mine.length ? `<div id="mine"></div><p class="small muted" style="margin:10px 0 0">${esc(STATES[mySt])} · <a href="#/state/${mySt}">Compare side by side</a> · <a href="#" id="chst">Change state</a></p>` : zipForm(states)}</section>

        <section class="blk"><div class="sh"><h2>Watchlist</h2>${watched.length ? `<span class="muted small">${watched.length} following</span>` : ""}</div>
          ${watched.length ? watched.map((s) => srow(s, series && series.senators[s.bioguide] ? series.senators[s.bioguide].attendance.slice(-26) : [], fmtPct(s.metrics.attendance), `${PARTY_NAME[pc(s.party)]} · ${esc(STATES[s.state])} · attendance`)).join("")
            : `<div class="empty">Tap <b>Follow</b> on any senator's page to track them here. <a href="#/senate">Browse senators</a></div>`}</section>

        ${movers.length ? `<section class="blk"><div class="sh"><h2>Most in the news</h2><a class="more" href="#/news">All news</a></div>
          ${movers.map((s) => srow(s, nc[s.bioguide], `${total(s.bioguide)} ${total(s.bioguide) === 1 ? "story" : "stories"}`, "This week")).join("")}</section>` : ""}

        ${recent.length ? `<section class="blk"><div class="sh"><h2>Promise updates</h2><a class="more" href="#/promises">All promises</a></div>
          ${recent.map(({ p, d }) => `<a class="prow" href="#/s/${p.bioguide}"><div><div class="t">${esc(p.promise || "")}</div>
            <div class="d">${esc(who[p.bioguide].name)} (${pc(who[p.bioguide].party)}-${esc(who[p.bioguide].state)}) · updated ${fmtDate(d)}</div></div><span class="status ${esc(p.status)}">${RES[p.status]}</span></a>`).join("")}</section>` : ""}

        ${news && news.items.length ? `<section class="blk"><div class="sh"><h2>News</h2><a class="more" href="#/news">See all</a></div>
          ${news.items.slice(0, 8).map((i) => nrow(i, news.names, news.parties)).join("")}</section>` : ""}

        ${issues.issues.length ? `<section class="blk"><div class="sh"><h2>Issues in focus</h2><a class="more" href="#/issues">All issues</a></div>
          ${issues.issues.map((i) => `<a class="prow" href="#/issue/${i.id}"><div><div class="t">${esc(i.title)}</div><div class="d">${esc(clip(i.summary, 110))}</div></div>
            <span class="pill ghost">${i.votes} votes</span></a>`).join("")}</section>` : ""}
      </div>
      <aside class="side">
        <div class="card lists"><h4>Lists</h4>
          ${mySt ? `<a href="#/state/${mySt}"><i>📍</i><span>${esc(STATES[mySt])}</span><small>${mine.length}</small></a>` : ""}
          <a href="#/senate"><i>🏛️</i><span>All senators</span><small>${data.senators.length}</small></a>
          <a href="#/elections"><i>🔁</i><span>Seats that flip</span><small>${flips}</small></a>
          <a href="#/promises/kept"><i>✅</i><span>Promises kept</span><small>${kept ?? ""}</small></a>
          <a href="#/promises"><i>📝</i><span>All promises</span><small>${promises.promises.length}</small></a>
          <a href="#/issues"><i>⚖️</i><span>Issues</span><small>${issues.issues.length}</small></a>
        </div>
        ${votesR.votes.length ? `<div class="card"><h4>Latest Senate votes</h4><div class="vlist">${votesR.votes.slice(0, 5).map((v) => `<a href="${esc(v.source)}" target="_blank" rel="noopener">${esc(v.bill || v.question)}<span>${esc((v.result || "").replace(/\s*\(.*\)/, ""))} · ${v.counts ? `${v.counts.yeas}–${v.counts.nays}` : ""} · ${fmtDate(v.date)}</span></a>`).join("")}</div>
          <p class="small" style="margin:10px 0 0"><a href="#/votes">All recent votes</a></p></div>` : ""}
        <a class="card" href="#/house" style="color:var(--ink)"><h4>House of Representatives</h4><p class="muted small" style="margin:0">All 435 members are coming next, built the same way as the Senate.</p></a>
      </aside></div>`;

    if (tick.length) startTicker(tick, news);
    if (!mine.length) bindZip(() => home());
    else {
      const draw = () => {
        document.getElementById("mine").innerHTML = mine.map((s) => {
          const v = series && series.senators[s.bioguide] ? series.senators[s.bioguide][ui.metric].slice(-26) : [];
          return srow(s, v, fmtPct(ui.metric === "unity" ? s.metrics.party_unity : s.metrics.attendance));
        }).join("");
      };
      document.querySelectorAll("#hmetric button").forEach((b) => b.addEventListener("click", () => {
        ui.metric = b.dataset.m; document.querySelectorAll("#hmetric button").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
      document.getElementById("chst").addEventListener("click", (e) => { e.preventDefault(); store.set("otr_state", ""); home(); });
      draw();
    }
  }
  // Compact ZIP / state picker used on Home.
  function zipForm(states) {
    return `<form class="zip" id="zipf" autocomplete="off"><input id="zip" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="ZIP code" aria-label="ZIP code">
      <select id="fstate" aria-label="State" class="zsel"><option value="">or pick a state</option>${states.map((st) => `<option value="${st}">${esc(STATES[st] || st)}</option>`).join("")}</select>
      <button class="cta" type="submit" style="width:auto">Show my senators</button><p class="ferr small" id="ferr" role="alert"></p></form>`;
  }
  function bindZip(done) {
    const f = document.getElementById("zipf"); if (!f) return;
    const err = document.getElementById("ferr"), zip = document.getElementById("zip"), sel = document.getElementById("fstate");
    zip.addEventListener("input", () => { err.textContent = ""; zip.value = zip.value.replace(/\D/g, ""); });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      let st = sel.value; const z = zip.value.trim();
      if (z) {
        if (!/^\d{5}$/.test(z)) { err.textContent = "Enter a 5-digit ZIP code, or pick your state."; return; }
        const zs = zipToState(z);
        if (zs === "DC") { err.textContent = "Washington, D.C. doesn't have senators. Pick a state instead."; return; }
        if (!zs) { err.textContent = "That ZIP code isn't in one of the 50 states. Pick your state instead."; return; }
        st = zs;
      }
      if (!st) { err.textContent = "Enter your ZIP code or pick a state."; return; }
      store.set("otr_state", st); done(st);
    });
  }

  /* Rotating headline bar: one headline at a time, pauses on hover/focus and for reduced-motion users. */
  let tickTimer = null;
  function startTicker(items, news) {
    const body = document.getElementById("tkbody"), box = document.getElementById("ticker");
    const play = document.getElementById("tkplay");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0, paused = reduce, hover = false;
    const show = (n, announce) => {
      i = (n + items.length) % items.length;
      const it = items[i], k = KIND[it.kind];
      const who = (it.senators || []).slice(0, 2).map((id) => `<a class="chip p-${news.parties[id] || "X"}" href="${id.startsWith("elect:") ? `#/elections/${esc(id.slice(6))}` : `#/s/${esc(id)}`}">${esc((news.names[id] || id).split(" ").slice(-1)[0])}</a>`).join("");
      body.classList.remove("in"); void body.offsetWidth;
      body.innerHTML = `<span class="tk-src${k ? " off" : ""}">${esc(k ? k[0] : it.source)} · ${ago(it.published)}</span>
        <a class="tk-head" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>${who ? `<span class="tk-who">${who}</span>` : ""}`;
      body.classList.add("in");
      body.setAttribute("aria-live", announce ? "polite" : "off");
      document.getElementById("tkcount").textContent = `${i + 1}/${items.length}`;
    };
    const setPaused = (v) => {
      paused = v; play.textContent = paused ? "▶" : "❚❚";
      play.setAttribute("aria-label", paused ? "Play headlines" : "Pause headlines");
    };
    clearInterval(tickTimer);
    tickTimer = setInterval(() => { if (!paused && !hover && document.getElementById("ticker")) show(i + 1, false); }, 6500);
    box.addEventListener("mouseenter", () => (hover = true));
    box.addEventListener("mouseleave", () => (hover = false));
    box.addEventListener("focusin", () => (hover = true));
    box.addEventListener("focusout", () => (hover = false));
    document.getElementById("tkprev").addEventListener("click", () => { setPaused(true); show(i - 1, true); });
    document.getElementById("tknext").addEventListener("click", () => { setPaused(true); show(i + 1, true); });
    play.addEventListener("click", () => setPaused(!paused));
    setPaused(paused);
    show(0, false);
  }

  function housePage() {
    nav("house");
    app.innerHTML = `<p class="small"><a href="#/">← Congress</a></p>
      <div class="dash-title"><h1>The House of Representatives</h1><p class="lede">All 435 voting members, coming soon, built the same way as the Senate pages.</p></div>
      <section class="panel chamber-card soon" style="max-width:760px">
        ${miniChamber(Array.from({ length: 435 }, () => ({ p: "X" })), HOUSE_SEATS, 2.6, "435", "House of Representatives")}</section>
      <div class="prose" style="margin-top:20px"><h2>What's coming</h2><ul>
        <li><b>Every representative's profile:</b> votes, attendance, party-line voting, campaign money and committees.</li>
        <li><b>Promises and statements</b>, tracked and assessed the same way as for senators.</li>
        <li><b>Find your representative</b> by ZIP code or address, alongside your two senators.</li>
        <li><b>House results in the Elections page</b> and House votes on every Issues page.</li>
        <li><b>Stock trades:</b> House disclosures come from a different system than the Senate's, which may make it possible to bring trades back.</li>
      </ul><p><a href="#/senate">Explore the Senate in the meantime →</a></p></div>`;
  }

  function promisePanel(p) {
    const parts = [["kept", "Kept", "var(--good)"], ["compromise", "Compromise", "var(--gold)"], ["in_progress", "In progress", "var(--dem-ink)"], ["broken", "Broken or stalled", "var(--bad)"]];
    const graded = parts.reduce((t, [k]) => t + (p[k] || 0), 0);
    return `<p class="ph">Promises tracked</p>
      <div class="bignum">${p.tracked}</div>
      <p class="muted small" style="margin:0 0 12px">from ${p.senators} senators so far, plus ${p.statements} public statements</p>
      <div class="pstack" role="img" aria-label="${parts.map(([k, l]) => `${p[k] || 0} ${l.toLowerCase()}`).join(", ")}">
        ${parts.map(([k, l, c]) => (p[k] ? `<span style="flex:${p[k]};background:${c}" title="${l}: ${p[k]}"></span>` : "")).join("")}</div>
      <div class="pcounts">${parts.map(([k, l, c]) => `<div><i style="background:${c}"></i><span>${l}</span><b>${p[k] || 0}</b></div>`).join("")}</div>
      <p class="muted small" style="margin:10px 0 0">${graded} specific promises have a status. ${p.not_reviewed} general pledges aren't graded. Most promises so far come from senators' own posts, which tend to highlight pledges they kept.</p>
      <p style="margin:10px 0 0"><a class="small" href="#/promises">Browse every promise →</a></p>`;
  }

  function drawChamber(dash, ss, ui) {
    const svg = document.getElementById("chamber");
    const mode = ui.mode;
    const base = mode === "january" ? dash.january : dash.now;
    const seats = base.slice().sort((a, b) => PORDER[a.p] - PORDER[b.p] || (a.st || "").localeCompare(b.st || ""));
    const cnt = mode === "january" ? dash.count_jan : dash.count_now;
    const left = cnt.D + cnt.I, right = cnt.R;
    const atts = dash.now.map((s) => s.a).filter((x) => x != null).sort((a, b) => a - b);
    const lo = atts[0] ?? 80, median = atts.length ? atts[Math.floor(atts.length / 2)] : null;
    const cls = (c) => ({ 2026: "var(--gold)", 2028: "#8ea3c8", 2030: "#3c4b70" })[c] || "var(--line-2)";
    const yrs = dash.now.reduce((a, s) => ((a[s.c] = (a[s.c] || 0) + 1), a), {});
    const head = {
      now: [`${right} · ${left}`, "Republicans · Democrats + independents"],
      january: [`${left} · ${right}`, `Democrats + independents · Republicans${cnt.X ? ` · ${cnt.X} not called` : ""}`],
      next: [`${yrs[2028] || 0} · ${yrs[2030] || 0}`, `Seats up in 2028 · 2030 · ${yrs[2026] || 0} decided in 2026`],
      attendance: [median != null ? `${median}%` : "—", "Median attendance this Congress"],
    }[mode];
    let out = `<title id="ctitle">Senate seats: ${esc(head[1])}</title>
      <line x1="200" y1="0" x2="200" y2="40" stroke="var(--gold)" stroke-dasharray="2 3" stroke-width="1.2"></line>
      <text x="200" y="186" text-anchor="middle" class="ch-num">${esc(head[0])}</text>
      <text x="200" y="205" text-anchor="middle" class="ch-sub">${esc(head[1])}</text>`;
    seats.forEach((s, i) => {
      const p = SEATS[i];
      let fill = PCOLOR[s.p], op = 1, ring = "";
      if (mode === "next") fill = cls(s.c);
      if (mode === "attendance") op = s.a == null ? 0.2 : Math.max(0.18, Math.min(1, (s.a - lo) / (100 - lo || 1)));
      if (mode === "january" && s.new) ring = ` stroke="var(--gold)" stroke-width="1.6"`;
      out += `<circle class="seat" data-i="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5.2" fill="${fill}" fill-opacity="${op.toFixed(2)}"${ring}></circle>`;
    });
    svg.innerHTML = out;
    const legend = {
      now: [["var(--dem)", `Democrats ${cnt.D}`], ["var(--ind)", `Independents ${cnt.I}`], ["var(--rep)", `Republicans ${cnt.R}`]],
      january: [["var(--dem)", `Democrats ${cnt.D}`], ["var(--ind)", `Independents ${cnt.I}`], ["var(--line-2)", `Not called ${cnt.X}`], ["var(--rep)", `Republicans ${cnt.R}`], ["ring", "Newly elected"]],
      next: [["var(--gold)", "Decided in 2026"], ["#8ea3c8", "Up in 2028"], ["#3c4b70", "Up in 2030"]],
      attendance: [["fade", "Dimmer seats missed more votes"]],
    }[mode];
    document.getElementById("clegend").innerHTML = legend.map(([c, l]) => `<span><i class="${c === "ring" ? "ringdot" : c === "fade" ? "fadedot" : ""}" ${c.startsWith("var") || c.startsWith("#") ? `style="background:${c}"` : ""}></i>${esc(l)}</span>`).join("")
      + `<span><i class="majline"></i>51 for a majority</span>`;
    const readout = document.getElementById("readout");
    const idle = `<span class="muted">Hover or tap a seat to see who holds it.</span>`;
    readout.innerHTML = idle;
    const info = (s) => {
      const extra = mode === "attendance" ? ` · ${s.a != null ? `${s.a}% of votes cast` : "no vote data"}` : mode === "next" ? ` · ${s.c === 2026 ? "decided in 2026" : `up in ${s.c}`}`
        : s.uncalled ? "" : s.new ? " · newly elected" : "";
      return `<b>${esc(s.n)}</b> <span class="muted">${s.uncalled ? "" : `${PARTY_NAME[s.p] || ""} · `}${esc(STATES[s.st] || s.st)}${extra}</span>`;
    };
    svg.querySelectorAll(".seat").forEach((c) => {
      const s = seats[+c.dataset.i];
      c.addEventListener("mouseenter", () => { readout.innerHTML = info(s); });
      c.addEventListener("mouseleave", () => { readout.innerHTML = idle; });
      c.addEventListener("click", () => { location.hash = s.b ? `#/s/${s.b}` : `#/elections/${s.st}`; });
    });
  }

  function drawTiles(ss, dash) {
    const by = {};
    ss.forEach((s) => (by[s.state] = by[s.state] || []).push(s));
    const flips = new Set(dash.january.filter((x) => x.flip).map((x) => x.st));
    const el = document.getElementById("tilemap");
    let html = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
      const t = TILE.find((q) => q[1] === x && q[2] === y);
      if (!t) { html += `<span></span>`; continue; }
      const pair = (by[t[0]] || []).sort((a, b) => a.class - b.class);
      const desc = pair.map((s) => `${s.name} (${pc(s.party)})`).join(", ");
      html += `<a class="tile" href="#/state/${t[0]}" title="${esc(STATES[t[0]])}: ${esc(desc)}${flips.has(t[0]) ? ". A seat changes party in January." : ""}" aria-label="${esc(STATES[t[0]])}">
        ${pair.map((s) => `<span style="background:${PCOLOR[pc(s.party)] || PCOLOR.I}"></span>`).join("")}<b>${t[0]}</b>${flips.has(t[0]) ? `<i class="flipdot"></i>` : ""}</a>`;
    }
    el.innerHTML = html;
  }

  /* ---------- Senator profile ---------- */
  async function profile(id) {
    nav("senate");
    let s;
    try { s = await get(`data/senators/${id}.json`); } catch { app.innerHTML = `<div class="empty">Senator not found. <a href="#/senate">Back to all senators</a></div>`; return; }
    const [news, series] = await Promise.all([get("data/news.json").catch(() => null), get("data/series.json").catch(() => null)]);
    s._news = news;
    const m = s.metrics, p = pc(s.party), c = PC[p] || "var(--accent)";
    const ser = series && series.senators[id];
    const ui = profile.ui || (profile.ui = { metric: "attendance", range: "1Y" });
    const RANGE = { "1M": 5, "3M": 13, "6M": 26, "1Y": 52, ALL: 9999 };
    const LABEL = { attendance: "Attendance", unity: "Votes with own party" };
    const NOW = { attendance: m.attendance, unity: m.party_unity };
    const HOW = { attendance: "Share of roll-call votes they voted in", unity: "How often they voted with most of their party. Context, not good or bad" };
    const kstat = (k, v, h) => `<div class="kstat"><div class="k">${k}</div><div class="v">${v}</div>${h ? `<div class="h">${h}</div>` : ""}</div>`;
    const following = () => watch.has(id);

    app.innerHTML = `
      <div class="page" style="--c:${c}"><div style="min-width:0">
        <div class="who-head p-${p}">${photo(s)}<div><h1>${esc(s.name)}</h1>
          <div class="sub">${PARTY_NAME[p] || esc(s.party)}${s.caucus && s.caucus !== s.party ? ` (caucuses with ${esc(s.caucus)}s)` : ""} · ${esc(STATES[s.state] || s.state)} · Senator since ${new Date(s.serving_since + "T12:00").getFullYear()}</div></div></div>
        <div class="eyebrow" id="lbl"></div>
        <div class="big" id="num"></div>
        <div class="delta" id="dl"></div>
        <div class="chart" id="chart"></div>
        <div class="ranges">${Object.keys(RANGE).map((r) => `<button type="button" data-r="${r}" class="${r === ui.range ? "on" : ""}">${r}</button>`).join("")}<span class="sp"></span>
          <span class="segtg" id="pmetric">${[["attendance", "Attendance"], ["unity", "With party"]].map(([k, l]) => `<button type="button" data-m="${k}" class="${k === ui.metric ? "on" : ""}">${l}</button>`).join("")}</span></div>
        ${electionNote(s.election, s.name)}
        <section class="blk"><div class="sh"><h2>Key stats</h2></div><div class="kstats">
          ${kstat("Attendance", fmtPct(m.attendance), `${m.votes_eligible} votes this Congress`)}
          ${kstat("Votes with party", fmtPct(m.party_unity), "")}
          ${kstat("Promise follow-through", m.follow_through != null ? `${m.follow_through}%` : `— <small>needs 3 resolved</small>`, `${m.promises_tracked || 0} tracked · ${m.promises_resolved || 0} resolved`)}
          ${kstat("Bills sponsored", m.bills_sponsored != null ? `${m.bills_sponsored}` : "—", m.bills_sponsored != null ? `${m.bills_law} became law · ${m.bills_passed} passed a chamber` : "")}
          ${kstat("Raised this cycle", fmtMoney(m.raised), "FEC, candidate committee")}
          ${kstat("Next election", s.next_election, `Term ends ${new Date(s.term_end + "T12:00").getFullYear()}`)}
        </div></section>
        <div class="tabs" role="tablist">
          ${["Votes", "Bills", "In the news", "Promises", "Statements", "Campaign money", "Stock trades", "Committees"].map((t, i) => `<button role="tab" data-tab="${i}" class="${i === 0 ? "on" : ""}">${t}</button>`).join("")}
        </div>
        <div id="tab"></div>
      </div>
      <aside class="side">
        <div class="card">
          <button type="button" class="cta" id="follow"></button>
          ${s.phone ? `<a class="cta ghost" style="margin-top:10px" href="tel:${esc(s.phone)}">Call their office</a>` : ""}
          <div style="margin-top:14px">
            ${s.phone ? `<div class="kv"><span>Phone</span><b>${esc(s.phone)}</b></div>` : ""}
            <div class="kv"><span>Seat</span><b>${esc(s.rank ? s.rank[0].toUpperCase() + s.rank.slice(1) : "")} senator · Class ${esc(s.class)}</b></div>
            <div class="kv"><span>In office since</span><b>${fmtDate(s.serving_since)}</b></div>
            <div class="kv"><span>Term ends</span><b>${fmtDate(s.term_end)}</b></div>
          </div>
          <p class="small" style="margin:12px 0 0">${[s.website && `<a href="${esc(s.website)}">Official site</a>`, s.contact_form && `<a href="${esc(s.contact_form)}">Contact form</a>`, s.x_handle && `<a href="https://x.com/${esc(s.x_handle)}">@${esc(s.x_handle)}</a>`].filter(Boolean).join(" · ")}</p>
        </div>
        <div class="card"><h4>Committees</h4><div class="muted small" style="line-height:1.9">${(s.committees || []).map((x) => esc(x.name.replace("Senate Committee on ", "").replace("Committee on ", "").replace("Senate ", ""))).join("<br>") || "None listed"}</div></div>
        <a class="card" href="#/state/${esc(s.state)}" style="color:var(--ink)"><h4>Compare with the other ${esc(STATES[s.state] || s.state)} senator</h4><p class="small" style="margin:0;color:var(--accent)">Side by side →</p></a>
      </aside></div>`;

    const fb = document.getElementById("follow");
    const paintFollow = () => { fb.textContent = following() ? "✓ Following" : "＋ Follow"; fb.classList.toggle("on", following()); fb.setAttribute("aria-pressed", following()); };
    fb.addEventListener("click", () => { watch.toggle(id); paintFollow(); });
    paintFollow();

    const draw = () => {
      const n = Math.min(RANGE[ui.range], series ? series.weeks.length : 0);
      const vals = ser ? ser[ui.metric].slice(-n) : [], labels = series ? series.weeks.slice(-n).map(wkLabel) : [];
      const first = vals.find((v) => v != null), now = NOW[ui.metric];
      const set = (v, when) => {
        document.getElementById("lbl").textContent = LABEL[ui.metric];
        const shown = v ?? now;
        document.getElementById("num").textContent = shown == null ? "—" : `${Number(shown).toFixed(1)}%`;
        const ch = first != null && now != null ? now - first : null;
        const per = ui.range === "ALL" ? "this Congress" : `the past ${({ "1M": "month", "3M": "3 months", "6M": "6 months", "1Y": "year" })[ui.range]}`;
        document.getElementById("dl").innerHTML = when ? `Their last ${series.window} votes, as of the ${esc(when.toLowerCase())}`
          : `${ch != null ? `<b style="color:${c}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(1)} pts</b> over ${per} · ` : ""}${HOW[ui.metric]}. Chart shows a rolling ${series ? series.window : 40}-vote average.`;
      };
      lineChart(document.getElementById("chart"), labels, vals, c, set);
      set(null);
    };
    document.querySelectorAll(".ranges > button[data-r]").forEach((b) => b.addEventListener("click", () => {
      ui.range = b.dataset.r; document.querySelectorAll(".ranges > button[data-r]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
    document.querySelectorAll("#pmetric button").forEach((b) => b.addEventListener("click", () => {
      ui.metric = b.dataset.m; document.querySelectorAll("#pmetric button").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
    draw();

    const tabs = [votesTab, billsTab, newsTab, promisesTab, statementsTab, moneyTab, tradesTab, committeesTab];
    const show = (i) => { document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", +b.dataset.tab === i)); document.getElementById("tab").innerHTML = tabs[i](s); if (tabs[i].bind) tabs[i].bind(s); };
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(+b.dataset.tab)));
    show(0);
  }

  const POS = { Y: "Yes", N: "No", P: "Present", NV: "Didn't vote" };
  function voteRow(v) {
    return `<div class="vote-row"><div style="min-width:0"><div class="t">${v.bill ? `${esc(v.bill)} · ` : ""}${esc(clip(v.title || v.question, 140))}</div>
      <div class="d">${fmtDate(v.date)} · ${esc(v.question)} · ${esc(v.result)} · <a href="${esc(v.source)}">source</a></div>
      ${v.broke_with_party ? `<span class="flag break">Voted against most of their party</span>` : ""}
      ${v.summary ? `<details class="sum"><summary>What the bill does</summary><p>${esc(v.summary.text)} ${v.summary.url ? `<a href="${esc(v.summary.url)}">Congress.gov</a>` : ""}</p></details>` : ""}</div>
      <span class="vpill ${esc(v.position)}">${POS[v.position] || esc(v.position)}</span></div>`;
  }
  function votesTab(s) {
    if (!s.votes.length) return `<div class="empty">No votes loaded yet. They arrive with the first daily update.</div>`;
    return `<p class="muted small">Their most recent ${s.votes.length} roll-call votes. Where available, "What the bill does" is the Congressional Research Service's neutral summary.</p>
      <div id="vlist"></div>`;
  }
  votesTab.bind = (s) => {
    let n = 25;
    const draw = () => {
      document.getElementById("vlist").innerHTML = s.votes.slice(0, n).map(voteRow).join("")
        + (s.votes.length > n ? `<button class="btn more" id="vmore">Show more (${s.votes.length - n} left)</button>` : "");
      const m = document.getElementById("vmore"); if (m) m.onclick = () => { n += 25; draw(); };
    };
    draw();
  };

  function tradesTab(s) {
    if (!TRADES_ENABLED) return `<div class="empty">Stock trades aren't loaded into this site yet.<br>
      In the meantime, you can read ${esc(s.name)}'s filings directly on the Senate's official
      <a href="${EFD}">financial disclosure search</a>: accept the terms, enter the last name <b>${esc(s.last)}</b>,
      and pick "Periodic Transactions" as the report type.</div>`;
    const paper = s.paper_reports.length ? `<p class="muted small">${s.paper_reports.length} report(s) were filed on paper and can't be read automatically: ${s.paper_reports.slice(0, 10).map((r) => `<a href="${esc(r.url)}">${fmtDate(r.received)}</a>`).join(", ")}</p>` : "";
    if (!s.trades.length) return `<div class="empty">No electronically filed stock trades on record since 2023${s.metrics.trades === 0 && !s.paper_reports.length ? " (or trade data hasn't loaded yet)" : ""}.</div>${paper}`;
    return `<p class="muted small">Trades by the senator, spouse or dependents, from STOCK Act reports. Amounts are the ranges the law requires, not exact figures.</p>${paper}
      <div class="table-wrap"><table><thead><tr><th>Traded</th><th>Asset</th><th>Type</th><th>Amount</th><th>Owner</th><th>Reported</th></tr></thead><tbody>
      ${s.trades.map((t) => `<tr>
        <td>${fmtDate(t.date)}</td>
        <td>${t.ticker ? `<b>${esc(t.ticker)}</b> ` : ""}${esc(t.asset)}${t.industry ? `<div class="muted small">${esc(t.industry)}</div>` : ""}
          ${t.committee_overlap.map((c) => `<span class="flag overlap">Industry overseen by ${esc(c)}</span>`).join("")}</td>
        <td>${esc(t.type)}</td><td>${esc(t.amount)}</td><td>${esc(t.owner)}</td>
        <td>${fmtDate(t.received)}${t.late ? ` <span class="flag late">Late: ${t.days_to_report} days</span>` : ""} <a class="small" href="${esc(t.url)}">filing</a></td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function moneyTab(s) {
    const m = s.money;
    if (!m) return `<div class="empty">Campaign finance data hasn't loaded for this senator yet.</div>`;
    const rows = [["Total raised", m.receipts], ["From individuals", m.individual], ["From PACs and other committees", m.pacs], ["From party committees", m.party], ["Self-funded (incl. loans)", m.self_funded], ["Spent", m.disbursements], ["Cash on hand", m.cash_on_hand]];
    const sizes = m.sizes || [], stot = sizes.reduce((t, x) => t + (x.total || 0), 0);
    const SZC = ["#6ea3ff", "#8fb5ff", "#b6a6ff", "#e8c26e", "#f29b5c"];
    const small = sizes.find((x) => x.size === 0);
    const lp = m.leadership_pac, lc = s.lobby_contribs;
    return `<p class="muted small">Campaign committee totals for the ${m.cycle} election cycle (${esc(m.period)}). <a href="${esc(m.source)}">Full FEC record</a></p>
      <div class="grid money-grid">
        <div class="card"><h3>Totals</h3>${rows.map(([l, v]) => `<div class="money-row"><span>${l}</span><b>${fmtMoney(v)}</b></div>`).join("")}</div>
        ${stot ? `<div class="card"><h3>Donations by size</h3>
          <div class="bignum sm">${fmtPct(small ? Math.round((1000 * small.total) / stot) / 10 : null)}</div>
          <p class="muted small" style="margin:0 0 10px">from donations of $200 or less</p>
          <div class="pstack" role="img" aria-label="${sizes.map((x) => `${x.label}: ${Math.round((100 * x.total) / stot)}%`).join(", ")}">
            ${sizes.map((x, i) => `<span style="flex:${x.total};background:${SZC[i % SZC.length]}" title="${esc(x.label)}: ${fmtMoney(x.total)}"></span>`).join("")}</div>
          <div class="pcounts one">${sizes.map((x, i) => `<div><i style="background:${SZC[i % SZC.length]}"></i><span>${esc(x.label)}</span><b>${Math.round((100 * x.total) / stot)}%</b></div>`).join("")}</div>
          <p class="muted small" style="margin:10px 0 0">Donations from individuals to the campaign. Gifts of $200 or less aren't itemized, so they're counted together.</p></div>` : ""}
        ${m.in_state && m.in_state.pct != null ? `<div class="card"><h3>Where donors live</h3>
          <div class="bignum sm">${fmtPct(m.in_state.pct)}</div>
          <p class="muted small" style="margin:0 0 10px">of itemized donations came from ${esc(STATES[s.state] || s.state)}</p>
          ${(m.states || []).slice(0, 6).map((x) => `<div class="money-row"><span>${esc(STATES[x.state] || x.state)}${x.state === s.state ? ` <span class="tag">Home</span>` : ""}</span><b>${fmtMoney(x.total)}</b></div>`).join("")}
          <p class="muted small" style="margin:10px 0 0">Itemized donations (over $200) only, by the donor's address.</p></div>` : ""}
        <div class="card"><h3>Top donor employers</h3><p class="muted small">Itemized donations grouped by the employer donors listed. Reflects employees, not the companies themselves.</p>
          ${m.top_employers.length ? m.top_employers.map((e) => `<div class="money-row"><span>${esc(e.employer)}</span><b>${fmtMoney(e.total)}</b></div>`).join("") : `<p class="muted">None reported.</p>`}</div>
        ${lp ? `<div class="card"><h3>Leadership PAC</h3><p class="muted small">A second committee many senators run to raise money and give it to other candidates.</p>
          <p style="margin:6px 0"><b>${esc(lp.name || "")}</b></p>
          <div class="money-row"><span>Raised (${lp.cycle - 1}–${lp.cycle})</span><b>${fmtMoney(lp.receipts)}</b></div>
          <div class="money-row"><span>Spent</span><b>${fmtMoney(lp.disbursements)}</b></div>
          ${lp.to_candidates != null ? `<div class="money-row"><span>Given to candidates and committees</span><b>${fmtMoney(lp.to_candidates)}</b></div>` : ""}
          <p class="small" style="margin:8px 0 0"><a href="${esc(lp.source)}">FEC record</a></p></div>` : ""}
      </div>
      ${lc ? `<h3 style="margin-top:22px">Contributions reported by lobbyists</h3>
        <p class="muted small">Registered lobbyists and lobbying firms must report political contributions twice a year, including ones made to or in honor of members of Congress. These are what they reported for ${esc(s.name)} in ${(lc.years || []).join("–")}. Many also appear in the campaign totals above. A contribution shows a connection, not that any vote was influenced.</p>
        ${lc.count ? `<div class="grid money-grid">
          <div class="card"><div class="bignum sm">${fmtMoney(lc.total)}</div><p class="muted small" style="margin:0 0 8px">in ${lc.count} reported contribution${lc.count === 1 ? "" : "s"}</p>
            ${lc.top_firms.map((f) => `<div class="money-row"><span>${esc(f.name)}</span><b>${fmtMoney(f.total)}</b></div>`).join("")}</div>
          <div class="card" style="grid-column:span 2"><h3>Most recent</h3><div class="table-wrap flat"><table><thead><tr><th>Date</th><th>From</th><th>To</th><th>Amount</th></tr></thead><tbody>
            ${lc.items.slice(0, 15).map((i) => `<tr><td>${fmtDate(i.date)}</td><td>${esc(i.contributor || i.lobbyist || "")}<div class="muted small">${esc(i.registrant || "")}</div></td><td>${esc(i.payee || "")}</td>
              <td>${fmtMoney(parseFloat(i.amount))} ${i.url ? `<a class="small" href="${esc(i.url)}">report</a>` : ""}</td></tr>`).join("")}</tbody></table></div></div>
        </div>` : `<div class="empty">No lobbyist contributions to or honoring ${esc(s.name)} were reported in ${(lc.years || []).join("–")}.</div>`}` : ""}`;
  }


  const REPO = "https://github.com/kbobby92/on-the-record";
  function checkedBadge(x) {
    return x.verified ? `<span class="tag ok" title="Source checked by ${esc(x.verified_by || "a person")}">Source checked</span>`
      : `<span class="tag unchecked" title="This quote hasn't been checked against its source yet. Open the source link to confirm it.">Not yet checked</span>`;
  }
  function reportLink(x, s) {
    const title = encodeURIComponent(`Error report: ${x.id} (${s.name})`);
    const body = encodeURIComponent(`Entry: ${x.id}\nSource: ${x.source_url}\n\nWhat's wrong (and a link to the correct source, if you have one):\n`);
    return `<a href="${REPO}/issues/new?title=${title}&body=${body}">Report an error</a>`;
  }
  function postedBy(url) {
    const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\//.exec(url || "");
    return m ? ` · posted by @${esc(m[1])}` : "";
  }
  const STATUS_LABEL = { kept: "Kept", compromise: "Compromise", in_progress: "In progress", not_started: "Not yet reviewed", stalled: "Stalled", broken: "Broken" };
  function promisesTab(s) {
    if (!s.promises.length) return `<div class="empty">No promises tracked yet for ${esc(s.name)}. Each one is added with a link to where it was said.</div>`;
    const total = s.promises.length, by = s.metrics.promises_by_status;
    const colors = { kept: "var(--good)", compromise: "var(--accent)", in_progress: "var(--accent-soft)", not_started: "var(--line)", stalled: "var(--muted)", broken: "var(--bad)" };
    return `<div class="bar">${Object.entries(by).filter(([, n]) => n).map(([k, n]) => `<span title="${STATUS_LABEL[k]}: ${n}" style="width:${(100 * n) / total}%;background:${colors[k]}"></span>`).join("")}</div>
      <p class="muted small">${Object.entries(by).filter(([, n]) => n).map(([k, n]) => `${STATUS_LABEL[k]}: ${n}`).join(" · ")}. Senators are judged on their own actions (votes, bills, public pressure), not on whether Congress as a whole passed something.</p>
      ${s.promises.map((p) => `<div class="item">
        <span class="status ${esc(p.status)}">${STATUS_LABEL[p.status] || esc(p.status)}</span> <span class="tag">${esc(p.topic)}</span> ${checkedBadge(p)}
        <h3 style="margin-top:8px">${esc(p.promise)}</h3>
        <blockquote>“${esc(p.quote)}”<div class="muted small">${fmtDate(p.source_date)}${postedBy(p.source_url)} · <a href="${esc(p.source_url)}">source</a>${p.archive_url ? ` · <a href="${esc(p.archive_url)}">archived copy</a>` : ""} · ${reportLink(p, s)}</div></blockquote>
        ${p.assessment ? `<p class="small assess"><b>Why this status:</b> ${esc(p.assessment)}</p>` : ""}
        ${(p.evidence || []).length ? `<p class="small"><b>Record since:</b></p><ul class="small">${p.evidence.map((e) => `<li>${fmtDate(e.date)}: ${esc(e.description)} <a href="${esc(e.url)}">source</a></li>`).join("")}</ul>` : ""}
        ${p.notes && !/^Grok confidence/.test(p.notes) ? `<p class="muted small">${esc(p.notes)}</p>` : ""}</div>`).join("")}`;
  }

  function statementsTab(s) {
    if (!s.statements.length) return `<div class="empty">No statements on file yet.</div>`;
    return s.statements.map((x) => `<div class="item"><span class="tag">${esc(x.platform)}</span> <span class="tag">${esc(x.topic)}</span> ${checkedBadge(x)}
      <blockquote>“${esc(x.quote)}”<div class="muted small">${fmtDate(x.source_date)}${postedBy(x.source_url)} · <a href="${esc(x.source_url)}">source</a>${x.archive_url ? ` · <a href="${esc(x.archive_url)}">archived copy</a>` : ""} · ${reportLink(x, s)}</div></blockquote>
      ${x.related_bill ? `<p class="small">Related: ${esc(x.related_bill)}</p>` : ""}
      ${x.notes && !/^Grok confidence/.test(x.notes) ? `<p class="muted small">${esc(x.notes)}</p>` : ""}</div>`).join("");
  }

  function committeesTab(s) {
    const sub = {};
    s.subcommittees.forEach((c) => (sub[c.parent] = sub[c.parent] || []).push(c));
    return s.committees.length ? s.committees.map((c) => `<div class="item"><h3>${esc(c.name)}${c.title ? ` <span class="tag">${esc(c.title)}</span>` : ""}</h3>
      ${(sub[c.name] || []).length ? `<p class="small muted">Subcommittees: ${sub[c.name].map((x) => esc(x.name) + (x.title ? ` (${esc(x.title)})` : "")).join("; ")}</p>` : ""}</div>`).join("")
      : `<div class="empty">No committee assignments listed.</div>`;
  }

  /* ---------- Recent votes ---------- */
  async function votes() {
    nav("votes");
    const d = await get("data/votes_recent.json").catch(() => ({ votes: [] }));
    app.innerHTML = `<h1>Recent Senate votes</h1><p class="lede">The latest roll-call votes. Open a senator's page to see how they voted.</p>
      ${d.votes.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>What was voted on</th><th>Yes</th><th>No</th><th>Result</th></tr></thead><tbody>
      ${d.votes.map((v) => `<tr><td>${fmtDate(v.date)}</td><td>${v.bill ? `<b>${esc(v.bill)}</b> ` : ""}${esc(v.title || "")}<div class="muted small">${esc(v.question)}</div></td>
        <td>${esc(v.counts.yeas)}</td><td>${esc(v.counts.nays)}</td><td>${esc(v.result)} <a class="small" href="${esc(v.source)}">source</a></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Votes load after the first daily update.</div>`}`;
  }


  /* ---------- Elections ---------- */
  const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  const RACE_LABEL = { counting: "Counting", called: "Called", certified: "Certified", runoff: "Runoff", recount: "Recount" };
  const fecParty = (p) => ({ DEM: "D", REP: "R", IND: "I", DFL: "D" }[p] || (p ? "O" : "?"));
  const fmtWhen = (t) => { if (!t) return ""; const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

  const SIDE_NAME = { D: "Democrats", R: "Republicans", I: "Independents" };
  async function elections(focus) {
    nav("elections");
    const d = await get("data/elections.json");
    const S = d.summary || { flips: [], net: {}, closest: [], counting: [], money_won: { yes: 0, of: 0 } };
    const counts = d.races.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
    const filt = { v: "all" };
    const stName = (st) => esc(STATES[st] || st);
    const netLine = Object.entries(S.net || {}).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${SIDE_NAME[p]} ${n > 0 ? "+" : "−"}${Math.abs(n)}`).join(", ");
    app.innerHTML = `
      <h1>${d.year} Senate elections</h1>
      <p class="lede">Results for every Senate race on the ballot: who won, by how much, and which seats change party. A race is only marked called once a named news organization projects a winner, with a link to that call.</p>
      ${balanceBar(d.balance)}
      <div class="el-sum">
        <section class="panel"><p class="ph">Seats that flip</p>
          <div class="bignum sm">${S.flips.length}</div>
          ${S.flips.length ? `<p class="muted small" style="margin:0 0 8px">Net change: ${netLine}</p><ul class="flips">${S.flips.map((f) => `<li><a href="#/elections/${f.state}" data-jump="${f.state}"><b>${stName(f.state)}</b><span class="fl"><i class="p-${f.from}"></i>→<i class="p-${f.to}"></i></span><span class="muted">${esc(f.winner)}</span></a></li>`).join("")}</ul>`
            : `<p class="muted small">No called race has changed a seat's party yet.</p>`}
        </section>
        <section class="panel"><p class="ph">Closest races</p>
          ${S.closest.length ? `<ul class="flips">${S.closest.map((c) => `<li><a href="#/elections/${c.state}" data-jump="${c.state}"><b>${stName(c.state)}</b><span class="mono">${c.margin.toFixed(1)} pts</span><span class="muted">${c.status === "called" || c.status === "certified" ? "called" : "still counting"}</span></a></li>`).join("")}</ul>
            <p class="muted small" style="margin:8px 0 0">Gap between the top two candidates, in percentage points.</p>`
            : `<p class="muted small">Vote counts are being added. The closest margins will show here once they're in.</p>`}
        </section>
        <section class="panel"><p class="ph">Still counting</p>
          <div class="bignum sm">${S.counting.length}</div>
          ${S.counting.length ? `<p class="small" style="margin:0">${S.counting.map((st) => `<a href="#/elections/${st}" data-jump="${st}">${stName(st)}</a>`).join(", ")}</p>` : `<p class="muted small">Every race has been called.</p>`}
          <p class="muted small" style="margin:8px 0 0">${S.certified || 0} of ${d.races.length} results certified by the state so far.</p>
        </section>
        <section class="panel"><p class="ph">Money and results</p>
          ${S.money_won.of ? `<div class="bignum sm">${S.money_won.yes} <span class="of">of ${S.money_won.of}</span></div><p class="muted small" style="margin:0">called races were won by the candidate who raised more. Raising more often follows being favored, so this shows a pattern, not cause and effect.</p>`
            : `<p class="muted small">Shows once races are called.</p>`}
        </section>
      </div>
      <div class="controls" id="rf">
        ${[["all", "All races"], ["flip", "Seats that flip"], ["counting", "Still counting"], ["called", "Called"], ["runoff", "Runoff or recount"]].map(([v, l]) => `<button class="btn ${v === "all" ? "on" : ""}" data-v="${v}">${l}</button>`).join("")}
      </div>
      <div class="grid race-grid" id="races"></div>
      <p class="muted small" style="margin-top:16px">Vote counts come from each state's official results page when available, and otherwise from Associated Press counts as reported by news outlets. Each race links its source and says how much of the vote was counted. Counts are checked daily until the state certifies the result. Money figures are from the FEC, covering the full six-year cycle through each candidate's latest report. "Outside groups" is independent spending by super PACs and other groups, which candidates don't control. Last updated ${fmtWhen(d.updated)}.</p>`;

    const render = () => {
      const list = d.races.slice().sort((a, b) => (STATES[a.state] || a.state).localeCompare(STATES[b.state] || b.state)).filter((r) => filt.v === "all" || r.status === filt.v ||
        (filt.v === "flip" && r.flip) || (filt.v === "called" && r.status === "certified") || (filt.v === "runoff" && r.status === "recount"));
      document.getElementById("races").innerHTML = list.map(raceCard).join("") || `<div class="empty">No races in this group yet.</div>`;
    };
    const jump = (st) => { const el = document.getElementById(`race-${st.toUpperCase()}`); if (el) { document.querySelectorAll(".race.focus").forEach((x) => x.classList.remove("focus")); el.classList.add("focus"); el.scrollIntoView({ block: "center", behavior: "smooth" }); } };
    document.querySelectorAll("#rf button").forEach((b) => b.addEventListener("click", () => {
      filt.v = b.dataset.v; document.querySelectorAll("#rf button").forEach((x) => x.classList.toggle("on", x === b)); render();
    }));
    document.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); if (filt.v !== "all") { filt.v = "all"; document.querySelectorAll("#rf button").forEach((x) => x.classList.toggle("on", x.dataset.v === "all")); render(); }
      history.replaceState(null, "", `#/elections/${a.dataset.jump}`); jump(a.dataset.jump); }));
    render();
    if (focus) jump(focus);
  }

  function balanceBar(b) {
    if (!b) return "";
    const total = b.total || 100;
    const w = (n) => `${(100 * n) / total}%`;
    const iD = b.independents_caucus_with_d || 0, iOther = (b.not_up.I || 0) - iD;
    const left = b.not_up.D + b.called.D + iD, right = b.not_up.R + b.called.R;
    const seg = (n, cls, title) => (n > 0 ? `<span class="seg ${cls}" style="width:${w(n)}" title="${title}: ${n}"></span>` : "");
    return `<div class="balance">
      <div class="bal-head">
        <div class="bal-side d"><b>${left}</b><span>Democrats${iD ? ` + ${iD} independent${iD > 1 ? "s" : ""}` : ""}</span></div>
        <div class="bal-mid"><b>${b.uncalled}</b><span>still counting</span></div>
        <div class="bal-side r"><b>${right}</b><span>Republicans</span></div>
      </div>
      <div class="bal-bar" role="img" aria-label="Senate seats: ${left} Democrats and allied independents, ${right} Republicans, ${b.uncalled} races not yet called">
        ${seg(b.not_up.D, "d base", "Democrats not up this year")}${seg(b.called.D, "d won", "Democrats called winners this year")}${seg(iD, "i base", "Independents who caucus with Democrats")}${seg(b.called.I, "i won", "Independents called winners this year")}${seg(iOther, "i base", "Other independents")}${seg(b.uncalled, "open", "Not yet called")}${seg(b.called.R, "r won", "Republicans called winners this year")}${seg(b.not_up.R, "r base", "Republicans not up this year")}
        <span class="bal-line" title="51 seats is a majority (50 plus the Vice President's tie-breaking vote also controls the chamber)"></span>
      </div>
      <div class="bal-legend">
        <span><i class="sw base"></i>Not up this year</span><span><i class="sw won"></i>Called this year</span><span><i class="sw open"></i>Not yet called</span><span><i class="sw line"></i>51 seats for a majority</span>
      </div>
    </div>`;
  }

  function raceCard(r) {
    const h = r.seat_holder, R = r.results;
    const people = r.nominees.length ? r.nominees : r.filers.map((c) => ({ name: c.name, party: c.party, incumbent: c.status === "I", receipts: c.receipts, fec: c.source }));
    const won = (n) => !!n.won;
    const cls = (n) => fecParty(n.party).replace("O", "X").replace("?", "X");
    const maxR = Math.max(1, ...people.map((n) => n.receipts || 0));
    const nameOf = (n) => `${n.bioguide ? `<a href="#/s/${esc(n.bioguide)}">${esc(n.name)}</a>` : esc(n.name)}${n.incumbent ? ` <span class="tag">Incumbent</span>` : ""}${won(n) ? ` <span class="tag win">Winner</span>` : ""}`;
    const fmtVotes = (v) => (v == null ? "" : v.toLocaleString("en-US"));
    const resultRows = R ? people.map((n) => `<div class="vrow p-${cls(n)} ${won(n) ? "won" : ""}">
        <span class="cname"><span class="dot"></span>${nameOf(n)}</span>
        <span class="vpct">${n.pct != null ? `${n.pct.toFixed(1)}%` : "—"}</span>
        <span class="vbar"><span style="width:${Math.max(0.5, n.pct || 0)}%"></span></span>
        <span class="vvotes muted">${fmtVotes(n.votes)}${n.votes != null ? " votes" : ""}</span></div>`).join("")
      : people.length ? people.map((n) => `<div class="vrow p-${cls(n)} ${won(n) ? "won" : ""}"><span class="cname"><span class="dot"></span>${nameOf(n)}</span></div>`).join("")
        + (r.nominees.length ? `<p class="muted small" style="margin:6px 0 0">Vote counts are added with the next results update.</p>` : "")
        : `<p class="muted small">Candidate list loads with the next update.</p>`;
    const meta = R ? [R.counted_pct != null ? `${R.counted_pct}% of expected vote counted` : null, r.status === "certified" ? "Certified" : null,
      R.as_of ? `as of ${fmtWhen(R.as_of)}` : null, R.source ? `<a href="${esc(R.source)}">${esc(R.source_name || "source")}</a>` : null].filter(Boolean).join(" · ") : "";
    const top = people.filter((n) => n.receipts).sort((a, b) => b.receipts - a.receipts)[0];
    const moneyLine = "money_won" in r && top ? (r.money_won ? `${esc(top.name)} raised the most and won.` : `${esc(top.name)} raised the most but didn't win.`) : "";
    const moneyRows = people.filter((n) => n.receipts != null || n.outside).map((n) => `<div class="cand p-${cls(n)}">
          <span class="dot"></span><span class="cname">${esc(n.name)}</span>
          <span class="raised">${n.receipts != null ? (n.fec ? `<a href="${esc(n.fec)}">${fmtMoney(n.receipts)}</a>` : fmtMoney(n.receipts)) : `<span class="muted small">no FEC match</span>`}</span>
          ${n.receipts ? `<span class="mbar"><span style="width:${Math.max(1.5, (100 * n.receipts) / maxR)}%"></span></span>` : ""}
          ${n.outside && (n.outside.support || n.outside.oppose) ? `<details class="outside"><summary>Outside groups: <b class="sup">${fmtMoney(n.outside.support)}</b> for · <b class="opp">${fmtMoney(n.outside.oppose)}</b> against</summary>
            ${[["Supporting", n.outside.top_support], ["Opposing", n.outside.top_oppose]].filter(([, xs]) => xs && xs.length).map(([l, xs]) => `<p class="small muted" style="margin:6px 0 2px">${l}</p>${xs.map((x) => `<div class="money-row"><span>${esc(x.name || "")}</span><b>${fmtMoney(x.total)}</b></div>`).join("")}`).join("")}
            <p class="small" style="margin:6px 0 0"><a href="${esc(n.outside.source)}">FEC independent expenditures</a></p></details>` : ""}</div>`).join("");
    return `<div class="card race ${r.status}" id="race-${esc(r.state)}">
      <div class="race-top"><h3>${esc(STATES[r.state] || r.state)}</h3>
        <span class="race-tags">${r.flip ? `<span class="fliptag" title="Seat changes party"><i class="p-${r.flip.from}"></i>→<i class="p-${r.flip.to}"></i> Flips</span>` : ""}<span class="rstatus ${r.status}">${RACE_LABEL[r.status]}</span></span></div>
      <div class="muted small">${h ? `Seat held by <a href="#/s/${h.bioguide}">${esc(h.name)}</a> (${pc(h.party)})` : "Open seat"}</div>
      ${r.winner ? `<div class="called">Called for <b>${esc(r.winner)}</b> by ${esc(r.called_by)}${r.called_at ? `, ${fmtWhen(r.called_at)}` : ""}${R && R.margin != null ? ` · won by ${R.margin.toFixed(1)} pts` : ""} · <a href="${esc(r.source_url)}">source</a></div>` : ""}
      <div class="vrows">${resultRows}</div>
      ${meta ? `<p class="muted small vmeta">${meta}</p>` : ""}
      ${r.notes ? `<p class="small muted">${esc(r.notes)}</p>` : ""}
      ${moneyRows ? `<details class="race-money"><summary><span>Campaign money</span>${moneyLine ? `<span class="muted"> · ${moneyLine}</span>` : ""}</summary>
        <div class="cands">${moneyRows}</div>
        ${!r.nominees.length ? `<p class="muted small" style="margin:8px 0 0">Candidates who raised money for this seat, per the FEC. May include people who lost the primary.</p>` : ""}</details>` : ""}
    </div>`;
  }


  /* ---------- Find your senators ---------- */
  function finder(states, saved) {
    return `<form class="finder" id="finder" autocomplete="off">
      <div><b>Find your senators</b><span class="muted small">Enter your ZIP code or pick your state.</span></div>
      <input id="zip" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="ZIP code" aria-label="ZIP code">
      <select id="fstate" aria-label="State"><option value="">Choose a state</option>
        ${states.map((st) => `<option value="${st}" ${st === saved ? "selected" : ""}>${esc(STATES[st] || st)}</option>`).join("")}</select>
      <button class="btn primary" type="submit">Show my senators</button>
      <p class="ferr small" id="ferr" role="alert"></p>
    </form>`;
  }
  function bindFinder() {
    const f = document.getElementById("finder");
    if (!f) return;
    const err = document.getElementById("ferr");
    const zip = document.getElementById("zip"), sel = document.getElementById("fstate");
    zip.addEventListener("input", () => { err.textContent = ""; const z = zip.value.replace(/\D/g, ""); zip.value = z;
      if (z.length === 5) { const st = zipToState(z); if (st && [...sel.options].some((o) => o.value === st)) sel.value = st; } });
    sel.addEventListener("change", () => { err.textContent = ""; });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const z = zip.value.trim();
      let st = sel.value;
      if (z) {
        if (!/^\d{5}$/.test(z)) { err.textContent = "Enter a 5-digit ZIP code, or pick your state."; return; }
        const zs = zipToState(z);
        if (zs === "DC") { err.textContent = "Washington, D.C. doesn't have senators. Pick a state to see its senators."; return; }
        if (!zs) { err.textContent = "That ZIP code isn't in one of the 50 states. Pick your state instead."; return; }
        st = zs;
      }
      if (!st) { err.textContent = "Enter your ZIP code or pick a state."; return; }
      store.set("otr_state", st);
      location.hash = `#/state/${st}`;
    });
  }

  async function statePage(st) {
    nav("senate");
    st = (st || "").toUpperCase();
    const data = await get("data/index.json");
    const pair = data.senators.filter((s) => s.state === st).sort((a, b) => a.class - b.class);
    if (!pair.length) { app.innerHTML = `<div class="empty">No senators found for that state. <a href="#/senate">Back to all senators</a></div>`; return; }
    store.set("otr_state", st);
    const full = await Promise.all(pair.map((s) => get(`data/senators/${s.bioguide}.json`)));
    const issues = await get("data/issues_index.json").catch(() => ({ issues: [] }));
    const row = (label, f) => `<div class="cmp-row"><div class="cmp-lbl">${label}</div>${full.map((s) => `<div class="cmp-val">${f(s)}</div>`).join("")}</div>`;
    const kept = (s) => { const b = s.metrics.promises_by_status || {}; return s.metrics.promises_tracked ? `${b.kept || 0} kept · ${b.in_progress || 0} in progress · ${b.broken || 0} broken<div class="muted small">of ${s.metrics.promises_tracked} tracked</div>` : `<span class="muted">None tracked yet</span>`; };
    app.innerHTML = `
      <p class="small"><a href="#/senate">← All senators</a></p>
      <h1>${esc(STATES[st] || st)}'s senators</h1>
      <p class="lede">Side by side, from the public record. Tap a name for the full profile.</p>
      <div class="cmp">
        <div class="cmp-row cmp-head"><div class="cmp-lbl"></div>${full.map((s) => `<a class="cmp-who p-${pc(s.party)}" href="#/s/${s.bioguide}">${photo(s)}
          <div><div class="name">${esc(s.name)}</div><div class="meta">${PARTY_NAME[pc(s.party)] || esc(s.party)} · ${esc(s.rank || "")} senator</div>${electionTag(s.election)}</div></a>`).join("")}</div>
        ${row("In the Senate since", (s) => fmtDate(s.serving_since))}
        ${row("Term ends", (s) => fmtDate(s.term_end))}
        ${row("Next election", (s) => s.election ? `<a href="#/elections/${st}">${({ reelected: "Re-elected in ", lost: "Lost in ", not_on_ballot: "Leaving; seat filled in ", counting: "Being counted, ", not_running_counting: "Leaving; being counted, " })[s.election.outcome] || ""}${s.election.year}</a>` : s.next_election)}
        ${row("Attendance", (s) => `<b class="big">${fmtPct(s.metrics.attendance)}</b><div class="muted small">of ${s.metrics.votes_eligible} votes</div>`)}
        ${row("Votes with own party", (s) => `<b class="big">${fmtPct(s.metrics.party_unity)}</b>`)}
        ${row("Raised this cycle", (s) => `<b class="big">${fmtMoney(s.metrics.raised)}</b>${s.money ? `<div class="muted small">${s.money.cycle} cycle · <a href="${esc(s.money.source)}">FEC</a></div>` : ""}`)}
        ${row("Promises", kept)}
        ${row("Committees", (s) => s.committees.map((c) => esc(c.name.replace("Senate Committee on ", "").replace("Senate ", ""))).join(", ") || "—")}
        ${row("Contact", (s) => [s.phone && `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>`, s.contact_form && `<a href="${esc(s.contact_form)}">Contact form</a>`].filter(Boolean).join("<br>") || "—")}
      </div>
      ${issues.issues.length ? `<h2>How they voted on major issues</h2><div class="grid issue-grid">${issues.issues.map((i) => `<a class="card issue-card" href="#/issue/${i.id}"><h3>${esc(i.title)}</h3><p class="muted small">${i.votes} key vote${i.votes === 1 ? "" : "s"} · see how ${esc(STATES[st] || st)}'s senators voted</p></a>`).join("")}</div>` : ""}`;
  }

  /* ---------- Issues ---------- */
  // ---------- Bills tab ----------
  const STAGE = { law: ["Became law", "good"], vetoed: ["Vetoed", "bad"], passed: ["Passed a chamber", "gold"], adopted: ["Adopted", "good"],
    failed: ["Failed a floor vote", "bad"], advanced: ["Advanced", "gold"], introduced: ["Introduced", "muted"] };
  const STAGE_ORDER = ["law", "vetoed", "passed", "adopted", "failed", "advanced", "introduced"];
  const RES_TYPES = new Set(["SRES", "SCONRES", "HRES", "HCONRES"]);
  function billRow(b) {
    const [lbl, tone] = STAGE[b.stage] || [b.stage, "muted"];
    return `<div class="bill"><div class="bill-top"><a class="bill-id" href="${esc(b.url)}">${esc(b.name)}</a><span class="stg ${tone}">${lbl}</span>
      <span class="muted small">Introduced ${fmtDate(b.introduced)}</span>${b.policy ? `<span class="tag">${esc(b.policy)}</span>` : ""}</div>
      <div class="bill-title">${esc(b.title)}</div>
      ${b.action ? `<div class="muted small">Latest action, ${fmtDate(b.action_date)}: ${esc(b.action)}</div>` : ""}</div>`;
  }
  function billsTab(s) {
    const b = s.bills;
    if (!b) return `<div class="empty">Bills for ${esc(s.name)} aren't loaded yet. They come from Congress.gov and refresh daily.</div>`;
    const st = b.stages || {};
    const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
    return `<div class="bill-stats">${stat(b.sponsored_total, "sponsored")}${stat(st.law || 0, "became law")}${stat((st.passed || 0) + (st.vetoed || 0), "passed a chamber, not yet law")}${stat(b.cosponsored_total + (b.cosponsored_capped ? "+" : ""), "cosponsored")}</div>
      ${b.sponsored.length ? `<div class="bar" role="img" aria-label="Sponsored bills by stage">${STAGE_ORDER.filter((k) => st[k]).map((k) => `<span class="stg-bar ${STAGE[k][1]}" style="width:${(100 * st[k]) / b.sponsored.length}%" title="${STAGE[k][0]}: ${st[k]}"></span>`).join("")}</div>
      <p class="muted small">${STAGE_ORDER.filter((k) => st[k]).map((k) => `${STAGE[k][0]}: ${st[k]}`).join(" · ")}</p>` : ""}
      ${b.areas && b.areas.length ? `<p class="small"><b>Most common subjects:</b> ${b.areas.map(([a, n]) => `${esc(a)} (${n})`).join(", ")}</p>` : ""}
      <div class="controls bill-controls">
        <div class="segtg" id="bkind" role="group" aria-label="Which bills"><button type="button" data-v="sponsored" class="on">Sponsored (${b.sponsored_total})</button><button type="button" data-v="cosponsored">Cosponsored (${b.cosponsored_total}${b.cosponsored_capped ? "+" : ""})</button></div>
        <select id="bstage" aria-label="Stage"><option value="">Any stage</option>${STAGE_ORDER.map((k) => `<option value="${k}">${STAGE[k][0]}</option>`).join("")}</select>
        <input id="bq" type="search" placeholder="Search titles" aria-label="Search bill titles">
        <label class="chk"><input type="checkbox" id="bres"> Hide resolutions</label>
      </div>
      <div id="blist"></div>
      <p class="muted small">The stage comes from each bill's latest action on Congress.gov. Open a bill for its full history. Resolutions include ceremonial ones, like naming a day or honoring a team. Bills from the current Congress only (2025–2026).</p>`;
  }
  billsTab.bind = (s) => {
    const b = s.bills; if (!b) return;
    const ui = { kind: "sponsored", stage: "", q: "", hide: false, n: 40 };
    const draw = () => {
      const src = ui.kind === "sponsored" ? b.sponsored : b.cosponsored;
      const q = ui.q.toLowerCase();
      const rows = src.filter((x) => (!ui.stage || x.stage === ui.stage) && (!ui.hide || !RES_TYPES.has(x.type)) && (!q || (x.title + " " + x.name).toLowerCase().includes(q)));
      const extra = ui.kind === "cosponsored" && b.cosponsored.length < b.cosponsored_total ? `<p class="muted small">Showing the ${b.cosponsored.length} most recent cosponsorships. See all on <a href="https://www.congress.gov/member/${esc(s.bioguide)}">Congress.gov</a>.</p>` : "";
      document.getElementById("blist").innerHTML = (rows.length ? rows.slice(0, ui.n).map(billRow).join("") : `<div class="empty">No bills match.</div>`)
        + (rows.length > ui.n ? `<button class="btn more" id="bmore">Show more (${rows.length - ui.n} left)</button>` : "") + extra;
      const more = document.getElementById("bmore"); if (more) more.onclick = () => { ui.n += 40; draw(); };
    };
    document.querySelectorAll("#bkind button").forEach((x) => x.onclick = () => { ui.kind = x.dataset.v; ui.n = 40; document.querySelectorAll("#bkind button").forEach((y) => y.classList.toggle("on", y === x)); draw(); });
    document.getElementById("bstage").onchange = (e) => { ui.stage = e.target.value; ui.n = 40; draw(); };
    document.getElementById("bq").oninput = (e) => { ui.q = e.target.value; ui.n = 40; draw(); };
    document.getElementById("bres").onchange = (e) => { ui.hide = e.target.checked; ui.n = 40; draw(); };
    draw();
  };

  // ---------- Promises page ----------
  const PCOL = { kept: "var(--good)", compromise: "var(--gold)", in_progress: "var(--dem-ink)", stalled: "var(--muted)", broken: "var(--bad)", not_started: "var(--line-2)" };
  const PORDER_S = ["kept", "compromise", "in_progress", "stalled", "broken", "not_started"];
  function promiseCard(p) {
    const who = { name: p.senator, last: p.senator.split(" ").pop(), photo: p.photo };
    return `<article class="item pcard">
      <div class="pc-head">${photo(who)}<div class="pc-who"><a href="#/s/${esc(p.bioguide)}"><b>${esc(p.senator)}</b></a> <span class="muted">(${pc(p.party)}-${esc(p.state)})</span>
        <div class="muted small">${fmtDate(p.source_date)} · ${esc(p.topic)}</div></div>
        <span class="status ${esc(p.status)}">${STATUS_LABEL[p.status] || esc(p.status)}</span></div>
      <h3>${esc(p.promise || "")}</h3>
      ${p.assessment ? `<p class="small assess"><b>Why this status:</b> ${esc(p.assessment)}</p>` : !p.specific ? `<p class="muted small">A general pledge, so it isn't graded.</p>` : ""}
      <details class="sum"><summary>Their words${(p.evidence || []).length ? " and the record since" : ""}</summary>
        <blockquote>“${esc(p.quote)}”<div class="muted small">${fmtDate(p.source_date)}${postedBy(p.source_url)} · <a href="${esc(p.source_url)}">source</a></div></blockquote>
        ${(p.evidence || []).length ? `<ul class="small">${p.evidence.map((e) => `<li>${fmtDate(e.date)}: ${esc(e.description)} <a href="${esc(e.url)}">source</a></li>`).join("")}</ul>` : ""}
      </details>
      <div class="pc-foot">${checkedBadge(p)}${p.specific ? "" : `<span class="tag">General pledge</span>`}</div>
    </article>`;
  }
  async function promisesPage(arg) {
    nav("promises");
    const [d, idx] = await Promise.all([get("data/promises_index.json"), get("data/index.json")]);
    const ui = promisesPage.ui || (promisesPage.ui = { status: "", q: "", topic: "", party: "", state: "", specific: false, sort: "updated", n: 30 });
    if (arg) ui.status = STATUS_LABEL[arg] ? arg : "";
    ui.n = 30;
    const all = d.promises;
    const cnt = Object.fromEntries(PORDER_S.map((k) => [k, all.filter((p) => p.status === k).length]));
    const topics = [...new Set(all.map((p) => p.topic).filter(Boolean))].sort();
    const states = [...new Set(all.map((p) => p.state))].sort();
    const people = new Set(all.map((p) => p.bioguide)).size;
    const scored = idx.senators.filter((s) => s.metrics.follow_through != null)
      .sort((a, b) => b.metrics.follow_through - a.metrics.follow_through || a.last.localeCompare(b.last));
    app.innerHTML = `
      <div class="dash-title"><h1>Promises</h1><p class="lede">Every promise tracked so far, from ${people} senators. Each one quotes the senator's own words, links to where they said it, and is rated against what they've done since.</p></div>
      <div class="pp-top">
        <section class="panel"><p class="ph">By status</p>
          <div class="bignum">${all.length}</div>
          <div class="pstack" role="img" aria-label="${PORDER_S.map((k) => `${cnt[k]} ${STATUS_LABEL[k].toLowerCase()}`).join(", ")}">${PORDER_S.map((k) => (cnt[k] ? `<span style="flex:${cnt[k]};background:${PCOL[k]}" title="${STATUS_LABEL[k]}: ${cnt[k]}"></span>` : "")).join("")}</div>
          <div class="pfilter" id="pstatus" role="group" aria-label="Filter by status">
            <button type="button" data-s="" class="${ui.status ? "" : "on"}"><span>All</span><b>${all.length}</b></button>
            ${PORDER_S.map((k) => `<button type="button" data-s="${k}" class="${ui.status === k ? "on" : ""}"><i style="background:${PCOL[k]}"></i><span>${STATUS_LABEL[k]}</span><b>${cnt[k]}</b></button>`).join("")}</div>
          <p class="muted small" style="margin:10px 0 0">Most promises so far come from senators' own posts and floor speeches, which tend to highlight pledges they kept. Senators are judged on their own votes and actions, not on whether Congress as a whole passed something.</p>
        </section>
        <section class="panel"><p class="ph">Follow-through scores</p>
          ${scored.length ? `<ol class="scores">${scored.map((s) => `<li><a href="#/s/${esc(s.bioguide)}"><span class="sc-name">${esc(s.name)} <span class="muted">(${pc(s.party)}-${esc(s.state)})</span></span>
            <span class="sc-bar"><span style="width:${s.metrics.follow_through}%"></span></span><b>${fmtPct(s.metrics.follow_through)}</b></a>
            <span class="muted small">${s.metrics.promises_resolved} resolved of ${s.metrics.promises_tracked}</span></li>`).join("")}</ol>` : `<p class="muted">No senator has enough resolved promises yet.</p>`}
          <p class="muted small" style="margin:10px 0 0">A senator gets a score once at least 3 of their promises are resolved. Kept counts 1, compromise ½, stalled or broken 0. ${scored.length} senator${scored.length === 1 ? " has" : "s have"} one so far. Scores include sources not yet checked by a person. <a href="#/about">How it works</a></p>
        </section>
      </div>
      <div class="controls">
        <input id="pq" type="search" placeholder="Search promises or senators" aria-label="Search promises" value="${esc(ui.q)}">
        <select id="ptopic" aria-label="Topic"><option value="">All topics</option>${topics.map((t) => `<option ${ui.topic === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
        <select id="pparty" aria-label="Party"><option value="">All parties</option>${["D", "R", "I"].map((x) => `<option value="${x}" ${ui.party === x ? "selected" : ""}>${PARTY_NAME[x]}s</option>`).join("")}</select>
        <select id="pstate" aria-label="State"><option value="">All states</option>${states.map((x) => `<option ${ui.state === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <select id="psort" aria-label="Sort"><option value="updated">Latest update</option><option value="said">Newest promise</option><option value="name">Senator A–Z</option></select>
        <label class="chk"><input type="checkbox" id="pspec" ${ui.specific ? "checked" : ""}> Graded promises only</label>
      </div>
      <p class="muted small" id="pcount" aria-live="polite"></p>
      <div id="plist"></div>`;
    document.getElementById("psort").value = ui.sort;
    const draw = () => {
      const q = ui.q.toLowerCase();
      let rows = all.filter((p) => (!ui.status || p.status === ui.status) && (!ui.topic || p.topic === ui.topic) && (!ui.party || pc(p.party) === ui.party)
        && (!ui.state || p.state === ui.state) && (!ui.specific || p.specific) && (!q || `${p.senator} ${p.promise} ${p.quote}`.toLowerCase().includes(q)));
      const key = { updated: (p) => p.updated || p.source_date || "", said: (p) => p.source_date || "" }[ui.sort];
      rows = ui.sort === "name" ? rows.sort((a, b) => a.senator.split(" ").pop().localeCompare(b.senator.split(" ").pop()) || (b.source_date || "").localeCompare(a.source_date || ""))
        : rows.sort((a, b) => key(b).localeCompare(key(a)));
      document.getElementById("pcount").textContent = `${rows.length} promise${rows.length === 1 ? "" : "s"}`;
      document.getElementById("plist").innerHTML = (rows.length ? `<div class="pgrid">${rows.slice(0, ui.n).map(promiseCard).join("")}</div>` : `<div class="empty">No promises match these filters.</div>`)
        + (rows.length > ui.n ? `<button class="btn more" id="pmore">Show more (${rows.length - ui.n} left)</button>` : "");
      const more = document.getElementById("pmore"); if (more) more.onclick = () => { ui.n += 30; draw(); };
    };
    document.querySelectorAll("#pstatus button").forEach((b) => b.onclick = () => {
      ui.status = b.dataset.s; ui.n = 30; document.querySelectorAll("#pstatus button").forEach((x) => x.classList.toggle("on", x === b));
      history.replaceState(null, "", ui.status ? `#/promises/${ui.status}` : "#/promises"); draw(); });
    const bindIn = (id, k, ev = "change", f = (e) => e.target.value) => { document.getElementById(id).addEventListener(ev, (e) => { ui[k] = f(e); ui.n = 30; draw(); }); };
    bindIn("pq", "q", "input"); bindIn("ptopic", "topic"); bindIn("pparty", "party"); bindIn("pstate", "state"); bindIn("psort", "sort");
    bindIn("pspec", "specific", "change", (e) => e.target.checked);
    draw();
  }

  async function issuesPage() {
    nav("issues");
    const d = await get("data/issues_index.json");
    app.innerHTML = `<h1>Issues</h1>
      <p class="lede">Major fights in the Senate, each in one place: what was voted on, how every senator voted, and what they promised and said about it.</p>
      <div class="grid issue-grid">${d.issues.map((i) => `<a class="card issue-card" href="#/issue/${i.id}">
        <h3>${esc(i.title)}</h3><p class="muted small">${esc(clip(i.summary))}</p>
        <div class="stats"><div class="stat"><b>${i.votes}</b><span>key votes</span></div><div class="stat"><b>${i.promises}</b><span>promises</span></div><div class="stat"><b>${i.statements}</b><span>statements</span></div></div>
      </a>`).join("")}</div>`;
  }

  function lobbyBlock(L) {
    if (!L) return "";
    const yrs = (L.years || []).join("–");
    if (!L.reports) return `<h2>Who lobbied on this</h2><div class="empty">No ${yrs} lobbying reports found that name ${L.bills.map(esc).join(", ")}.</div>`;
    return `<h2>Who lobbied on this</h2>
      <p class="muted small">From federal lobbying reports filed in ${yrs} that name ${L.bills.map((b) => `${esc(b)} (${L.by_bill[b] || 0})`).join(", ")}. Organizations lobby for and against bills, and reports don't say which. Amounts are what each report disclosed for <i>all</i> its issues, not just this one.</p>
      <div class="metrics" style="margin-top:8px"><div class="metric"><div class="lbl">Reports</div><div class="val">${L.reports}</div><div class="how">lobbying reports name these bills</div></div>
        <div class="metric"><div class="lbl">Organizations</div><div class="val">${L.clients}</div><div class="how">clients that lobbied on them</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Organization</th><th>Lobbied through</th><th>Reports</th><th>Reported on those reports</th></tr></thead><tbody>
        ${L.top.map((c) => `<tr><td><b>${esc(c.client)}</b><div class="muted small">${c.bills.map(esc).join(", ")}</div></td><td>${c.firms.length ? c.firms.map(esc).join(", ") : `<span class="muted">Own staff</span>`}</td>
          <td>${c.reports}</td><td>${c.amount ? fmtMoney(c.amount) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Source: <a href="https://lda.gov/filings/public/filing/search/">Lobbying Disclosure Act database</a>. Updated ${L.fetched ? new Date(L.fetched).toLocaleDateString() : "weekly"}.</p>`;
  }

  const POS_LABEL = { Y: "Yes", N: "No", P: "Present", NV: "Didn't vote" };
  async function issuePage(id) {
    nav("issues");
    let d;
    try { d = await get(`data/issues/${id}.json`); } catch { app.innerHTML = `<div class="empty">Issue not found. <a href="#/issues">All issues</a></div>`; return; }
    const idx = await get("data/index.json");
    const who = Object.fromEntries(idx.senators.map((s) => [s.bioguide, s]));
    const states = [...new Set(idx.senators.map((s) => s.state))].sort();
    const ui2 = { st: store.get("otr_state") || "", all: false };
    app.innerHTML = `
      <p class="small"><a href="#/issues">← All issues</a></p>
      <h1>${esc(d.title)}</h1>
      <p class="lede">${esc(d.summary)}</p>
      ${d.bills.some((b) => b.summary) ? `<div class="item"><h3>What the bills do</h3>${d.bills.filter((b) => b.summary).map((b) => `<details class="sum"><summary>${esc(b.name)}</summary><p>${esc(b.summary.text)} ${b.summary.url ? `<a href="${esc(b.summary.url)}">Congress.gov</a>` : ""}</p></details>`).join("")}<p class="muted small" style="margin:8px 0 0">Summaries by the nonpartisan Congressional Research Service.</p></div>` : ""}
      ${lobbyBlock(d.lobbying)}
      <h2>Key votes</h2>
      <div class="controls"><select id="ist" aria-label="Show a state's senators"><option value="">Show how a state's senators voted…</option>
        ${states.map((s) => `<option value="${s}" ${s === ui2.st ? "selected" : ""}>${esc(STATES[s] || s)}</option>`).join("")}</select></div>
      <div id="ivotes"></div>
      ${d.promises.length ? `<h2>Promises about this</h2>${d.promises.map((p) => `<div class="item"><span class="status ${esc(p.status)}">${STATUS_LABEL[p.status] || esc(p.status)}</span> ${p.verified ? `<span class="tag ok">Source checked</span>` : `<span class="tag unchecked">Not yet checked</span>`}
        <h3 style="margin-top:8px"><a href="#/s/${p.bioguide}">${esc(p.name)}</a> <span class="muted small">(${pc(p.party)}-${esc(p.state)})</span></h3>
        <p style="margin:4px 0">${esc(p.promise || "")}</p><blockquote>“${esc(p.quote)}”<div class="muted small">${fmtDate(p.source_date)} · <a href="${esc(p.source_url)}">source</a> · <a href="#/s/${p.bioguide}">full record</a></div></blockquote></div>`).join("")}` : ""}
      ${d.statements.length ? `<h2>What senators said</h2>${d.statements.map((x) => `<div class="item"><span class="tag">${esc(x.platform || "")}</span> ${x.verified ? `<span class="tag ok">Source checked</span>` : `<span class="tag unchecked">Not yet checked</span>`}
        <h3 style="margin-top:8px"><a href="#/s/${x.bioguide}">${esc(x.name)}</a> <span class="muted small">(${pc(x.party)}-${esc(x.state)})</span></h3>
        <blockquote>“${esc(x.quote)}”<div class="muted small">${fmtDate(x.source_date)} · <a href="${esc(x.source_url)}">source</a></div></blockquote></div>`).join("")}` : ""}`;

    const chips = (v, pos) => Object.entries(v.positions).filter(([, p]) => (pos === "NV" ? !["Y", "N"].includes(p) : p === pos))
      .map(([b]) => who[b]).filter(Boolean).sort((a, b) => a.last.localeCompare(b.last))
      .map((s) => `<a class="chip p-${pc(s.party)}" href="#/s/${s.bioguide}">${esc(s.last)} <span>${pc(s.party)}-${esc(s.state)}</span></a>`).join("") || `<span class="muted small">None</span>`;
    const partyBar = (p) => {
      const t = p.Y + p.N;
      return t ? `<span class="pbar" title="${p.Y} yes, ${p.N} no"><span class="py" style="width:${(100 * p.Y) / t}%"></span><span class="pn" style="width:${(100 * p.N) / t}%"></span></span>` : `<span class="pbar empty"></span>`;
    };
    const render = () => {
      const mine = ui2.st ? idx.senators.filter((s) => s.state === ui2.st) : [];
      const list = ui2.all ? d.votes : d.votes.slice(0, 8);
      document.getElementById("ivotes").innerHTML = (list.map((v) => `<div class="item vote">
        <div class="vote-top"><span class="muted small">${fmtDate(v.date)}</span>${v.bill ? ` <b>${esc(v.bill)}</b>` : ""}<span class="vres">${esc(v.result)}</span></div>
        <div>${esc(v.title)}</div><div class="muted small">${esc(v.question)} · ${esc(v.counts.yeas)}–${esc(v.counts.nays)} · <a href="${esc(v.source)}">official record</a></div>
        <div class="vparties">
          ${[["D", "Democrats"], ["R", "Republicans"], ["I", "Independents"]].filter(([k]) => v.parties[k].Y + v.parties[k].N + v.parties[k].NV).map(([k, l]) =>
            `<div class="vp p-${k}"><span class="vpl">${l}</span>${partyBar(v.parties[k])}<span class="vpn">${v.parties[k].Y} yes · ${v.parties[k].N} no</span></div>`).join("")}
        </div>
        ${mine.length ? `<div class="mine">${mine.map((s) => { const p = v.positions[s.bioguide]; return `<span class="mine-v"><a href="#/s/${s.bioguide}">${esc(s.name)}</a>: <b class="pos ${p || "NV"}">${p ? POS_LABEL[p] || p : "Not in office"}</b></span>`; }).join("")}</div>` : ""}
        <details class="sum"><summary>See every senator's vote</summary>
          <div class="chips"><b class="small">Yes</b>${chips(v, "Y")}</div><div class="chips"><b class="small">No</b>${chips(v, "N")}</div><div class="chips"><b class="small">Didn't vote</b>${chips(v, "NV")}</div>
          <p class="muted small">Current senators only.</p></details>
      </div>`).join("") || `<div class="empty">No recorded votes on this yet.</div>`)
        + (!ui2.all && d.votes.length > 8 ? `<button class="btn" id="vmore">Show all ${d.votes.length} votes</button>` : "");
      const more = document.getElementById("vmore");
      if (more) more.addEventListener("click", () => { ui2.all = true; render(); });
    };
    document.getElementById("ist").addEventListener("change", (e) => { ui2.st = e.target.value; if (ui2.st) store.set("otr_state", ui2.st); render(); });
    render();
  }


  /* ---------- News ---------- */
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 60) return `${Math.max(1, m)}m`;
    if (m < 1440) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  };
  const dayLabel = (iso) => {
    const d = new Date(iso), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
    const same = (a, b) => a.toDateString() === b.toDateString();
    return same(d, t) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  };
  const KIND = { official: ["Official", "off"], vote: ["Senate vote", "off"] };
  function newsItem(i, names, parties = {}) {
    const fresh = Date.now() - new Date(i.published) < 3 * 3600e3 && i.kind === "news";
    const who = (i.senators || []).map((id) => id.startsWith("elect:")
      ? `<a class="chip p-${parties[id] || "X"}" href="#/elections/${esc(id.slice(6))}">${esc(names[id] || id)} <span>elect</span></a>`
      : `<a class="chip p-${parties[id] || "X"}" href="#/s/${esc(id)}">${esc((names[id] || id).split(" ").slice(-1)[0])}</a>`).join("");
    const also = (i.also || []).map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.source)}</a>`).join(", ");
    const k = KIND[i.kind];
    return `<li class="nitem">
      <time datetime="${esc(i.published)}" title="${esc(new Date(i.published).toLocaleString())}">${ago(i.published)}</time>
      <div>
        <div class="nmeta">${k ? `<span class="src ${k[1]}">${k[0]}</span>` : `<span class="src">${esc(i.source)}</span>`}${fresh ? `<span class="newb">New</span>` : ""}</div>
        <a class="nhead" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
        ${also ? `<div class="nalso">Also covered by ${also}</div>` : ""}
        ${who ? `<div class="nwho">${who}</div>` : ""}
      </div></li>`;
  }

  async function newsPage() {
    nav("news");
    const [n, idx] = await Promise.all([get("data/news.json"), get("data/index.json")]);
    const states = [...new Set(idx.senators.map((s) => s.state))].sort();
    const f = { kind: "all", st: "", q: "" };
    app.innerHTML = `<h1>News</h1>
      <p class="lede">The latest on senators and the federal government: headlines from ${n.sources.length} outlets across the political spectrum, plus official actions from the Senate and Congress.gov. Headlines link to the original story.</p>
      <div class="controls">
        <div class="segtg" id="nk">${[["all", "All"], ["news", "Headlines"], ["official", "Official actions"], ["senators", "Mentions a senator"]].map(([v, l]) => `<button type="button" data-v="${v}" class="${v === "all" ? "on" : ""}">${l}</button>`).join("")}</div>
        <select id="nst" aria-label="Only a state's senators"><option value="">Any state</option>${states.map((x) => `<option value="${x}">${esc(STATES[x] || x)}</option>`).join("")}</select>
        <input id="nq" type="search" placeholder="Search headlines" aria-label="Search headlines">
      </div>
      <div id="nlist"></div>
      <p class="muted small">Outlets: ${n.sources.map(esc).join(", ")}. Headline wording is each outlet's own. Updated ${new Date(n.updated).toLocaleString()}.</p>`;
    const ids = (st) => new Set(idx.senators.filter((s) => s.state === st).map((s) => s.bioguide).concat([`elect:${st}`]));
    const render = () => {
      const want = f.st ? ids(f.st) : null, q = f.q.toLowerCase();
      const list = n.items.filter((i) => (f.kind === "all" || (f.kind === "news" && i.kind === "news") || (f.kind === "official" && i.kind !== "news")
        || (f.kind === "senators" && i.senators.length)) && (!want || i.senators.some((x) => want.has(x))) && (!q || i.title.toLowerCase().includes(q)));
      let html = "", day = "";
      list.forEach((i) => { const d = dayLabel(i.published); if (d !== day) { html += `${day ? "</ul>" : ""}<h3 class="nday">${d}</h3><ul class="newslist">`; day = d; } html += newsItem(i, n.names, n.parties); });
      document.getElementById("nlist").innerHTML = list.length ? html + "</ul>" : `<div class="empty">No news matches those filters in the last 7 days.</div>`;
    };
    document.querySelectorAll("#nk button").forEach((b) => b.addEventListener("click", () => { f.kind = b.dataset.v; document.querySelectorAll("#nk button").forEach((x) => x.classList.toggle("on", x === b)); render(); }));
    document.getElementById("nst").addEventListener("change", (e) => { f.st = e.target.value; render(); });
    document.getElementById("nq").addEventListener("input", (e) => { f.q = e.target.value; render(); });
    render();
  }

  function newsTab(s) {
    const n = s._news;
    if (!n) return `<div class="empty">News hasn't loaded yet.</div>`;
    const mine = n.items.filter((i) => i.senators.includes(s.bioguide));
    return mine.length ? `<p class="muted small">Headlines from the last 7 days that mention ${esc(s.name)}. Wording is each outlet's own.</p><ul class="newslist">${mine.map((i) => newsItem(i, n.names, n.parties)).join("")}</ul>`
      : `<div class="empty">No headlines mentioning ${esc(s.name)} in the last 7 days.</div>`;
  }

  /* ---------- About ---------- */
  function about() {
    nav("about");
    app.innerHTML = `<div class="prose">
      <h1>How it works</h1>
      <p class="lede">The goal is to put scattered public information in one readable place. The site reports what senators did; it doesn't tell you whether that was good.</p>
      <h2>Where the data comes from</h2>
      <ul>
        <li><b>Senators and committees:</b> the open <a href="https://github.com/unitedstates/congress-legislators">congress-legislators</a> dataset.</li>
        <li><b>Votes:</b> official roll-call records from <a href="https://www.senate.gov/legislative/votes_new.htm">senate.gov</a>. Bill summaries come from the nonpartisan Congressional Research Service via <a href="https://www.congress.gov">Congress.gov</a>.</li>
        <li><b>Stock trades (coming soon):</b> Periodic Transaction Reports filed under the STOCK Act at <a href="https://efdsearch.senate.gov">efdsearch.senate.gov</a>. Until they're added, each senator's page explains how to look up their filings there.</li>
        <li><b>Campaign money:</b> the <a href="https://www.fec.gov">Federal Election Commission</a>.</li>
        <li><b>Lobbying:</b> the federal <a href="https://lda.gov">Lobbying Disclosure Act database</a>: quarterly reports naming the bills organizations lobbied on, and lobbyists' reports of political contributions. Refreshed weekly.</li>
        <li><b>News:</b> headlines from a mix of outlets across the political spectrum (the list is on the News page), plus official actions from Congress.gov and the Senate. Only the headline, outlet and link are shown; stories run on the outlet's own site. Headlines are matched to senators by full name or by "Sen." plus last name. Checked four times a day (6 AM, 10 AM, 2 PM and 6 PM Arizona time); stories older than 7 days drop off.</li>
        <li><b>Bills:</b> every bill and resolution each senator sponsored or cosponsored this Congress, from Congress.gov, refreshed daily. A bill's stage (introduced, advanced, passed a chamber, became law) is read from its latest official action, which is shown word for word. Open the bill on Congress.gov for its full history.</li>
        <li><b>Promises and statements:</b> gathered with the help of AI research tools. Every entry quotes the original words and links the original source. Entries marked <b>Not yet checked</b> haven't been compared against their source by a person yet, so open the link before relying on one. Entries marked <b>Source checked</b> have been. Unchecked entries still count toward the follow-through score, so treat it as a guide and use the source links. Spot a mistake? Use the "Report an error" link on any entry.</li>
      </ul>
      <h2>What each number means</h2>
      <ul>
        <li><b>Attendance:</b> roll-call votes they cast (yes, no or present) divided by votes held while they were in office this Congress.</li>
        <li><b>Votes with own party:</b> how often their yes/no matched the majority of their party (independents counted with the party they caucus with). Context only: neither high nor low is "better."</li>
        <li><i>When stock trades are added:</i> <b>Trades reported on time:</b> the STOCK Act requires reporting a trade within 45 days. We count days between the trade and the date the report was received.</li>
        <li><b>Trades in their committees' industries:</b> trades in companies whose industry falls under a committee the senator sits on. The committee-to-industry list is public in <code>data/committee_sectors.json</code>. A flag isn't proof of wrongdoing; it marks where a conflict of interest is possible.</li>
        <li><b>Promise follow-through:</b> among resolved promises, kept counts 1, compromise counts ½, stalled or broken count 0. Only specific, checkable promises are graded, and only once at least 3 are resolved. Senators are judged on their own actions, since no single senator can pass a law alone. Statuses are assessed from the official Senate roll-call record, and each one explains its reasoning. The score includes promises whose quotes haven't been checked by a person yet.</li>
      </ul>
      <h2>What we don't do</h2>
      <ul>
        <li>No overall score that mixes these together. Any weighting would bake in someone's values.</li>
        <li>No ratings of whether a vote was good or bad for you. The record is here so you can judge.</li>
        <li>Nothing appears without a link to its original source.</li>
        <li>Every promise status links to the votes or actions it's based on, with a short explanation.</li>
      </ul>
      <h2>Spot an error?</h2>
      <p>Open an issue on the project's GitHub page with a link to the correct source.</p>
    </div>`;
  }

  function route() {
    clearInterval(tickTimer);
    const h = location.hash.replace(/^#\/?/, "");
    const [page, arg] = h.split("/");
    const run = page === "s" && arg ? profile(arg) : page === "votes" ? votes() : page === "elections" ? elections(arg)
      : page === "state" && arg ? statePage(arg) : page === "senate" ? senatePage() : page === "house" ? housePage() : page === "news" ? newsPage() : page === "issues" ? issuesPage() : page === "promises" ? promisesPage(arg) : page === "issue" && arg ? issuePage(arg)
      : page === "about" ? about() : home();
    Promise.resolve(run).catch((e) => { console.error(e); app.innerHTML = `<div class="empty">Couldn't load the data. If you're viewing locally, run a small web server (see README).</div>`; });
  }
  window.addEventListener("hashchange", route);
  route();
})();
