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

  /* ---------- Home: Senate dashboard ---------- */
  const TILE = [["AK",0,0],["ME",11,0],["VT",10,1],["NH",11,1],["WA",1,2],["ID",2,2],["MT",3,2],["ND",4,2],["MN",5,2],["IL",6,2],["WI",7,2],["MI",8,2],["NY",9,2],["RI",10,2],["MA",11,2],
    ["OR",1,3],["NV",2,3],["WY",3,3],["SD",4,3],["IA",5,3],["IN",6,3],["OH",7,3],["PA",8,3],["NJ",9,3],["CT",10,3],["CA",1,4],["UT",2,4],["CO",3,4],["NE",4,4],["MO",5,4],["KY",6,4],
    ["WV",7,4],["VA",8,4],["MD",9,4],["DE",10,4],["AZ",2,5],["NM",3,5],["KS",4,5],["AR",5,5],["TN",6,5],["NC",7,5],["SC",8,5],["OK",4,6],["LA",5,6],["MS",6,6],["AL",7,6],["GA",8,6],
    ["HI",0,7],["TX",4,7],["FL",9,7]];
  const PCOLOR = { D: "var(--dem)", R: "var(--rep)", I: "var(--ind)", X: "var(--line-2)" };
  const PORDER = { D: 0, I: 1, X: 2, R: 3 };
  const SEATS = (() => {
    const out = [];
    [[14, 84], [17, 104], [20, 124], [23, 144], [26, 164]].forEach(([n, r]) => {
      for (let i = 0; i < n; i++) { const a = Math.PI - (Math.PI * i) / (n - 1); out.push({ x: 200 + r * Math.cos(a), y: 176 - r * Math.sin(a), a }); }
    });
    return out.sort((p, q) => q.a - p.a);
  })();
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

  async function home() {
    nav("home");
    const [data, dash] = await Promise.all([get("data/index.json"), get("data/dashboard.json").catch(() => null)]);
    document.getElementById("updated").textContent = `Data updated ${new Date(data.updated).toLocaleString()}.`;
    const ss = data.senators;
    const states = [...new Set(ss.map((s) => s.state))].sort();
    const ui = home.ui || (home.ui = { q: "", group: "state", sort: "name", mode: "january" });

    app.innerHTML = `
      <div class="dash-title"><h1>The Senate</h1><p class="lede">Who holds every seat, what changes in January, and what senators promised. All from public records, each linked to its source.</p></div>
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
    }

    const card = (s) => `
        <a class="card p-${pc(s.party)}" href="#/s/${s.bioguide}">
          <div class="who">${photo(s)}<div>
            <div class="name">${esc(s.name)}</div>
            <div class="meta">${PARTY_NAME[pc(s.party)] || esc(s.party)} · ${esc(s.state)}</div>
            ${electionTag(s.election)}
          </div></div>
          <div class="stats">
            <div class="stat"><b>${fmtPct(s.metrics.attendance)}</b><span>votes cast</span></div>
            <div class="stat"><b>${fmtPct(s.metrics.party_unity)}</b><span>votes with party</span></div>
            <div class="stat"><b>${fmtMoney(s.metrics.raised)}</b><span>raised this cycle</span></div>
          </div>
        </a>`;
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
          <div class="grid">${buckets[k].sort(sorters[ui.sort]).map(card).join("")}</div></section>`).join("")
        || `<div class="empty">No senators match "${esc(ui.q)}".</div>`;
    };
    document.getElementById("q").addEventListener("input", (e) => { ui.q = e.target.value; render(); });
    document.getElementById("grp").addEventListener("change", (e) => { ui.group = e.target.value; render(); });
    document.getElementById("so").addEventListener("change", (e) => { ui.sort = e.target.value; render(); });
    render();
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
      <p class="muted small" style="margin:10px 0 0">${graded} specific promises have a status. ${p.not_reviewed} general pledges aren't graded. Most promises so far come from senators' own posts, which tend to highlight pledges they kept.</p>`;
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
    nav("home");
    let s;
    try { s = await get(`data/senators/${id}.json`); } catch { app.innerHTML = `<div class="empty">Senator not found. <a href="#/">Back to all senators</a></div>`; return; }
    const m = s.metrics;
    const metric = (lbl, val, how) => `<div class="metric ${val === "—" ? "na" : ""}"><div class="lbl">${lbl}</div><div class="val">${val === "—" ? "Not enough data yet" : val}</div><div class="how">${how}</div></div>`;
    const links = [s.website && `<a href="${esc(s.website)}">Official site</a>`, s.contact_form && `<a href="${esc(s.contact_form)}">Contact</a>`,
      s.phone && `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>`, s.x_handle && `<a href="https://x.com/${esc(s.x_handle)}">@${esc(s.x_handle)} on X</a>`].filter(Boolean).join(" · ");

    app.innerHTML = `
      <p class="small"><a href="#/">← All senators</a></p>
      <div class="profile-head p-${pc(s.party)}">
        ${photo(s)}
        <div>
          <h1>${esc(s.name)}</h1>
          <div><span class="party">${esc(s.party)}${s.caucus && s.caucus !== s.party ? `, caucuses with ${esc(s.caucus)}s` : ""}</span>
            ${!s.election && s.next_election === ELECTION_YEAR ? `<span class="tag">Seat on the ${ELECTION_YEAR} ballot</span>` : ""}</div>
          <div class="facts">
            <span>${esc(s.state)} · ${esc(s.rank || "")} senator</span>
            <span>In the Senate since ${fmtDate(s.serving_since)}</span>
            <span>Current term ends ${fmtDate(s.term_end)}</span>
            <span>Next election: ${s.next_election}</span>
          </div>
          <div class="small links">${links}</div>
        </div>
      </div>
      ${electionNote(s.election, s.name)}
      <div class="metrics">
        ${metric("Attendance", fmtPct(m.attendance), `Share of ${m.votes_eligible} roll-call votes this Congress where they voted.`)}
        ${metric("Votes with own party", fmtPct(m.party_unity), "How often they voted with most of their party. Shown for context, not as good or bad.")}
        ${TRADES_ENABLED ? `${metric("Trades reported on time", m.trades ? fmtPct(m.on_time) : "—", `STOCK Act deadline: 45 days. ${m.late_trades} of ${m.trades} trades were reported late.`)}
        ${metric("Trades in their committees' industries", m.trades ? String(m.committee_overlap_trades) : "—", m.industry_coverage != null ? `Industry identified for ${m.industry_coverage}% of traded stocks.` : "Needs industry data (see How it works).")}` : ""}
        ${metric("Promise follow-through", fmtPct(m.follow_through), `${m.promises_resolved || 0} of ${m.promises_tracked} promise${m.promises_tracked === 1 ? "" : "s"} resolved. Shown once at least 3 are resolved. Includes sources not yet checked by a person.`)}
      </div>
      <div class="tabs" role="tablist">
        ${["Votes", "Stock trades", "Campaign money", "Promises", "Statements", "Committees"].map((t, i) => `<button role="tab" data-tab="${i}" class="${i === 0 ? "on" : ""}">${t}</button>`).join("")}
      </div>
      <div id="tab"></div>`;

    const tabs = [votesTab, tradesTab, moneyTab, promisesTab, statementsTab, committeesTab];
    const show = (i) => { document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", +b.dataset.tab === i)); document.getElementById("tab").innerHTML = tabs[i](s); };
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(+b.dataset.tab)));
    show(0);
  }

  const POS = { Y: "Yes", N: "No", P: "Present", NV: "Didn't vote" };
  function votesTab(s) {
    if (!s.votes.length) return `<div class="empty">No votes loaded yet. They arrive with the first daily update.</div>`;
    return `<p class="muted small">Most recent ${s.votes.length} roll-call votes. Where available, the summary is the Congressional Research Service's neutral description of the bill.</p>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>What was voted on</th><th>Their vote</th><th>Result</th></tr></thead><tbody>
      ${s.votes.map((v) => `<tr>
        <td>${fmtDate(v.date)}</td>
        <td>${v.bill ? `<b>${esc(v.bill)}</b> ` : ""}${esc(v.title || "")}<div class="muted small">${esc(v.question)}</div>
          ${v.summary ? `<details class="sum"><summary>What the bill does</summary><p>${esc(v.summary.text)} ${v.summary.url ? `<a href="${esc(v.summary.url)}">Congress.gov</a>` : ""}</p></details>` : ""}
          ${v.broke_with_party ? `<span class="flag break">Voted against most of party</span>` : ""}</td>
        <td class="pos ${v.position}">${POS[v.position] || esc(v.position)}</td>
        <td>${esc(v.result)} <a class="small" href="${esc(v.source)}">source</a></td></tr>`).join("")}
      </tbody></table></div>`;
  }

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
    return `<p class="muted small">Campaign committee totals for the ${m.cycle} election cycle (${esc(m.period)}). <a href="${esc(m.source)}">Full FEC record</a></p>
      <div class="grid"><div class="card">${rows.map(([l, v]) => `<div class="money-row"><span>${l}</span><b>${fmtMoney(v)}</b></div>`).join("")}</div>
      <div class="card"><h3>Top donor employers</h3><p class="muted small">Itemized donations grouped by the employer donors listed. Reflects employees, not the companies themselves.</p>
      ${m.top_employers.length ? m.top_employers.map((e) => `<div class="money-row"><span>${esc(e.employer)}</span><b>${fmtMoney(e.total)}</b></div>`).join("") : `<p class="muted">None reported.</p>`}</div></div>`;
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

  async function elections(focus) {
    nav("elections");
    const d = await get("data/elections.json");
    const counts = d.races.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
    const filt = { v: "all" };
    app.innerHTML = `
      <h1>${d.year} Senate elections</h1>
      <p class="lede">Every Senate race on the ballot, who's running and what they've raised. A race is only marked called once a named news organization projects a winner, with a link to that call.</p>
      ${balanceBar(d.balance)}
      <div class="metrics">
        <div class="metric"><div class="lbl">Races</div><div class="val">${d.races.length}</div><div class="how">Seats on the ${d.year} ballot</div></div>
        <div class="metric"><div class="lbl">Called</div><div class="val">${(counts.called || 0) + (counts.certified || 0)}</div><div class="how">${counts.certified || 0} certified by the state</div></div>
        <div class="metric"><div class="lbl">Still counting</div><div class="val">${counts.counting || 0}</div><div class="how">${(counts.runoff || 0) + (counts.recount || 0)} in a runoff or recount</div></div>
      </div>
      <div class="controls" id="rf">
        ${[["all", "All races"], ["counting", "Still counting"], ["called", "Called"], ["runoff", "Runoff or recount"]].map(([v, l]) => `<button class="btn ${v === "all" ? "on" : ""}" data-v="${v}">${l}</button>`).join("")}
      </div>
      <div class="grid race-grid" id="races"></div>
      <p class="muted small" style="margin-top:16px">Bars show money raised relative to the top fundraiser in each race. Money figures are from the FEC, covering the full six-year cycle through each candidate's latest report. Results statuses are checked every few hours on election week, then daily until certification. Last updated ${fmtWhen(d.updated)}.</p>`;

    const render = () => {
      const list = d.races.slice().sort((a, b) => (STATES[a.state] || a.state).localeCompare(STATES[b.state] || b.state)).filter((r) => filt.v === "all" || r.status === filt.v ||
        (filt.v === "called" && r.status === "certified") || (filt.v === "runoff" && r.status === "recount"));
      document.getElementById("races").innerHTML = list.map(raceCard).join("") || `<div class="empty">No races in this group yet.</div>`;
    };
    document.querySelectorAll("#rf button").forEach((b) => b.addEventListener("click", () => {
      filt.v = b.dataset.v; document.querySelectorAll("#rf button").forEach((x) => x.classList.toggle("on", x === b)); render();
    }));
    render();
    if (focus) {
      const el = document.getElementById(`race-${focus.toUpperCase()}`);
      if (el) { el.classList.add("focus"); el.scrollIntoView({ block: "center" }); }
    }
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
    const h = r.seat_holder;
    const people = r.nominees.length ? r.nominees : r.filers.map((c) => ({ name: c.name, party: c.party, incumbent: c.status === "I", receipts: c.receipts, fec: c.source }));
    const won = (n) => !!n.won;
    const maxR = Math.max(1, ...people.map((n) => n.receipts || 0));
    return `<div class="card race ${r.status}" id="race-${esc(r.state)}">
      <div class="race-top"><h3>${esc(STATES[r.state] || r.state)}</h3><span class="rstatus ${r.status}">${RACE_LABEL[r.status]}</span></div>
      <div class="muted small">${h ? `Seat held by <a href="#/s/${h.bioguide}">${esc(h.name)}</a> (${pc(h.party)})` : "Open seat"}</div>
      ${r.winner ? `<div class="called">Called for <b>${esc(r.winner)}</b> by ${esc(r.called_by)}${r.called_at ? `, ${fmtWhen(r.called_at)}` : ""} · <a href="${esc(r.source_url)}">source</a></div>` : ""}
      ${r.notes ? `<p class="small muted">${esc(r.notes)}</p>` : ""}
      <div class="cands">
        ${people.length ? people.map((n) => `<div class="cand p-${fecParty(n.party).replace("O", "X").replace("?", "X")} ${won(n) ? "won" : ""}">
          <span class="dot"></span><span class="cname">${n.bioguide ? `<a href="#/s/${esc(n.bioguide)}">${esc(n.name)}</a>` : esc(n.name)}${n.incumbent ? ` <span class="tag">Incumbent</span>` : ""}${won(n) ? ` <span class="tag win">Winner</span>` : ""}</span>
          <span class="raised">${n.receipts != null ? (n.fec ? `<a href="${esc(n.fec)}">${fmtMoney(n.receipts)}</a>` : fmtMoney(n.receipts)) : `<span class="muted small">no FEC match</span>`}</span>
          ${n.receipts ? `<span class="mbar"><span style="width:${Math.max(1.5, (100 * n.receipts) / maxR)}%"></span></span>` : ""}</div>`).join("")
          : `<p class="muted small">Candidate list loads with the next update.</p>`}
      </div>
      ${!r.nominees.length && people.length ? `<p class="muted small" style="margin:8px 0 0">Candidates who raised money for this seat, per the FEC. May include people who lost the primary; the final ballot lineup is added as results come in.</p>` : ""}
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
    nav("home");
    st = (st || "").toUpperCase();
    const data = await get("data/index.json");
    const pair = data.senators.filter((s) => s.state === st).sort((a, b) => a.class - b.class);
    if (!pair.length) { app.innerHTML = `<div class="empty">No senators found for that state. <a href="#/">Back to all senators</a></div>`; return; }
    store.set("otr_state", st);
    const full = await Promise.all(pair.map((s) => get(`data/senators/${s.bioguide}.json`)));
    const issues = await get("data/issues_index.json").catch(() => ({ issues: [] }));
    const row = (label, f) => `<div class="cmp-row"><div class="cmp-lbl">${label}</div>${full.map((s) => `<div class="cmp-val">${f(s)}</div>`).join("")}</div>`;
    const kept = (s) => { const b = s.metrics.promises_by_status || {}; return s.metrics.promises_tracked ? `${b.kept || 0} kept · ${b.in_progress || 0} in progress · ${b.broken || 0} broken<div class="muted small">of ${s.metrics.promises_tracked} tracked</div>` : `<span class="muted">None tracked yet</span>`; };
    app.innerHTML = `
      <p class="small"><a href="#/">← All senators</a></p>
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
  async function issuesPage() {
    nav("issues");
    const d = await get("data/issues_index.json");
    app.innerHTML = `<h1>Issues</h1>
      <p class="lede">Major fights in the Senate, each in one place: what was voted on, how every senator voted, and what they promised and said about it.</p>
      <div class="grid issue-grid">${d.issues.map((i) => `<a class="card issue-card" href="#/issue/${i.id}">
        <h3>${esc(i.title)}</h3><p class="muted small">${esc(i.summary.split(". ")[0])}.</p>
        <div class="stats"><div class="stat"><b>${i.votes}</b><span>key votes</span></div><div class="stat"><b>${i.promises}</b><span>promises</span></div><div class="stat"><b>${i.statements}</b><span>statements</span></div></div>
      </a>`).join("")}</div>`;
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
    const h = location.hash.replace(/^#\/?/, "");
    const [page, arg] = h.split("/");
    const run = page === "s" && arg ? profile(arg) : page === "votes" ? votes() : page === "elections" ? elections(arg)
      : page === "state" && arg ? statePage(arg) : page === "issues" ? issuesPage() : page === "issue" && arg ? issuePage(arg)
      : page === "about" ? about() : home();
    Promise.resolve(run).catch((e) => { console.error(e); app.innerHTML = `<div class="empty">Couldn't load the data. If you're viewing locally, run a small web server (see README).</div>`; });
  }
  window.addEventListener("hashchange", route);
  route();
})();
