/* AgentDeck dashboard client — vanilla JS, live over WebSocket.
   Renders the attention rail (waiting_input), the session grid, token-burn bars,
   and fires a soft beep + tab badge when a new agent starts waiting on you. */
(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), empty = $("empty");
  const conn = $("conn"), connText = $("conn-text");
  const attention = $("attention"), attList = $("attention-list"), attCount = $("att-count");
  const statWaiting = $("stat-waiting");

  let sessions = new Map();
  let audioCtx = null;
  let prevWaiting = new Set();
  let series = []; // {t, cost, tokens}
  let lastPointT = 0;

  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [0, 0.16].forEach((off, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.frequency.value = i ? 1180 : 880; o.type = "sine";
        g.gain.setValueAtTime(0.0001, t + off);
        g.gain.exponentialRampToValueAtTime(0.06, t + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.14);
        o.start(t + off); o.stop(t + off + 0.16);
      });
    } catch (_) {}
  }

  const fmtNum = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n | 0);
  const ago = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h";
  };
  const tokensOf = (u) => (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
  const shortModel = (m) => m.replace(/^claude-/, "").replace(/-\d{6,8}$/, "").slice(0, 20);
  const initials = (label) =>
    label.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "◈";
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function sortList() {
    return [...sessions.values()].sort((a, b) => {
      const rank = (s) => (s.status === "waiting_input" ? 0 : s.status === "running" ? 1 : s.status === "idle" ? 2 : 3);
      return rank(a) - rank(b) || b.lastActivity - a.lastActivity;
    });
  }

  function burnBar(u) {
    const tot = tokensOf(u) || 1;
    const pct = (x) => ((x || 0) / tot) * 100;
    return `
      <div class="burn">
        <div class="burn-track">
          <div class="burn-seg in" style="width:${pct(u.input)}%"></div>
          <div class="burn-seg out" style="width:${pct(u.output)}%"></div>
          <div class="burn-seg cache" style="width:${pct((u.cacheRead || 0) + (u.cacheWrite || 0))}%"></div>
        </div>
        <div class="burn-legend">
          <span>in <b>${fmtNum(u.input || 0)}</b></span>
          <span>out <b>${fmtNum(u.output || 0)}</b></span>
          <span>cache <b>${fmtNum((u.cacheRead || 0) + (u.cacheWrite || 0))}</b></span>
        </div>
      </div>`;
  }

  function cardHtml(s) {
    const acct = s.meta && s.meta.account;
    const mode = s.mode && s.mode !== "unknown" ? `<span class="mode ${s.mode}">${s.mode}</span>` : "";
    const action =
      s.status === "waiting_input" && s.waitingReason
        ? `<span class="waiting-reason">⌨ ${esc(s.waitingReason)}</span>`
        : esc(s.currentAction || "—");
    const costVal = acct ? Number(s.meta.billedUsdToday || 0) : s.costUsd;
    return `
      <div class="card-head">
        <span class="avatar">${esc(initials(s.label))}</span>
        <span class="card-title">${esc(s.label)}</span>
        <span class="tool-badge">${esc(s.tool)}</span>
      </div>
      <div class="status-row">
        <span class="status ${s.status}"><span class="sdot"></span>${esc(s.status.replace("_", " "))}</span>
        ${mode}
        <span class="age">${ago(s.lastActivity)}</span>
      </div>
      <div class="action">${action}</div>
      ${acct ? "" : burnBar(s.usage)}
      <div class="stats-strip">
        <div class="chip"><span class="k">tokens</span><span class="v mono">${fmtNum(tokensOf(s.usage))}</span></div>
        <div class="chip cost"><span class="k">${acct ? "billed today" : "est. cost"}</span><span class="v mono">$${costVal.toFixed(acct ? 2 : 4)}</span></div>
        ${s.model ? `<div class="chip"><span class="k">model</span><span class="v mono" style="font-size:12px">${esc(shortModel(s.model))}</span></div>` : ""}
      </div>
      ${s.cwd ? `<div class="path">${esc(s.cwd)}</div>` : ""}`;
  }

  function render() {
    const list = sortList();
    empty.style.display = list.length ? "none" : "flex";

    // attention rail
    const waiting = list.filter((s) => s.status === "waiting_input");
    if (waiting.length) {
      attention.classList.add("show");
      attCount.textContent = waiting.length;
      attList.innerHTML = waiting
        .map(
          (s) => `<div class="att-card">
            <div class="att-title"><span class="avatar" style="width:24px;height:24px;font-size:11px">${esc(initials(s.label))}</span>${esc(s.label)}
              <span class="tool-badge" style="margin-left:auto">${esc(s.tool)}</span></div>
            <div class="att-q">⌨ ${esc(s.waitingReason || "waiting for input")}</div>
            <div class="att-meta">${esc(s.mode)} mode · ${fmtNum(tokensOf(s.usage))} tokens · $${s.costUsd.toFixed(4)} · idle ${ago(s.lastActivity)}</div>
          </div>`,
        )
        .join("");
      document.title = `(${waiting.length}) ⌨ AgentDeck — input needed`;
      statWaiting.classList.add("has");
    } else {
      attention.classList.remove("show");
      document.title = "AgentDeck — AI control tower";
      statWaiting.classList.remove("has");
    }

    // grid
    grid.querySelectorAll(".card").forEach((c) => c.remove());
    for (const s of list) {
      const el = document.createElement("div");
      el.className = `card ${s.status}`;
      el.innerHTML = cardHtml(s);
      grid.appendChild(el);
    }

    // beep on NEW waiting sessions
    const nowWaiting = new Set(waiting.map((s) => s.id));
    for (const id of nowWaiting) if (!prevWaiting.has(id)) beep();
    prevWaiting = nowWaiting;
  }

  function applySummary(sm) {
    if (!sm) return;
    $("s-total").textContent = sm.totalSessions;
    $("s-running").textContent = sm.running;
    $("s-waiting").textContent = sm.waitingInput;
    $("s-tokens").textContent = fmtNum(sm.totalTokens);
    $("s-cost").textContent = "$" + sm.totalCostUsd.toFixed(2);
    $("cn-cost").textContent = "$" + sm.totalCostUsd.toFixed(2);
    $("cn-tok").textContent = fmtNum(sm.totalTokens);
    // append a live point at most every 5s so the chart moves without flooding
    const now = Date.now();
    if (now - lastPointT > 5000) {
      series.push({ t: now, cost: sm.totalCostUsd, tokens: sm.totalTokens });
      if (series.length > 1000) series = series.slice(-1000);
      lastPointT = now;
      drawChart();
    }
  }

  async function seedHistory() {
    try {
      const r = await fetch("/api/history?minutes=120");
      const data = await r.json();
      series = (data.points || []).map((p) => ({ t: p.t, cost: p.costUsd, tokens: p.tokens }));
      drawChart();
    } catch (_) {}
  }

  function drawChart() {
    const c = $("burnChart");
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || c.parentElement.clientWidth - 52;
    const h = 90;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 4, r: 4, t: 10, b: 8 };
    const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;

    // faint grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (plotH * i) / 3;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }

    const pts = series.length ? series : [{ t: Date.now(), cost: 0, tokens: 0 }];
    if (pts.length < 2) {
      const only = pts[0];
      pts.unshift({ t: only.t - 60000, cost: 0, tokens: 0 });
    }
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const span = Math.max(1, t1 - t0);
    const maxCost = Math.max(0.0001, ...pts.map((p) => p.cost));
    const maxTok = Math.max(1, ...pts.map((p) => p.tokens));
    const X = (t) => pad.l + ((t - t0) / span) * plotW;
    const Yc = (v) => pad.t + plotH - (v / maxCost) * plotH;
    const Yt = (v) => pad.t + plotH - (v / maxTok) * plotH;

    // cost area (accent)
    ctx.beginPath();
    ctx.moveTo(X(pts[0].t), Yc(pts[0].cost));
    for (const p of pts) ctx.lineTo(X(p.t), Yc(p.cost));
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, "rgba(91,140,255,0.35)");
    grad.addColorStop(1, "rgba(91,140,255,0.02)");
    ctx.lineTo(X(pts[pts.length - 1].t), pad.t + plotH);
    ctx.lineTo(X(pts[0].t), pad.t + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    // cost stroke
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Yc(p.cost)) : ctx.moveTo(X(p.t), Yc(p.cost))));
    ctx.strokeStyle = "#5b8cff"; ctx.lineWidth = 2; ctx.stroke();

    // tokens line (accent-2, thinner)
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Yt(p.tokens)) : ctx.moveTo(X(p.t), Yt(p.tokens))));
    ctx.strokeStyle = "rgba(139,123,255,0.85)"; ctx.lineWidth = 1.5; ctx.stroke();

    // emphasized endpoints
    const last = pts[pts.length - 1];
    ctx.fillStyle = "#5b8cff";
    ctx.beginPath(); ctx.arc(X(last.t), Yc(last.cost), 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8b7bff";
    ctx.beginPath(); ctx.arc(X(last.t), Yt(last.tokens), 2.6, 0, Math.PI * 2); ctx.fill();
  }

  function connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => { connText.textContent = "live"; conn.className = "conn ok"; };
    ws.onclose = () => {
      connText.textContent = "reconnecting…"; conn.className = "conn bad";
      setTimeout(connect, 1800);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "snapshot") sessions = new Map(msg.sessions.map((s) => [s.id, s]));
      else if (msg.type === "upsert") sessions.set(msg.session.id, msg.session);
      else if (msg.type === "remove") sessions.delete(msg.session.id);
      applySummary(msg.summary);
      render();
    };
  }

  setInterval(() => {
    $("clock").textContent = new Date().toLocaleTimeString();
    render(); // keep "ago" fresh
  }, 1000);

  window.addEventListener("resize", drawChart);
  seedHistory();
  connect();
})();
