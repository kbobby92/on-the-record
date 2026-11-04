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

  /* ---------- Home: all senators ---------- */
  async function home() {
    nav("home");
    const data = await get("data/index.json");
    document.getElementById("updated").textContent = `Data updated ${new Date(data.updated).toLocaleString()}.`;
    const ss = data.senators;
    const states = [...new Set(ss.map((s) => s.state))].sort();
    const onBallot = ss.filter((s) => s.next_election === ELECTION_YEAR).length;
    const noData = !data.totals.votes && !data.totals.trade_reports;

    app.innerHTML = `
      <h1>Your senators, in one place</h1>
      <p class="lede">What each U.S. senator votes for, raises and has promised, pulled from official public records and linked back to the source. No party scores, no spin: just the record, so you can decide.</p>
      <div class="banner">
        <div><strong>${ELECTION_YEAR} election:</strong> ${onBallot} of these seats are on the ballot. Winners take office in January; their campaign promises will be tracked from day one.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="#/elections" style="text-decoration:none;color:inherit">See races and results</a>
        <button class="btn ${ui.ballot ? "on" : ""}" id="ballot">Show only seats on the ${ELECTION_YEAR} ballot</button></div>
      </div>
      ${noData ? `<div class="notice">Votes and campaign money load after the daily update job first runs. Until then you'll see each senator's basic profile and committees.</div>` : ""}
      <div class="controls">
        <input id="q" type="search" placeholder="Search by name or committee" value="${esc(ui.q)}" aria-label="Search">
        <select id="st" aria-label="State"><option value="">All states</option>${states.map((s) => `<option ${s === ui.state ? "selected" : ""}>${s}</option>`).join("")}</select>
        <select id="pt" aria-label="Party"><option value="">All parties</option>${["Democrat", "Republican", "Independent"].map((p) => `<option ${p === ui.party ? "selected" : ""}>${p}</option>`).join("")}</select>
        <select id="so" aria-label="Sort">
          ${[["state", "Sort: state"], ["name", "Sort: name"], ["attendance", "Lowest attendance"], ["unity_low", "Most often votes against own party"], ["raised", "Most money raised"]]
            .concat(TRADES_ENABLED ? [["late", "Most late trade reports"], ["overlap", "Most committee-overlap trades"], ["trades", "Most trades"]] : [])
            .map(([v, l]) => `<option value="${v}" ${v === ui.sort ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <p class="muted small" id="count"></p>
      <div class="grid" id="grid"></div>`;

    const render = () => {
      const q = ui.q.toLowerCase();
      let list = ss.filter((s) =>
        (!ui.state || s.state === ui.state) && (!ui.party || s.party === ui.party) &&
        (!ui.ballot || s.next_election === ELECTION_YEAR) &&
        (!q || s.name.toLowerCase().includes(q) || s.committees.join(" ").toLowerCase().includes(q)));
      const m = (s, k) => s.metrics[k] ?? -1;
      const sorters = {
        state: (a, b) => a.state.localeCompare(b.state) || a.last.localeCompare(b.last),
        name: (a, b) => a.last.localeCompare(b.last),
        attendance: (a, b) => (a.metrics.attendance ?? 101) - (b.metrics.attendance ?? 101),
        late: (a, b) => m(b, "late_trades") - m(a, "late_trades"),
        overlap: (a, b) => m(b, "committee_overlap_trades") - m(a, "committee_overlap_trades"),
        trades: (a, b) => m(b, "trades") - m(a, "trades"),
        raised: (a, b) => m(b, "raised") - m(a, "raised"),
        unity_low: (a, b) => (a.metrics.party_unity ?? 101) - (b.metrics.party_unity ?? 101),
      };
      list.sort(sorters[ui.sort]);
      document.getElementById("count").textContent = `${list.length} senator${list.length === 1 ? "" : "s"}`;
      document.getElementById("grid").innerHTML = list.map((s) => `
        <a class="card p-${pc(s.party)}" href="#/s/${s.bioguide}">
          <div class="who">${photo(s)}<div>
            <div class="name">${esc(s.name)}</div>
            <div class="meta">${PARTY_NAME[pc(s.party)] || esc(s.party)} · ${esc(s.state)}</div>
            ${s.next_election === ELECTION_YEAR ? `<span class="tag" style="margin-top:6px">On ${ELECTION_YEAR} ballot</span>` : ""}
          </div></div>
          <div class="stats">
            <div class="stat"><b>${fmtPct(s.metrics.attendance)}</b><span>votes cast</span></div>
            ${TRADES_ENABLED ? `<div class="stat"><b>${s.metrics.trades}</b><span>stock trades</span></div>
            <div class="stat"><b>${s.metrics.late_trades}</b><span>reported late</span></div>` : `<div class="stat"><b>${fmtPct(s.metrics.party_unity)}</b><span>votes with party</span></div>
            <div class="stat"><b>${fmtMoney(s.metrics.raised)}</b><span>raised this cycle</span></div>`}
          </div>
        </a>`).join("") || `<div class="empty">No senators match those filters.</div>`;
    };
    const bind = (id, key, ev = "change") => document.getElementById(id).addEventListener(ev, (e) => { ui[key] = e.target.value; render(); });
    bind("q", "q", "input"); bind("st", "state"); bind("pt", "party"); bind("so", "sort");
    document.getElementById("ballot").addEventListener("click", (e) => { ui.ballot = !ui.ballot; e.target.classList.toggle("on", ui.ballot); render(); });
    render();
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
            ${s.next_election === ELECTION_YEAR ? `<span class="tag">Seat on the ${ELECTION_YEAR} ballot</span>` : ""}</div>
          <div class="facts">
            <span>${esc(s.state)} · ${esc(s.rank || "")} senator</span>
            <span>In the Senate since ${fmtDate(s.serving_since)}</span>
            <span>Current term ends ${fmtDate(s.term_end)}</span>
            <span>Next election: ${s.next_election}</span>
          </div>
          <div class="small links">${links}</div>
        </div>
      </div>
      <div class="metrics">
        ${metric("Attendance", fmtPct(m.attendance), `Share of ${m.votes_eligible} roll-call votes this Congress where they voted.`)}
        ${metric("Votes with own party", fmtPct(m.party_unity), "How often they voted with most of their party. Shown for context, not as good or bad.")}
        ${TRADES_ENABLED ? `${metric("Trades reported on time", m.trades ? fmtPct(m.on_time) : "—", `STOCK Act deadline: 45 days. ${m.late_trades} of ${m.trades} trades were reported late.`)}
        ${metric("Trades in their committees' industries", m.trades ? String(m.committee_overlap_trades) : "—", m.industry_coverage != null ? `Industry identified for ${m.industry_coverage}% of traded stocks.` : "Needs industry data (see How it works).")}` : ""}
        ${metric("Promise follow-through", fmtPct(m.follow_through), `${m.promises_tracked} promise${m.promises_tracked === 1 ? "" : "s"} tracked. Scored only on source-checked promises, once at least 3 are resolved.`)}
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

  async function elections() {
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
    return `<div class="card race ${r.status}">
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
        <li><b>Promises and statements:</b> gathered with the help of AI research tools. Every entry quotes the original words and links the original source. Entries marked <b>Not yet checked</b> haven't been compared against their source by a person yet, so open the link before relying on one. Entries marked <b>Source checked</b> have been. Only source-checked promises count toward the follow-through score. Spot a mistake? Use the "Report an error" link on any entry.</li>
      </ul>
      <h2>What each number means</h2>
      <ul>
        <li><b>Attendance:</b> roll-call votes they cast (yes, no or present) divided by votes held while they were in office this Congress.</li>
        <li><b>Votes with own party:</b> how often their yes/no matched the majority of their party (independents counted with the party they caucus with). Context only: neither high nor low is "better."</li>
        <li><i>When stock trades are added:</i> <b>Trades reported on time:</b> the STOCK Act requires reporting a trade within 45 days. We count days between the trade and the date the report was received.</li>
        <li><b>Trades in their committees' industries:</b> trades in companies whose industry falls under a committee the senator sits on. The committee-to-industry list is public in <code>data/committee_sectors.json</code>. A flag isn't proof of wrongdoing; it marks where a conflict of interest is possible.</li>
        <li><b>Promise follow-through:</b> among resolved promises, kept counts 1, compromise counts ½, stalled or broken count 0. Only specific, checkable promises are graded, and only once at least 3 are resolved. Senators are judged on their own actions, since no single senator can pass a law alone.</li>
      </ul>
      <h2>What we don't do</h2>
      <ul>
        <li>No overall score that mixes these together. Any weighting would bake in someone's values.</li>
        <li>No ratings of whether a vote was good or bad for you. The record is here so you can judge.</li>
        <li>Nothing appears without a link to its original source.</li>
        <li>Nothing counts toward a score until a person has checked it against that source.</li>
      </ul>
      <h2>Spot an error?</h2>
      <p>Open an issue on the project's GitHub page with a link to the correct source.</p>
    </div>`;
  }

  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const [page, arg] = h.split("/");
    const run = page === "s" && arg ? profile(arg) : page === "votes" ? votes() : page === "elections" ? elections() : page === "about" ? about() : home();
    Promise.resolve(run).catch((e) => { console.error(e); app.innerHTML = `<div class="empty">Couldn't load the data. If you're viewing locally, run a small web server (see README).</div>`; });
  }
  window.addEventListener("hashchange", route);
  route();
})();
