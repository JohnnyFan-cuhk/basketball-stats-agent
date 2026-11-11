/* ============================================================
 * app.js · 页面渲染 + 实时统计计算
 * ------------------------------------------------------------
 * 结构：所有统计（总分/胜负/场均/命中率/负荷）都不落库，
 *       每次渲染时从原始数据实时算出（单一事实来源）。
 * M2 升级点：AI 报告 tab 目前是预置示例，之后换成
 *       「把 db 整个 JSON 发给 GLM Agent → 返回报告」。
 * ============================================================ */

let db = loadDB();
let charts = [];          // 当前页面的 Chart 实例，切换 tab 前销毁
let currentTab = 'dashboard';

/* ---------- 小工具 ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 用户输入的内容渲染前必须转义，防止破坏页面结构
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }

const QUARTER_LABELS = ['第一节', '第二节', '第三节', '第四节'];

/* ---------- 统计计算（从原始数据实时推导） ---------- */

function teamScore(game, side) {
  return game[side].reduce((a, b) => a + b, 0);
}

function gameResult(game) {
  const diff = teamScore(game, 'us') - teamScore(game, 'them');
  return diff > 0 ? 'win' : diff < 0 ? 'loss' : 'draw';
}

function gamesSorted() {
  return [...db.games].sort((a, b) => a.date.localeCompare(b.date));
}

// 球员赛季汇总：出战场次、总计与场均、命中率（有投篮数据才算）
function playerTotals() {
  const map = {};
  for (const p of db.players) {
    map[p.id] = { player: p, gp: 0, pts: 0, reb: 0, ast: 0, tov: 0, fgm: 0, fga: 0 };
  }
  for (const g of db.games) {
    for (const s of g.stats) {
      const r = map[s.playerId];
      if (!r) continue;
      r.gp += 1;
      r.pts += s.pts; r.reb += s.reb; r.ast += s.ast; r.tov += s.tov;
      if (Array.isArray(s.fg)) { r.fgm += s.fg[0]; r.fga += s.fg[1]; }
    }
  }
  return Object.values(map).sort((a, b) => b.pts - a.pts);
}

// sRPE 负荷：强度 × 分钟 / 10（AU）。比赛按强度 5、90 分钟估算。
function sessionLoad(t) { return t.intensity * t.minutes / 10; }

function loadSessions() {
  const trainings = db.trainings.map(t => ({
    date: t.date, label: `${t.type}（${t.minutes}min）`,
    au: sessionLoad(t), est: false, knee: t.knee || '',
  }));
  const games = db.games.map(g => ({
    date: g.date, label: `vs ${g.opponent}（比赛·估算）`,
    au: 5 * 90 / 10, est: true, knee: '',
  }));
  return [...trainings, ...games].sort((a, b) => a.date.localeCompare(b.date));
}

function loadLast7Days() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return loadSessions().filter(s => s.date >= cutoffStr)
    .reduce((sum, s) => sum + s.au, 0);
}

/* ---------- 负荷 × 膝盖（规则提示，非医疗建议） ----------
 * 大负荷单元 = 单次 ≥40AU（如 48AU 队练、估算 45AU 比赛）。
 * 规则：大负荷后 2 个自然日内出现膝盖「酸/痛」反馈 → 计 1 次触发。 */

const BIG_LOAD_AU = 40;

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function kneeMark(k) {
  return k === '好' ? '✅好' : k === '酸' ? '🟡酸' : k === '痛' ? '🔴痛' : '';
}

function kneeCrossReport(sessions) {
  const dated = sessions.filter(s => s.knee);
  const last = dated.length ? dated[dated.length - 1] : null;
  const big = sessions.filter(s => s.au >= BIG_LOAD_AU);
  let flares = 0;
  for (const b of big) {
    const hit = dated.some(s => s.knee !== '好' && s.date > b.date && s.date <= addDays(b.date, 2));
    if (hit) flares += 1;
  }
  return { bigCount: big.length, flares, last };
}

function kneeCrossCard(sessions) {
  const recent = sessions.slice(-8).reverse();   // 最近 8 条，最新在上
  const rowMax = Math.max(...recent.map(s => s.au), 1);
  const r = kneeCrossReport(sessions);
  let hint;
  if (r.flares >= 2) {
    hint = `🦵 <b>提示（规则·估算）：</b>大负荷单元（≥${BIG_LOAD_AU}AU）后 48h 内膝盖酸痛已出现 ${r.flares} 次 —— 建议下周总负荷下调 10-20%，减少连续跳跃类内容，并持续记录恢复后反馈。`;
  } else if (r.flares === 1) {
    hint = `🦵 <b>提示（规则·估算）：</b>出现 1 次大负荷后酸痛 —— 观察即可；大负荷日（≥${BIG_LOAD_AU}AU）后 48h 内控制额外跳跃量。`;
  } else if (r.last) {
    hint = `🦵 近期大负荷后膝盖反馈良好，继续保持「大负荷日 → 次日反馈」的记录习惯。`;
  } else {
    hint = `🦵 还没有膝盖反馈记录 —— 记训练时顺手选一个（好/酸/痛），就能生成负荷-膝盖关联提示。`;
  }
  return `
    <div class="section-title">负荷 × 膝盖反馈</div>
    <div class="card">
      ${recent.map(s => `
        <div class="load-bar-row">
          <span class="who">${esc(s.date)} · ${esc(s.label)}</span>
          <div class="bar"><div style="width:${Math.round(s.au / rowMax * 100)}%"></div></div>
          <span class="au">${s.au} AU${s.est ? ' *' : ''}${s.knee ? ' · ' + kneeMark(s.knee) : ''}</span>
        </div>`).join('') || '<div class="hint">还没有训练/比赛记录</div>'}
      <div class="hint" style="margin-top:8px">${hint}</div>
      <div class="hint">* 膝盖反馈为记录人个人视角（v1）。规则提示非医疗建议，膝盖持续疼痛请就医。</div>
    </div>`;
}

/* ---------- ACWR（急性:慢性负荷比，Gabbett 滚动平均模型） ----------
 * 急性负荷 = 近 7 天日负荷合计；慢性负荷 = 近 28 天日负荷合计 ÷ 4（周均）。
 * ACWR = 急性 / 慢性：<0.8 负荷不足；0.8-1.3 最优；1.3-1.5 偏高；>1.5 尖峰风险。 */

function dailyLoadSeries(days) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), au: 0 });
  }
  const map = Object.fromEntries(out.map(o => [o.date, o]));
  for (const s of loadSessions()) if (map[s.date]) map[s.date].au += s.au;
  return out;
}

function rollingLoads(series, win, divide) {
  return series.map((d, i) => {
    if (i + 1 < win) return null;
    let sum = 0;
    for (let k = i - win + 1; k <= i; k++) sum += series[k].au;
    return Math.round(sum / divide);
  });
}

function acwrReport(series) {
  const acute = series.slice(-7).reduce((a, d) => a + d.au, 0);
  const sum28 = series.reduce((a, d) => a + d.au, 0);
  const chronic = sum28 / 4;
  if (sum28 === 0) return { acute: 0, chronic: 0, ratio: null, zone: '数据不足', color: '#9aa3b2' };
  const ratio = acute / chronic;
  let zone, color;
  if (ratio > 1.5)       { zone = '高危尖峰'; color = '#f87171'; }
  else if (ratio > 1.3)  { zone = '偏高';      color = '#fb923c'; }
  else if (ratio >= 0.8) { zone = '最优区间'; color = '#34d399'; }
  else                   { zone = '负荷不足'; color = '#9aa3b2'; }
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio: Math.round(ratio * 100) / 100, zone, color };
}

function acwrCard() {
  const series = dailyLoadSeries(28);
  const r = acwrReport(series);
  const ratioText = r.ratio === null ? '--' : r.ratio.toFixed(2);
  let hint;
  if (r.zone === '数据不足')       hint = '近 28 天还没有训练/比赛记录，暂无法计算 ACWR —— 坚持记录 1 周后自动生成。';
  else if (r.zone === '高危尖峰') hint = `⚠ <b>本周减量</b>：急性负荷已达慢性的 ${ratioText} 倍（>1.5 尖峰区）。优先安排恢复课、砍掉连续大负荷日，膝盖反馈加倍留意。`;
  else if (r.zone === '偏高')     hint = `⚠ ACWR ${ratioText}（1.3-1.5 偏高区）—— 控制下周增量，避免再排连续大负荷日。`;
  else if (r.zone === '最优区间') hint = `✓ ACWR ${ratioText}（0.8-1.3 最优区）—— 当前负荷节奏健康，按计划推进即可。`;
  else                            hint = `ACWR ${ratioText}（<0.8 负荷不足区）—— 若非恢复周，建议逐步把周负荷拉回最优区间。`;

  const labels = series.map(d => d.date.slice(5));
  const acute7 = rollingLoads(series, 7, 1);
  const chronic = rollingLoads(series, 28, 4);

  return `
    <div class="section-title">ACWR · 负荷风险监控（急性 ÷ 慢性）</div>
    <div class="card">
      <div class="kpi-row" style="margin-bottom:4px">
        <div class="kpi"><div class="label">当前 ACWR</div>
          <div class="value" style="color:${r.color}">${ratioText}</div><div class="sub" style="color:${r.color}">${r.zone}</div></div>
        <div class="kpi"><div class="label">急性负荷（近 7 天）</div>
          <div class="value">${r.acute}<span style="font-size:14px;color:var(--text-dim)"> AU</span></div><div class="sub">小负荷块求进步</div></div>
        <div class="kpi"><div class="label">慢性负荷（28 天周均）</div>
          <div class="value">${r.chronic}<span style="font-size:14px;color:var(--text-dim)"> AU</span></div><div class="sub">身体已经适应的水平</div></div>
      </div>
      <div style="height:190px;margin:10px 0 6px"><canvas id="chAcwr"></canvas></div>
      <div class="hint" style="margin-top:8px">${hint}</div>
      <div class="hint">* 模型：急性=近 7 天 AU 合计，慢性=近 28 天 AU ÷ 4（Gabbett 滚动平均）。规则提示非医疗建议。</div>
    </div>`;
}

/* ---------- 深度分析引擎（纯函数：可单测、可溯源、可喂 AI） ---------- */

function teamFG(g) {
  let m = 0, a = 0;
  for (const s of g.stats) if (Array.isArray(s.fg)) { m += s.fg[0]; a += s.fg[1]; }
  return { m, a, pct: a ? Math.round(m / a * 100) : null };
}
function teamTOV(g) { return g.stats.reduce((a, s) => a + s.tov, 0); }
function teamREB(g) { return g.stats.reduce((a, s) => a + s.reb, 0); }
function gameDiff(g, q) { return g.us[q] - g.them[q]; }
function contribOf(s) { return s.pts + s.reb + s.ast - s.tov; }

function deepAnalysis() {
  const games = gamesSorted();
  const n = games.length;
  if (n === 0) return null;
  const res = g => gameResult(g);
  const fpts = g => teamScore(g, 'us'), fopp = g => teamScore(g, 'them');
  const mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length;

  /* A1 胜负分野：同一指标在胜场/负场的均值差 */
  const metrics = g => ({ pts: fpts(g), opp: fopp(g), tov: teamTOV(g), reb: teamREB(g), fgPct: teamFG(g).pct });
  const W = games.filter(g => res(g) === 'win').map(metrics);
  const L = games.filter(g => res(g) === 'loss').map(metrics);
  const avgKeys = arr => arr.length ? {
    pts: +mean(arr.map(m => m.pts)).toFixed(1), opp: +mean(arr.map(m => m.opp)).toFixed(1),
    tov: +mean(arr.map(m => m.tov)).toFixed(1), reb: +mean(arr.map(m => m.reb)).toFixed(1),
    fgPct: arr.some(m => m.fgPct === null) ? null : Math.round(mean(arr.map(m => m.fgPct))),
  } : null;
  const winSplit = (W.length && L.length) ? { win: avgKeys(W), loss: avgKeys(L) } : null;

  /* A2 分节净胜：找结构性漏点 */
  const qAvg = [0, 1, 2, 3].map(q => +(mean(games.map(g => gameDiff(g, q)))).toFixed(1));
  const leakQ = qAvg.indexOf(Math.min(...qAvg));

  /* A3 上下半场：翻盘/被翻盘 */
  const halves = games.map(g => {
    const h1 = gameDiff(g, 0) + gameDiff(g, 1), h2 = gameDiff(g, 2) + gameDiff(g, 3);
    return { date: g.date, opponent: g.opponent, result: res(g), h1, h2, swing: h2 - h1 };
  });
  const comeback = halves.filter(h => h.h1 < 0 && h.result === 'win').length;
  const blown = halves.filter(h => h.h1 > 0 && h.result === 'loss').length;

  /* A4 胶着球：三节后分差 ≤5，看末节成色 */
  const closeGames = games.map(g => {
    const diff3q = gameDiff(g, 0) + gameDiff(g, 1) + gameDiff(g, 2);
    return { date: g.date, opponent: g.opponent, result: res(g), diff3q, q4: gameDiff(g, 3), margin: fpts(g) - fopp(g) };
  }).filter(x => Math.abs(x.diff3q) <= 5);

  /* A5 对手谱 */
  const opponents = {};
  for (const g of games) {
    const o = opponents[g.opponent] ||= { n: 0, w: 0, pts: 0, opp: 0 };
    o.n += 1; if (res(g) === 'win') o.w += 1;
    o.pts += fpts(g); o.opp += fopp(g);
  }
  Object.values(opponents).forEach(o => {
    o.pts = +((o.pts) / o.n).toFixed(1); o.opp = +((o.opp) / o.n).toFixed(1);
    o.diff = +(o.pts - o.opp).toFixed(1);
  });

  /* B 球员深度 */
  const nameOf = id => { const p = db.players.find(x => x.id === id); return p ? `#${p.number} ${p.name}` : '未知'; };
  const posOf = id => { const p = db.players.find(x => x.id === id); return p ? p.position : '?'; };
  const players = {};
  let tovAll = 0;
  for (const g of games) {
    const tTov = teamTOV(g); tovAll += tTov;
    for (const s of g.stats) {
      const p = players[s.playerId] ||= { name: nameOf(s.playerId), pos: posOf(s.playerId), gp: 0, pts: [], reb: [], ast: [], tov: [], contrib: [], fgM: 0, fgA: 0, dd: 0, double10: 0 };
      p.gp += 1;
      p.pts.push(s.pts); p.reb.push(s.reb); p.ast.push(s.ast); p.tov.push(s.tov);
      p.contrib.push(contribOf(s));
      if (Array.isArray(s.fg)) { p.fgM += s.fg[0]; p.fgA += s.fg[1]; }
      if (s.pts >= 10 && s.reb >= 10) p.dd += 1;
      if (s.pts >= 10) p.double10 += 1;
    }
  }
  const meanA = a => +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);
  const maxPtsAvg = Math.max(...Object.values(players).map(p => meanA(p.pts)));
  const playerRows = Object.values(players).map(p => {
    const std = a => { const m = meanA(a); return +Math.sqrt(meanA(a.map(x => (x - m) * (x - m)))).toFixed(1); };
    const tovTotal = p.tov.reduce((s, x) => s + x, 0);
    const astTotal = p.ast.reduce((s, x) => s + x, 0);
    const ptsTotal = p.pts.reduce((s, x) => s + x, 0);
    const row = {
      name: p.name, pos: p.pos, gp: p.gp,
      pts: meanA(p.pts), reb: meanA(p.reb), ast: meanA(p.ast), tov: meanA(p.tov),
      contrib: meanA(p.contrib), max: Math.max(...p.pts), min: Math.min(...p.pts), std: std(p.pts),
      astTov: tovTotal ? +(astTotal / tovTotal).toFixed(2) : null,
      tovShare: tovAll ? Math.round(tovTotal / tovAll * 100) : null,
      pps: p.fgA ? +(ptsTotal / p.fgA).toFixed(2) : null,
      fgPct: p.fgA ? Math.round(p.fgM / p.fgA * 100) : null,
      dd: p.dd, double10: p.double10, tags: [],
    };
    if (row.pts === maxPtsAvg && row.pts >= 10) row.tags.push('得分引擎');
    if (row.reb >= 7) row.tags.push('篮板支柱');
    if (row.ast >= 4) row.tags.push(row.tov >= 3.5 ? '高风险组织' : '组织核心');
    if (row.std <= 3 && row.pts >= 8) row.tags.push('稳定输出');
    if (row.max - row.pts >= 8) row.tags.push('爆发型');
    if (row.pts < 8 && row.reb + row.ast >= 6) row.tags.push('蓝领拼图');
    if (row.pps !== null && p.fgA / p.gp >= 5 && row.pps < 0.9) row.tags.push('效率警示');
    if (!row.tags.length) row.tags.push('轮换深度');
    return row;
  }).sort((a, b) => b.contrib - a.contrib);

  /* B10 双核依赖：前两得分手占全队得分比 */
  const dualCore = games.map(g => {
    const sorted = [...g.stats].sort((a, b) => b.pts - a.pts);
    const top2 = (sorted[0]?.pts || 0) + (sorted[1]?.pts || 0);
    const total = fpts(g);
    return { date: g.date, result: res(g), top2, share: total ? Math.round(top2 / total * 100) : 0 };
  });
  const dualCoreAvg = Math.round(mean(dualCore.map(x => x.share)));

  /* C1 赛前 7 天负荷 vs 比赛表现 */
  const sessions = loadSessions();
  const preGameLoad = games.map(g => {
    const cutoff = addDays(g.date, -7);
    const load = sessions.filter(s => s.date >= cutoff && s.date < g.date).reduce((a, s) => a + s.au, 0);
    return { date: g.date, opponent: g.opponent, result: res(g), margin: fpts(g) - fopp(g), tov: teamTOV(g), load: Math.round(load) };
  });

  /* D1 球队趋势：最近窗口 vs 之前窗口（窗口随样本缩放，避免小样本被均摊淹没） */
  const rN = n >= 6 ? 3 : n >= 4 ? 2 : 1;
  const earlyG = games.slice(0, n - rN), recentG = games.slice(n - rN);
  const periodOf = arr => arr.length ? {
    pts: +mean(arr.map(fpts)).toFixed(1),
    opp: +mean(arr.map(fopp)).toFixed(1),
    diff: +mean(arr.map(g => fpts(g) - fopp(g))).toFixed(1),
    tov: +mean(arr.map(teamTOV)).toFixed(1),
    fgPct: (() => { const ps = arr.map(teamFG); return ps.some(p => p.pct === null) ? null : Math.round(mean(ps.map(p => p.pct))); })(),
  } : null;
  let trendSplit = null;
  if (earlyG.length && recentG.length) {
    const early = periodOf(earlyG), recent = periodOf(recentG);
    const defs = [
      { k: '场均得分', a: early.pts, b: recent.pts, th: 3, dir: 'up' },
      { k: '场均失分', a: early.opp, b: recent.opp, th: 3, dir: 'down' },
      { k: '场均净胜', a: early.diff, b: recent.diff, th: 3, dir: 'up' },
      { k: '场均失误', a: early.tov, b: recent.tov, th: 1.5, dir: 'down' },
    ];
    if (early.fgPct !== null && recent.fgPct !== null)
      defs.push({ k: '命中率%', a: early.fgPct, b: recent.fgPct, th: 2, dir: 'up' });
    const eWr = Math.round(earlyG.filter(g => res(g) === 'win').length / earlyG.length * 100);
    const rWr = Math.round(recentG.filter(g => res(g) === 'win').length / recentG.length * 100);
    defs.push({ k: '胜率%', a: eWr, b: rWr, th: 0, dir: 'up' });
    const rows = defs.map(d => {
      const delta = +(d.b - d.a).toFixed(1);
      const flat = Math.abs(delta) <= d.th;
      const state = flat ? 'flat' : (delta > 0) === (d.dir === 'up') ? 'good' : 'bad';
      return { k: d.k, a: d.a, b: d.b, delta, state };
    });
    const goods = rows.filter(r => r.state === 'good').length;
    const bads = rows.filter(r => r.state === 'bad').length;
    const verdict = bads === 0 && goods > 0 ? '向好' : goods === 0 && bads > 0 ? '走低' : '混杂';
    trendSplit = {
      earlyN: earlyG.length, recentN: recentG.length, early, recent,
      earlyWins: earlyG.filter(g => res(g) === 'win').length,
      recentWins: recentG.filter(g => res(g) === 'win').length,
      rows, verdict,
    };
  }

  /* D2 球员轨迹：逐场得分序列 + 近 2 场贡献均值 vs 赛季均值 */
  const trajectory = Object.values(players).map(p => {
    const season = +(p.contrib.reduce((s, x) => s + x, 0) / p.contrib.length).toFixed(1);
    const rc = p.contrib.slice(-2);
    const last2 = +(rc.reduce((s, x) => s + x, 0) / rc.length).toFixed(1);
    const delta = +(last2 - season).toFixed(1);
    return {
      name: p.name, ptsSeq: p.pts, seasonContrib: season, last2Contrib: last2, delta,
      form: delta >= 2 ? '回暖' : delta <= -2 ? '下滑' : '平稳',
    };
  }).sort((a, b) => b.seasonContrib - a.seasonContrib);

  /* D3 二番战：同一对手 ≥2 次交手，逐节净胜对比（模式比单场值钱） */
  const byOpp = {};
  for (const g of games) (byOpp[g.opponent] ||= []).push(g);
  const rematches = Object.entries(byOpp)
    .filter(([, gs]) => gs.length >= 2)
    .map(([opponent, gs]) => ({
      opponent,
      games: gs.map(g => ({
        date: g.date, us: fpts(g), them: fopp(g), result: res(g),
        qDiff: [0, 1, 2, 3].map(q => gameDiff(g, q)),
      })),
    }));

  return { n, winSplit, qAvg, leakQ, halves, comeback, blown, closeGames, opponents, playerRows, dualCore, dualCoreAvg, preGameLoad, trendSplit, trajectory, rematches };
}

function renderDeepAnalysis(main) {
  const d = deepAnalysis();
  if (!d || d.n === 0) { main.innerHTML = emptyState(); return; }
  const diffCell = v => { const s = v > 0 ? '+' : ''; return `<td style="color:${v > 0 ? '#34d399' : v < 0 ? '#f87171' : 'var(--text-dim)'}">${s}${v}</td>`; };

  let a1 = '<div class="hint">样本里胜场与负场并存才能对比</div>';
  if (d.winSplit) {
    const { win, loss } = d.winSplit;
    const rows = [['得分', win.pts, loss.pts], ['失分', win.opp, loss.opp], ['失误', win.tov, loss.tov], ['篮板', win.reb, loss.reb]];
    if (win.fgPct !== null) rows.push(['命中率%', win.fgPct, loss.fgPct]);
    a1 = `<div class="card table-wrap"><table>
      <thead><tr><th style="text-align:left">指标</th><th>胜场均值</th><th>负场均值</th><th>差值</th></tr></thead>
      <tbody>${rows.map(([k, w, l]) => {
        const dd = k === '失分' ? +(l - w).toFixed(1) : +(w - l).toFixed(1);
        const good = k === '失分' ? dd < 0 : dd > 0;
        const color = dd === 0 ? 'var(--text-dim)' : good ? '#34d399' : '#f87171';
        return `<tr><td class="name">${k}</td><td>${w}</td><td>${l}</td><td style="color:${color}">${dd > 0 ? '+' : ''}${dd}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="hint">差值为「负场 − 胜场」：失误/失分为正 = 负场更多，得分/篮板/命中率为正 = 胜场更强。</div>`;
  }

  const qCell = i => {
    const v = d.qAvg[i];
    const isLeak = i === d.leakQ && v < 0;
    return `<td style="color:${v > 0 ? '#34d399' : v < 0 ? '#f87171' : 'var(--text-dim)'};font-weight:${isLeak ? 700 : 400}">${v > 0 ? '+' : ''}${v}${isLeak ? ' ⚠' : ''}</td>`;
  };

  let a4 = `<div class="hint">三节后分差 ≤5 的比赛才计入「胶着球」</div>`;
  if (d.closeGames.length) {
    a4 = `<div class="card table-wrap"><table>
      <thead><tr><th style="text-align:left">日期</th><th style="text-align:left">对手</th><th>三节后分差</th><th>末节净胜</th><th>结果</th></tr></thead>
      <tbody>${d.closeGames.map(x => `<tr><td class="name">${esc(x.date)}</td><td style="text-align:left">${esc(x.opponent)}</td>${diffCell(x.diff3q)}${diffCell(x.q4)}<td>${x.result === 'win' ? '✅ 胜' : '❌ 负'}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  let a5 = `<div class="hint">还没有对手记录</div>`;
  a5 = `<div class="card table-wrap"><table>
    <thead><tr><th style="text-align:left">对手</th><th>场次</th><th>战绩</th><th>场均得分</th><th>场均失分</th><th>净胜</th></tr></thead>
    <tbody>${Object.entries(d.opponents).map(([name, o]) => `<tr><td class="name">${esc(name)}</td><td>${o.n}</td><td>${o.w}胜${o.n - o.w}负</td><td>${o.pts}</td><td>${o.opp}</td>${diffCell(o.diff)}</tr>`).join('')}</tbody>
  </table></div>`;

  let b1 = `<div class="hint">还没有球员统计</div>`;
  if (d.playerRows.length) {
    b1 = `<div class="card table-wrap"><table>
      <thead><tr><th style="text-align:left">球员</th><th>位置</th><th>出场</th><th>贡献值</th><th>得分</th><th>篮板</th><th>助攻</th><th>失误</th><th style="text-align:left">角色画像</th></tr></thead>
      <tbody>${d.playerRows.map((p, i) => `<tr><td class="name">${i + 1}. ${esc(p.name)}</td><td>${p.pos}</td><td>${p.gp}</td><td><b>${p.contrib}</b></td><td>${p.pts}</td><td>${p.reb}</td><td>${p.ast}</td><td>${p.tov}</td><td style="text-align:left">${p.tags.map(t => `<span class="badge ${t === '得分引擎' || t === '组织核心' ? 'accent' : 'gray'}">${t}</span>`).join(' ')}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="hint">贡献值 = 得分 + 篮板 + 助攻 − 失误（简化综合指标，非正式正负值）。</div>`;
  }

  const b2 = `<div class="card table-wrap"><table>
    <thead><tr><th style="text-align:left">球员</th><th>场均分</th><th>最高</th><th>最低</th><th>波动σ</th><th>每出手得分</th><th>命中率%</th><th>助/失</th><th>失误占全队</th><th>上双</th><th>两双</th></tr></thead>
    <tbody>${d.playerRows.map(p => `<tr><td class="name">${esc(p.name)}</td><td>${p.pts}</td><td>${p.max}</td><td>${p.min}</td><td>${p.std}</td><td>${p.pps ?? '-'}</td><td>${p.fgPct === null ? '-' : p.fgPct + '%'}</td><td>${p.astTov ?? '-'}</td><td>${p.tovShare}%</td><td>${p.double10}场</td><td>${p.dd}场</td></tr>`).join('')}</tbody>
  </table></div>
  <div class="hint">波动σ = 得分标准差，越小越稳定；每出手得分（PPS）≥1.0 为高效线。样本仅 ${d.n} 场，波动与角色为方向性参考。</div>`;

  let c1 = `<div class="hint">还没有比赛记录</div>`;
  c1 = `<div class="card table-wrap"><table>
    <thead><tr><th style="text-align:left">日期</th><th style="text-align:left">对手</th><th>赛前 7 天负荷</th><th>结果</th><th>净胜</th><th>全队失误</th></tr></thead>
    <tbody>${d.preGameLoad.map(x => `<tr><td class="name">${esc(x.date)}</td><td style="text-align:left">${esc(x.opponent)}</td><td>${x.load} AU</td><td>${x.result === 'win' ? '✅ 胜' : '❌ 负'}</td>${diffCell(x.margin)}<td>${x.tov}</td></tr>`).join('')}</tbody>
  </table></div>
  <div class="hint">样本 ${d.n} 场，仅作方向性观察；负荷 = 比赛日之前 7 天内的训练+比赛 AU 合计。</div>`;

  /* D1 球队趋势 */
  let d1 = `<div class="hint">至少 2 场比赛才能对比趋势</div>`;
  if (d.trendSplit) {
    const t = d.trendSplit;
    const fmtCell = (k, v) => {
      if (k === '命中率%' || k === '胜率%') return v + '%';
      if (k === '场均净胜') return (v > 0 ? '+' : '') + v;
      return v;
    };
    const body = t.rows.map(r => {
      const color = r.state === 'flat' ? 'var(--text-dim)' : r.state === 'good' ? '#34d399' : '#f87171';
      const arrow = r.state === 'flat' ? '→' : r.delta > 0 ? '↑' : '↓';
      const unit = (r.k === '命中率%' || r.k === '胜率%') ? 'pp' : '';
      const dTxt = (r.delta > 0 ? '+' : '') + r.delta + unit;
      return `<tr><td class="name">${r.k}</td><td>${fmtCell(r.k, r.a)}</td><td>${fmtCell(r.k, r.b)}</td><td style="color:${color}">${dTxt} ${arrow}</td></tr>`;
    }).join('');
    const vIcon = t.verdict === '向好' ? '✅' : t.verdict === '走低' ? '⚠' : '↕';
    d1 = `<div class="card table-wrap"><table>
      <thead><tr><th style="text-align:left">指标</th><th>之前 ${t.earlyN} 场</th><th>最近 ${t.recentN} 场</th><th>变化</th></tr></thead>
      <tbody>${body}</tbody></table></div>
      <div class="hint">${vIcon} <b>近期${t.verdict}</b>（之前 ${t.earlyN} 场 vs 最近 ${t.recentN} 场，窗口小，看方向不看点）</div>`;
  }

  /* D2 球员轨迹 */
  const chip = (v, i, last) => `<span style="display:inline-block;min-width:24px;text-align:center;padding:1px 6px;border-radius:9px;margin:0 1px;font-size:12px;${i === last ? 'background:rgba(249,115,22,0.18);color:#f97316;font-weight:700' : 'background:rgba(255,255,255,0.06);color:var(--text-dim)'}">${v}</span>`;
  const d2 = d.trajectory.length ? `<div class="card table-wrap"><table>
    <thead><tr><th style="text-align:left">球员</th><th style="text-align:left">得分轨迹（按场次）</th><th>近2场贡献</th><th>赛季贡献</th><th>Δ</th><th>状态</th></tr></thead>
    <tbody>${d.trajectory.map(p => {
      const c = p.delta >= 2 ? '#34d399' : p.delta <= -2 ? '#f87171' : 'var(--text-dim)';
      const mark = p.form === '回暖' ? '↑ 回暖' : p.form === '下滑' ? '↓ 下滑' : '→ 平稳';
      return `<tr><td class="name">${esc(p.name)}</td>
        <td style="text-align:left;white-space:nowrap">${p.ptsSeq.map((v, i) => chip(v, i, p.ptsSeq.length - 1)).join('<span style="color:#565e73">›</span>')}</td>
        <td>${p.last2Contrib}</td><td>${p.seasonContrib}</td>
        <td style="color:${c}">${p.delta > 0 ? '+' : ''}${p.delta}</td>
        <td style="color:${c}">${mark}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="hint">贡献值 = 得分+篮板+助攻−失误；状态阈值 |Δ|≥2。样本小时近 2 场与赛季均值高度重叠，以轨迹 chips 为主。</div>`
    : `<div class="hint">还没有球员统计</div>`;

  /* D3 二番战 */
  let d3 = `<div class="hint">暂无交手 ≥2 次的对手 —— 联赛进入循环赛后这里自动出现二番战对比</div>`;
  if (d.rematches.length) {
    d3 = d.rematches.map(r => `
      <div class="card table-wrap" style="margin-bottom:10px">
        <div class="hint" style="margin:10px 0 4px"><b>vs ${esc(r.opponent)}</b>（${r.games.length} 次交手 · 逐节净胜变化 = 对手的针对性调整）</div>
        <table>
          <thead><tr><th style="text-align:left">日期</th><th>Q1净胜</th><th>Q2净胜</th><th>Q3净胜</th><th>Q4净胜</th><th>比分</th><th>结果</th></tr></thead>
          <tbody>
            ${r.games.map(g => `<tr><td class="name">${esc(g.date)}</td>${g.qDiff.map(v => diffCell(v)).join('')}<td>${g.us}:${g.them}</td><td>${g.result === 'win' ? '✅' : g.result === 'loss' ? '❌' : '➖'}</td></tr>`).join('')}
            <tr><td class="name" style="color:var(--text-dim)">末场 − 首场</td>${[0, 1, 2, 3].map(q => diffCell(r.games[r.games.length - 1].qDiff[q] - r.games[0].qDiff[q])).join('')}<td colspan="2"></td></tr>
          </tbody>
        </table>
      </div>`).join('');
  }

  const dualRows = d.dualCore.map(x => `<span style="color:${x.share >= 50 ? '#f87171' : '#d1d5db'}">${x.date.slice(5)}：${x.share}%（${x.result === 'win' ? '胜' : '负'}）</span>`).join(' ｜ ');
  const dualJudge = d.dualCoreAvg >= 55 ? '⚠ 双核依赖偏高——得分点过于集中' : '✓ 得分点相对分散';

  main.innerHTML = `
    <div class="hint" style="margin-bottom:14px">深度分析 · 全部指标由「${d.n} 场比赛 + ${db.trainings.length} 次训练」的录入数据实时计算，可溯源、无人工修饰。样本 ${d.n < 5 ? '较小（<5 场），结论看方向不看点' : '具备参考价值'}。</div>

    <div class="section-title">A · 胜负解密</div>
    <div class="hint" style="margin:4px 0 6px">A1 胜负分野：赢和输的时候，我们到底差在哪</div>
    ${a1}
    <div class="hint" style="margin:12px 0 6px">A2 分节净胜（场均，正值好）—— <b style="color:#f87171">Q${d.leakQ + 1} 为结构性漏点（场均 ${d.qAvg[d.leakQ] > 0 ? '+' : ''}${d.qAvg[d.leakQ]}）</b></div>
    <div class="card"><table style="width:100%;text-align:center"><thead><tr><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead><tbody><tr>${[0,1,2,3].map(qCell).join('')}</tr></tbody></table></div>
    <div class="hint" style="margin:12px 0 6px">A3 上下半场：翻盘 ${d.comeback} 次 · 被翻盘 ${d.blown} 次</div>
    <div class="card table-wrap"><table>
      <thead><tr><th style="text-align:left">日期</th><th style="text-align:left">对手</th><th>上半场净胜</th><th>下半场净胜</th><th>摆幅</th><th>结果</th></tr></thead>
      <tbody>${d.halves.map(h => `<tr><td class="name">${esc(h.date)}</td><td style="text-align:left">${esc(h.opponent)}</td>${diffCell(h.h1)}${diffCell(h.h2)}${diffCell(h.swing)}<td>${h.result === 'win' ? '✅ 胜' : '❌ 负'}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="hint" style="margin:12px 0 6px">A4 胶着球（三节后 ≤5 分）—— 末节成色</div>
    ${a4}
    <div class="hint" style="margin:12px 0 6px">A5 对手谱</div>
    ${a5}

    <div class="section-title" style="margin-top:18px">B · 球员深度</div>
    <div class="hint" style="margin:4px 0 6px">B1 综合贡献榜（贡献值 = 得分+篮板+助攻−失误）</div>
    ${b1}
    <div class="hint" style="margin:12px 0 6px">B2 稳定性 / 效率 / 助失比 / 上双两双</div>
    ${b2}
    <div class="hint" style="margin:12px 0 6px">B3 双核依赖（前两得分手占全队得分%）—— 场均 <b>${d.dualCoreAvg}%</b>，${dualJudge}</div>
    <div class="card"><div class="hint" style="line-height:2">${dualRows}</div></div>

    <div class="section-title" style="margin-top:18px">C · 训练联动</div>
    <div class="hint" style="margin:4px 0 6px">C1 赛前负荷 vs 比赛表现（负荷-表现关系，样本小时只看方向）</div>
    ${c1}

    <div class="section-title" style="margin-top:18px">D · 趋势与模式</div>
    <div class="hint" style="margin:4px 0 6px">D1 球队趋势：我们最近是在变强还是变弱（前后窗口对比，指标由引擎判定）</div>
    ${d1}
    <div class="hint" style="margin:12px 0 6px">D2 球员轨迹：谁的手感在上升、谁在下滑</div>
    ${d2}
    <div class="hint" style="margin:12px 0 6px">D3 二番战：同对手再次交手的逐节模式（「模式」比单场更值钱）</div>
    ${d3}
  `;
}

/* ---------- 渲染入口 ---------- */

function render() {
  charts.forEach(c => c.destroy());
  charts = [];
  const main = $('#main');
  if (currentTab === 'dashboard') renderDashboard(main);
  if (currentTab === 'deep')      renderDeepAnalysis(main);
  if (currentTab === 'games')     renderGames(main);
  if (currentTab === 'training')  renderTraining(main);
  if (currentTab === 'entry')     renderEntry(main);
  if (currentTab === 'report')    renderReport(main);
}

function setTab(tab) {
  currentTab = tab;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

/* ---------- Tab 1 · 数据看板 ---------- */

function renderDashboard(main) {
  const games = gamesSorted();
  if (games.length === 0) { main.innerHTML = emptyState(); return; }

  const wins = games.filter(g => gameResult(g) === 'win').length;
  const losses = games.filter(g => gameResult(g) === 'loss').length;
  const avgPts = games.reduce((s, g) => s + teamScore(g, 'us'), 0) / games.length;
  const avgOpp = games.reduce((s, g) => s + teamScore(g, 'them'), 0) / games.length;
  const avgTov = games.reduce((s, g) => s + g.stats.reduce((a, x) => a + x.tov, 0), 0) / games.length;
  const last = games[games.length - 1];
  const lastRes = gameResult(last);

  const totals = playerTotals();

  main.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="label">战绩</div>
        <div class="value">${wins}胜${losses}负</div>
        <div class="sub">近 ${games.length} 场</div></div>
      <div class="kpi"><div class="label">场均得分</div>
        <div class="value" style="color:var(--accent)">${fmt1(avgPts)}</div>
        <div class="sub">失分 ${fmt1(avgOpp)}</div></div>
      <div class="kpi"><div class="label">场均失误</div>
        <div class="value ${avgTov > 15 ? 'loss' : ''}">${fmt1(avgTov)}</div>
        <div class="sub">全场紧逼是主要诱因</div></div>
      <div class="kpi"><div class="label">最近一场</div>
        <div class="value ${lastRes}">${lastRes === 'win' ? '胜' : lastRes === 'loss' ? '负' : '平'}</div>
        <div class="sub">${esc(last.date)} vs ${esc(last.opponent)}</div></div>
      <div class="kpi"><div class="label">近 7 天训练负荷</div>
        <div class="value">${Math.round(loadLast7Days())}<span style="font-size:14px;color:var(--text-dim)"> AU</span></div>
        <div class="sub">sRPE 法·比赛按估算计</div></div>
    </div>

    <div class="chart-box"><h3>每场得分 / 失分</h3><div class="chart-wrap"><canvas id="chScore"></canvas></div></div>

    <div class="chart-grid">
      <div class="chart-box"><h3>四节得分趋势（场均）</h3><div class="chart-wrap"><canvas id="chQuarters"></canvas></div></div>
      <div class="chart-box"><h3>失误与命中率走势</h3><div class="chart-wrap"><canvas id="chTov"></canvas></div></div>
    </div>

    <div class="section-title">球员数据榜</div>
    <div class="card table-wrap">
      <table>
        <thead><tr>
          <th style="text-align:left">球员</th><th>出场</th><th>总分</th><th>场均分</th>
          <th>篮板</th><th>助攻</th><th>失误</th><th>命中率</th>
        </tr></thead>
        <tbody>
          ${totals.map((r, i) => `
            <tr class="${i === 0 && r.pts > 0 ? 'highlight' : ''}">
              <td class="name">#${r.player.number} ${esc(r.player.name)}<span class="badge gray" style="margin-left:6px">${r.player.position}</span></td>
              <td>${r.gp}</td><td><b>${r.pts}</b></td><td>${r.gp ? fmt1(r.pts / r.gp) : '-'}</td>
              <td>${r.reb}</td><td>${r.ast}</td><td>${r.tov}</td>
              <td>${r.fga ? Math.round(r.fgm / r.fga * 100) + '%' : '<span style="color:var(--text-dim)">未录</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  const labels = games.map(g => `${g.date.slice(5)} ${g.opponent}`);

  charts.push(new Chart($('#chScore'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '我方', data: games.map(g => teamScore(g, 'us')), backgroundColor: 'rgba(249,115,22,0.85)', borderRadius: 6 },
        { label: '对方', data: games.map(g => teamScore(g, 'them')), backgroundColor: 'rgba(154,163,178,0.4)', borderRadius: 6 },
      ],
    },
    options: chartOpts(),
  }));

  const qUs = [0, 1, 2, 3].map(q => games.reduce((s, g) => s + g.us[q], 0) / games.length);
  const qThem = [0, 1, 2, 3].map(q => games.reduce((s, g) => s + g.them[q], 0) / games.length);
  charts.push(new Chart($('#chQuarters'), {
    type: 'line',
    data: {
      labels: QUARTER_LABELS,
      datasets: [
        { label: '我方场均', data: qUs, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.15)', fill: true, tension: 0.3 },
        { label: '对方场均', data: qThem, borderColor: '#9aa3b2', tension: 0.3, borderDash: [5, 5] },
      ],
    },
    options: chartOpts(),
  }));

  const tovPerGame = games.map(g => g.stats.reduce((a, x) => a + x.tov, 0));
  const fgPct = games.map(g => {
    const m = g.stats.reduce((a, s) => a + (s.fg ? s.fg[0] : 0), 0);
    const att = g.stats.reduce((a, s) => a + (s.fg ? s.fg[1] : 0), 0);
    return att ? Math.round(m / att * 100) : null;
  });
  charts.push(new Chart($('#chTov'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '全队失误', data: tovPerGame, borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.15)', fill: true, tension: 0.3, yAxisID: 'y' },
        { label: '投篮命中率%', data: fgPct, borderColor: '#34d399', tension: 0.3, yAxisID: 'y1', spanGaps: true },
      ],
    },
    options: chartOpts({
      scales: {
        y: { beginAtZero: true, title: { display: true, text: '失误' } },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '命中率%' } },
      },
    }),
  }));
}

function chartOpts(extra = {}) {
  Chart.defaults.color = '#9aa3b2';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
  return {
    responsive: true,
    maintainAspectRatio: false,
    ...extra,
  };
}

/* ---------- Tab 2 · 比赛记录 ---------- */

function renderGames(main) {
  const games = gamesSorted().reverse();   // 最新在上
  if (games.length === 0) { main.innerHTML = emptyState(); return; }

  main.innerHTML = `
    <div class="hint">点卡片展开该场球员统计</div>
    ${games.map(g => {
      const res = gameResult(g);
      const us = teamScore(g, 'us'), them = teamScore(g, 'them');
      return `
      <div class="card game-card" data-id="${g.id}">
        <div class="game-head">
          <span class="date">${esc(g.date)}</span>
          <span class="opponent">vs ${esc(g.opponent)}</span>
          <span class="badge ${res}">${res === 'win' ? '胜' : res === 'loss' ? '负' : '平'} ${us > them ? '+' : ''}${us - them}</span>
          <span class="score"><span class="score us">${us}</span> : ${them}</span>
          <span class="chevron">▾</span>
        </div>
        <div class="game-quarters">各节 ${g.us.join('-')} ｜ 对方 ${g.them.join('-')}</div>
        ${g.review ? `<div class="game-review">📝 ${esc(g.review)}</div>` : ''}
        <div class="game-detail table-wrap">
          <table>
            <thead><tr><th style="text-align:left">球员</th><th>得分</th><th>篮板</th><th>助攻</th><th>失误</th><th>投篮</th></tr></thead>
            <tbody>
              ${g.stats.map(s => {
                const p = db.players.find(x => x.id === s.playerId);
                if (!p) return '';
                return `<tr>
                  <td class="name">#${p.number} ${esc(p.name)}</td>
                  <td><b>${s.pts}</b></td><td>${s.reb}</td><td>${s.ast}</td><td>${s.tov}</td>
                  <td>${Array.isArray(s.fg) ? `${s.fg[0]}/${s.fg[1]}` : '-'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('')}
  `;

  $$('.game-card', main).forEach(card => {
    card.addEventListener('click', () => card.classList.toggle('open'));
  });
}

/* ---------- Tab 3 · 训练负荷 ---------- */

function renderTraining(main) {
  const sessions = loadSessions().reverse();   // 最新在上
  const maxAu = Math.max(...sessions.map(s => s.au), 1);

  main.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="label">近 7 天总负荷</div>
        <div class="value">${Math.round(loadLast7Days())}<span style="font-size:14px;color:var(--text-dim)"> AU</span></div>
        <div class="sub">sRPE = 强度×分钟÷10</div></div>
      <div class="kpi"><div class="label">训练次数</div>
        <div class="value">${db.trainings.length}</div><div class="sub">不含比赛</div></div>
      <div class="kpi"><div class="label">负荷最高单元</div>
        <div class="value">${Math.round(maxAu)}<span style="font-size:14px;color:var(--text-dim)"> AU</span></div>
        <div class="sub">${esc(sessions.length ? sessions.reduce((a, b) => a.au > b.au ? a : b).label : '-')}</div></div>
    </div>

    ${acwrCard()}

    <div class="section-title">单元负荷（比赛按 强度5×90min 估算）</div>
    <div class="card">
      ${sessions.map(s => `
        <div class="load-bar-row">
          <span class="who">${esc(s.date)} · ${esc(s.label)}</span>
          <div class="bar"><div style="width:${Math.round(s.au / maxAu * 100)}%"></div></div>
          <span class="au">${s.au} AU${s.est ? ' *' : ''}</span>
        </div>`).join('') || '<div class="hint">还没有训练记录</div>'}
      <div class="hint" style="margin-top:8px">* 估算值。负荷监控的意义：大负荷日（如 48AU 队练）后 48 小时内，控制额外跳跃量 —— 对应膝盖状态管理。</div>
    </div>

    ${kneeCrossCard(loadSessions())}

    <div class="section-title">训练明细</div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th style="text-align:left">日期</th><th>类型</th><th>强度(RPE)</th><th>时长</th><th>负荷AU</th><th>膝盖</th><th style="text-align:left">备注</th></tr></thead>
        <tbody>
          ${[...db.trainings].sort((a, b) => b.date.localeCompare(a.date)).map(t => `
            <tr>
              <td class="name">${esc(t.date)}</td>
              <td><span class="badge ${t.type === '队练' ? 'accent' : 'gray'}">${esc(t.type)}</span></td>
              <td>${t.intensity}</td><td>${t.minutes}min</td><td>${sessionLoad(t)}</td>
              <td>${t.knee ? kneeMark(t.knee) : '-'}</td>
              <td style="text-align:left;white-space:normal">${esc(t.note || '-')}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="hint">暂无</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const series28 = dailyLoadSeries(28);
  charts.push(new Chart($('#chAcwr'), {
    type: 'bar',
    data: {
      labels: series28.map(d => d.date.slice(5)),
      datasets: [
        { label: '日负荷 AU', data: series28.map(d => d.au), backgroundColor: 'rgba(249,115,22,0.7)', borderRadius: 3 },
        { label: '急性（7 天合计）', data: rollingLoads(series28, 7, 1), type: 'line', borderColor: '#facc15', borderWidth: 2, tension: 0.3, spanGaps: true, pointRadius: 0 },
        { label: '慢性（28 天周均）', data: rollingLoads(series28, 28, 4), type: 'line', borderColor: '#9aa3b2', borderDash: [5, 5], borderWidth: 2, tension: 0.3, spanGaps: true, pointRadius: 0 },
      ],
    },
    options: chartOpts({ scales: { y: { beginAtZero: true, title: { display: true, text: 'AU' } } } }),
  }));
}

/* ---------- Tab 4 · 赛后录入 ---------- */

function renderEntry(main) {
  const today = new Date().toISOString().slice(0, 10);

  main.innerHTML = `
    <div class="section-title">录一场比赛</div>
    <div class="hint">设计目标：一个人、赛后 5 分钟录完。带 * 为必填，其余可以留空。</div>
    <div class="card">
      <div class="form-grid">
        <div class="field"><label>比赛日期 *</label><input type="date" id="fDate" value="${today}"></div>
        <div class="field"><label>对手 *</label><input id="fOpp" placeholder="如：联合书院二队"></div>
      </div>
      <div class="form-grid">
        ${[0, 1, 2, 3].map(q => `
          <div class="field"><label>我方第${q + 1}节</label><input type="number" min="0" id="fUs${q}" placeholder="0"></div>`).join('')}
        ${[0, 1, 2, 3].map(q => `
          <div class="field"><label>对方第${q + 1}节</label><input type="number" min="0" id="fThem${q}" placeholder="0"></div>`).join('')}
      </div>
      <div class="field"><label>比赛回顾（口述即可，AI 报告的重要原料）</label>
        <textarea id="fReview" placeholder="例：第三节被紧逼打崩，失误太多；阿伦最后两罚锁定胜局……"></textarea></div>

      <div class="section-title">球员统计（没出场的留空整行即可）</div>
      <div class="table-wrap">
        <table class="stats-matrix">
          <thead><tr><th style="text-align:left">球员</th><th>得分</th><th>篮板</th><th>助攻</th><th>失误</th><th>命中</th><th>出手</th></tr></thead>
          <tbody>
            ${db.players.map(p => `
              <tr data-pid="${p.id}">
                <td class="name">#${p.number} ${esc(p.name)}</td>
                ${['pts', 'reb', 'ast', 'tov', 'fgm', 'fga'].map(k => `<td><input type="number" min="0" data-k="${k}"></td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="btn-row">
        <button class="btn" id="btnSaveGame">保存比赛</button>
        <span class="save-msg" id="gameMsg">✓ 已保存，可在「比赛记录」查看</span>
      </div>
    </div>

    <div class="section-title">记一次训练</div>
    <div class="card">
      <div class="form-grid">
        <div class="field"><label>日期</label><input type="date" id="tDate" value="${today}"></div>
        <div class="field"><label>类型</label>
          <select id="tType"><option>队练</option><option>力量</option><option>核心</option></select></div>
        <div class="field"><label>主观强度 RPE (1-5)</label>
          <select id="tInt">${[1, 2, 3, 4, 5].map(i => `<option ${i === 4 ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
        <div class="field"><label>时长（分钟）</label><input type="number" min="0" id="tMin" value="120"></div>
        <div class="field"><label>膝盖反馈（记录人·选填）</label>
          <select id="tKnee"><option value="">不填</option><option>好</option><option>酸</option><option>痛</option></select></div>
      </div>
      <div class="field"><label>备注</label><input id="tNote" placeholder="练了什么"></div>
      <div class="btn-row">
        <button class="btn" id="btnSaveTraining">保存训练</button>
        <span class="save-msg" id="trainMsg">✓ 已保存</span>
      </div>
    </div>

    <div class="section-title">球员管理</div>
    <div class="card">
      <div class="form-grid">
        <div class="field"><label>姓名</label><input id="pName" placeholder="如：阿强"></div>
        <div class="field"><label>号码</label><input type="number" min="0" max="99" id="pNum" placeholder="23"></div>
        <div class="field"><label>位置</label>
          <select id="pPos"><option>PG</option><option>SG</option><option>SF</option><option>PF</option><option>C</option></select></div>
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="btnAddPlayer">＋ 添加球员</button>
      </div>
    </div>

    <div class="section-title">数据管理</div>
    <div class="card">
      <div class="hint">数据保存在本浏览器 localStorage。建议定期导出 JSON 备份；导出文件也是 M2 AI 管线的标准交换格式。</div>
      <div class="btn-row">
        <button class="btn ghost" id="btnExport">⬇️ 导出全部数据 JSON</button>
        <button class="btn ghost" id="btnLoadSample">载入示例数据</button>
        <button class="btn danger" id="btnClear">清空全部数据</button>
      </div>
    </div>
  `;

  $('#btnSaveGame').addEventListener('click', saveGame);
  $('#btnSaveTraining').addEventListener('click', saveTraining);
  $('#btnAddPlayer').addEventListener('click', addPlayer);
  $('#btnExport').addEventListener('click', exportJSON);
  $('#btnLoadSample').addEventListener('click', () => { db = loadSample(); render(); });
  $('#btnClear').addEventListener('click', () => {
    if (confirm('确定清空全部数据？此操作不可撤销。')) { db = clearAll(); setTab('dashboard'); }
  });
}

function saveGame() {
  const date = $('#fDate').value, opp = $('#fOpp').value.trim();
  const us = [0, 1, 2, 3].map(q => +$('#fUs' + q).value || 0);
  const them = [0, 1, 2, 3].map(q => +$('#fThem' + q).value || 0);
  if (!date || !opp) { alert('日期和对手是必填项'); return; }
  if (teamScore({ us }, 'us') === 0 && teamScore({ them }, 'them') === 0) {
    alert('四节得分全为 0，请检查是否漏录'); return;
  }

  const stats = [];
  $$('.stats-matrix tbody tr').forEach(tr => {
    const get = k => +$(`[data-k="${k}"]`, tr).value || 0;
    const fgm = get('fgm'), fga = get('fga');
    const row = {
      playerId: tr.dataset.pid,
      pts: get('pts'), reb: get('reb'), ast: get('ast'), tov: get('tov'),
    };
    const hasAny = row.pts || row.reb || row.ast || row.tov || fgm || fga;
    if (!hasAny) return;                       // 整行留空 = 没出场
    if (fga > 0) row.fg = [fgm, fga];          // 只录了出手没命中数则忽略投篮
    stats.push(row);
  });

  db.games.push({
    id: newId('g'), date, opponent: opp, us, them,
    review: $('#fReview').value.trim(), stats,
  });
  saveDB(db);
  $('#gameMsg').style.display = 'inline';
  setTimeout(() => { $('#gameMsg').style.display = 'none'; render(); }, 900);
}

function saveTraining() {
  db.trainings.push({
    id: newId('t'),
    date: $('#tDate').value || new Date().toISOString().slice(0, 10),
    type: $('#tType').value,
    intensity: +$('#tInt').value,
    minutes: +$('#tMin').value || 0,
    note: $('#tNote').value.trim(),
    knee: $('#tKnee').value || undefined,
  });
  saveDB(db);
  $('#trainMsg').style.display = 'inline';
  setTimeout(() => { $('#trainMsg').style.display = 'none'; render(); }, 900);
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bsa_data_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function addPlayer() {
  const name = $('#pName').value.trim();
  const num = +$('#pNum').value;
  if (!name || !num) { alert('姓名和号码都要填'); return; }
  if (db.players.some(p => p.number === num)) { alert(`号码 ${num} 已被占用`); return; }
  db.players.push({ id: newId('p'), name, number: num, position: $('#pPos').value });
  saveDB(db);
  render();   // 重渲染后录入矩阵里立刻出现新球员
}

/* ---------- Tab 5 · AI 报告（M2：真实大模型生成） ----------
 * 架构：自带密钥（BYO-key）——key 只存用户浏览器 localStorage，
 * 仓库零密钥、零服务器成本。Z.ai / DeepSeek 官方接口允许浏览器跨域
 * （已实测），智谱国内站不允许跨域，需走自定义中转地址。
 * 报告质量约束写在系统提示词里：数字必须来自录入数据，缺失写「数据不足」。
 */

const AI_PROVIDERS = {
  zai: {
    name: 'GLM · Z.ai（推荐，浏览器直连）',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    model: 'glm-5.3-flash', note: '',
  },
  deepseek: {
    name: 'DeepSeek（浏览器直连）',
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat', note: '',
  },
  bigmodel: {
    name: 'GLM · 智谱国内站（跨域受限，需中转）',
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-5.3-flash',
    note: '⚠️ 该域名不允许浏览器跨域直连。请先部署中转（如 Cloudflare Worker），再把中转地址填入「接口地址」。',
  },
  custom: {
    name: '自定义（OpenAI 兼容接口 / 中转）',
    url: '', model: '',
    note: '填完整的 chat/completions 接口地址与模型名。',
  },
};

let aiReport = null;   // 最近一次生成的报告对象（刷新后消失，可重新生成）
let aiMeta = null;     // { model, at, gameLabel, gameId }

function loadAISettings() {
  try {
    const s = JSON.parse(localStorage.getItem('bsa_ai_settings'));
    if (s && typeof s === 'object') return s;
  } catch (e) { /* 损坏则重置 */ }
  return { provider: 'zai', model: '', baseUrl: '', apiKey: '' };
}

function saveAISettings(s) {
  localStorage.setItem('bsa_ai_settings', JSON.stringify(s));
}

function renderReport(main) {
  const games = gamesSorted().reverse();          // 最新在上
  if (games.length === 0) { main.innerHTML = emptyState(); return; }
  const s = loadAISettings();
  const preset = AI_PROVIDERS[s.provider] || AI_PROVIDERS.zai;

  main.innerHTML = `
    <div class="section-title">AI 赛后报告</div>
    <div class="hint">选一场比赛，由大模型按固定框架生成：本场 MVP / 关键洞察 / 训练建议。报告中的数字被提示词约束为只能来自录入数据。</div>

    <details class="card ai-settings" ${s.apiKey ? '' : 'open'}>
      <summary>⚙️ 模型设置（自带密钥 · 只存本浏览器，不上传、不入仓库）</summary>
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label>服务商</label>
          <select id="aiProvider">
            ${Object.entries(AI_PROVIDERS).map(([k, v]) =>
              `<option value="${k}" ${s.provider === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>模型</label>
          <input id="aiModel" value="${esc(s.model || preset.model)}" placeholder="${esc(preset.model)}"></div>
        <div class="field"><label>接口地址</label>
          <input id="aiUrl" value="${esc(s.baseUrl || preset.url)}" placeholder="${esc(preset.url)}"></div>
        <div class="field"><label>API Key</label>
          <input id="aiKey" type="password" value="${esc(s.apiKey || '')}" placeholder="粘贴你的 API Key"></div>
      </div>
      <div class="hint">${esc(preset.note || 'Key 只保存在本浏览器 localStorage；请勿在公共电脑上保存。')}</div>
      <div class="btn-row">
        <button class="btn ghost" id="btnSaveAI">保存设置</button>
        <span class="save-msg" id="aiMsg">✓ 已保存</span>
      </div>
    </details>

    <div class="card">
      <div class="form-grid">
        <div class="field"><label>分析哪一场？</label>
          <select id="aiGame">
            ${games.map(g => `<option value="${g.id}" ${aiMeta && aiMeta.gameId === g.id ? 'selected' : ''}>${esc(g.date)} vs ${esc(g.opponent)}</option>`).join('')}
          </select></div>
      </div>
      <div class="btn-row">
        <button class="btn" id="btnGen">🤖 生成 AI 报告</button>
        <button class="btn ghost" id="btnSample">查看示例版式</button>
        <button class="btn ghost" id="btnCard">📤 生成战报卡</button>
      </div>
      <div class="ai-status" id="aiStatus" style="display:none"></div>
      <div id="cardPreview" style="margin-top:14px"></div>
    </div>

    <div id="aiReportArea">${aiReport ? renderAIReport(aiReport, aiMeta) : renderSampleReport()}</div>
  `;

  $('#btnSaveAI').addEventListener('click', () => {
    saveAISettings({
      provider: $('#aiProvider').value,
      model: $('#aiModel').value.trim(),
      baseUrl: $('#aiUrl').value.trim(),
      apiKey: $('#aiKey').value.trim(),
    });
    const m = $('#aiMsg');
    m.style.display = 'inline';
    setTimeout(() => { m.style.display = 'none'; }, 1200);
  });

  $('#aiProvider').addEventListener('change', e => {
    const p = AI_PROVIDERS[e.target.value];
    if (!p) return;
    $('#aiModel').value = p.model;
    $('#aiUrl').value = p.url;
  });

  $('#btnGen').addEventListener('click', () => generateReport($('#aiGame').value));
  $('#btnCard').addEventListener('click', () => showShareCard($('#aiGame').value));
  $('#btnSample').addEventListener('click', () => {
    aiReport = null; aiMeta = null;
    $('#aiReportArea').innerHTML = renderSampleReport();
  });
}

function renderSampleReport() {
  const totals = playerTotals();
  const mvp = totals.find(r => r.player.id === 'p1') || totals[0];
  return `
    <div class="report-banner">
      <strong>示例报告</strong>（预置文案，展示报告版式）——
      点上方「🤖 生成 AI 报告」并配置好密钥，即可对<b>你的真实数据</b>生成同样的版式。
    </div>

    <div class="report-title">赛后分析报告 · vs 新亚研究生队（83:71 胜）</div>
    <div class="report-sub">2026-10-11 ｜ 基于 3 场比赛 + 4 次训练 ｜ 生成引擎：GLM Agent</div>

    <div class="mvp-card">
      <div class="mvp-emoji">🏆</div>
      <div>
        <div class="mvp-name">本场 MVP：#${mvp.player.number} ${esc(mvp.player.name)}</div>
        <div class="mvp-line">18 分 12 篮板（两双），8/14 投篮，正负贡献全场最高 —— 内线支柱，3 场累计 46 分 31 篮板。</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">关键洞察</div>
      <ul class="insight-list">
        <li data-icon="📉"><b>「第三节危机」坐实：</b>三场第三节场均仅 15.7 分，四节最低；10-04 一场正是第三节被 14-2 攻潮打崩。这不是偶然，是模式。</li>
        <li data-icon="✅"><b>破紧逼专项起效：</b>全队失误 20 次（10-04）→ 14 次（本场），与 10-08 破紧逼专项训练的时间线吻合。这类「训练→数据」因果链要保持记录。</li>
        <li data-icon="🎯"><b>命中率三连升：</b>45.1% → 36.5% → 52.3%（按场次序 10-04 为低谷），外线手感回暖与失误减少互为因果：失误少了，轻松反击多了。</li>
        <li data-icon="⚠️"><b>控卫失误仍偏高：</b>#7 小北场均 4.0 次失误全队最高，但助攻 6.7 次同样是全队最高 —— 高风险高回报，助失比 1.7 尚可，优先减少横传。</li>
        <li data-icon="🦵"><b>负荷与膝盖：</b>10-08 队练 48AU + 10-11 比赛（估算 45AU）为大负荷窗口，10-12 膝盖反馈「酸」，当天即安排低强度核心课恢复，处理合理。提醒：大负荷后 48h 内控制额外跳跃量。</li>
      </ul>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">下阶段训练建议</div>
      <ul class="insight-list">
        <li data-icon="1️⃣"><b>保持每周 1 次破紧逼专项</b>（失误 20→14 的直接原因），加入 2v2 全场压迫情景。</li>
        <li data-icon="2️⃣"><b>第三节开局包：</b>固定首攻战术 + 中场休息后 2 分钟渐进激活，专治第三节得分低谷。</li>
        <li data-icon="3️⃣"><b>第二篮板点：</b>本场 12 个前场板里 5 个来自对方身高劣势；对手升级后需要 #32 大伟之外再养一个篮板点。</li>
        <li data-icon="4️⃣"><b>记录膝盖反馈：</b>每次大负荷日后在训练录入里顺手选膝盖状态（好/酸/痛），「负荷×膝盖反馈」卡片会自动给出关联提示（v1 为记录人视角）。</li>
      </ul>
    </div>
  `;
}

/* ---------- AI 调用链 ---------- */

const AI_SYSTEM_PROMPT = `你是一名业余篮球队的数据分析师兼教练助理。你会收到一场比赛及赛季背景数据（JSON），请输出这场比赛的赛后分析报告。

硬性规则：
1. 只允许引用数据中存在的数字；数据里没有的信息一律不写，必要时写「数据不足」。绝不编造。
2. 每条洞察必须包含具体数字或数字对比（如「第三节 12 分为四节最低」），禁止没有数字的空泛评论。
3. 用中文，直接、专业、口语化；不奉承、不客套。
4. 严格只输出一个 JSON 对象：不要 markdown 代码块，不要任何解释文字。格式：
{"title":"一句话标题","mvp":{"name":"球员名","line":"X分Y篮板Z助攻"},"insights":[{"icon":"单个emoji","title":"不超过10字","text":"不超过60字"}],"suggestions":[{"title":"不超过10字","text":"不超过60字"}],"note":"不超过40字总结"}
5. insights 给 3-5 条，优先覆盖：得分走势、失误、命中率、篮板、训练负荷与负荷风险，以及 deep 字段中的结构性漏点 / 双核依赖 / 角色画像 / 趋势 trend（若存在）。recentTrainings 含膝盖反馈 knee（好/酸/痛）时，负荷相关洞察必须结合解读；load.acwrZone 非「数据不足」时，负荷洞察必须引用 ACWR 口径。
6. suggestions 给 3-4 条：可执行的训练或战术调整，需与本场数据有因果关系。
7. MVP 按得分/篮板/助攻综合判断；mvp.line 里的数字必须与 playerStats 逐字一致。
8. deep 与 load 是预计算指标（structuralLeak=结构性漏点、dualCore=双核依赖、ACWR=负荷风险比）：引用时保持原口径与原数字，不得另造口径或四舍五入后当作新数字。`;

function buildAIContext(gameId) {
  const g = db.games.find(x => x.id === gameId);
  const nameOf = id => {
    const p = db.players.find(x => x.id === id);
    return p ? `#${p.number} ${p.name}` : '未知球员';
  };
  const game = {
    date: g.date,
    opponent: g.opponent,
    usQuarters: g.us,
    themQuarters: g.them,
    usTotal: teamScore(g, 'us'),
    themTotal: teamScore(g, 'them'),
    review: g.review || '',
    playerStats: g.stats.map(s => ({
      player: nameOf(s.playerId),
      pts: s.pts, reb: s.reb, ast: s.ast, tov: s.tov,
      ...(Array.isArray(s.fg) ? { fg: s.fg[0] + '/' + s.fg[1] } : {}),
    })),
  };
  const seasonTotals = playerTotals().filter(r => r.gp > 0).map(r => ({
    player: `#${r.player.number} ${r.player.name}`,
    gp: r.gp, pts: r.pts, reb: r.reb, ast: r.ast, tov: r.tov,
    ...(r.fga ? { fgPct: Math.round(r.fgm / r.fga * 100) + '%' } : {}),
  }));
  const allGames = gamesSorted().map(x => ({
    date: x.date, opponent: x.opponent,
    us: teamScore(x, 'us'), them: teamScore(x, 'them'),
    result: gameResult(x) === 'win' ? '胜' : gameResult(x) === 'loss' ? '负' : '平',
    teamTurnovers: x.stats.reduce((a, s) => a + s.tov, 0),
  }));
  const recentTrainings = [...db.trainings].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
    .map(t => ({ date: t.date, type: t.type, rpe: t.intensity, minutes: t.minutes, knee: t.knee || '', note: t.note || '' }));

  /* 预计算指标：深度分析引擎 + ACWR（数字可直接引用，约束 AI 不另造口径） */
  const d = deepAnalysis();
  const deep = d ? {
    sampleGames: d.n,
    winSplit: d.winSplit,
    quarterDiffAvg: d.qAvg,
    structuralLeak: `Q${d.leakQ + 1}（场均净胜 ${d.qAvg[d.leakQ]}）`,
    comeback: d.comeback,
    blown: d.blown,
    dualCore: { perGame: d.dualCore.map(x => x.date.slice(5) + ':' + x.share + '%'), avg: d.dualCoreAvg + '%' },
    playerProfiles: d.playerRows.map(p => ({
      player: p.name, pos: p.pos, contribAvg: p.contrib, ptsAvg: p.pts, rebAvg: p.reb,
      astAvg: p.ast, tovAvg: p.tov, ptsMax: p.max, ptsStd: p.std, astTov: p.astTov,
      pps: p.pps, fgPct: p.fgPct, roles: p.tags,
    })),
    preGameLoad: d.preGameLoad.map(x => ({ date: x.date.slice(5), load7dAU: x.load, result: x.result, margin: x.margin })),
    trend: d.trendSplit ? {
      window: `最近${d.trendSplit.recentN}场 vs 之前${d.trendSplit.earlyN}场`,
      verdict: d.trendSplit.verdict,
      rows: d.trendSplit.rows.map(r => ({ k: r.k, early: r.a, recent: r.b, delta: r.delta, state: r.state })),
    } : null,
    playerTrend: d.trajectory.map(t => ({ player: t.name, ptsByGame: t.ptsSeq, contribDelta: t.delta, form: t.form })),
  } : null;
  const acwr = acwrReport(dailyLoadSeries(28));

  return {
    system: AI_SYSTEM_PROMPT,
    user: JSON.stringify({ game, seasonTotals, allGames, recentTrainings, deep, load: {
      acwr: acwr.ratio, acwrZone: acwr.zone, acute7dAU: acwr.acute, chronic28dWeeklyAU: acwr.chronic,
    } }),
    gameLabel: `${g.date} vs ${g.opponent}`,
  };
}

function callAI(settings, system, user) {
  const preset = AI_PROVIDERS[settings.provider] || AI_PROVIDERS.zai;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  return fetch(settings.baseUrl || preset.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey },
    body: JSON.stringify({
      model: settings.model || preset.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.4,
      max_tokens: 6000,
    }),
    signal: ctrl.signal,
  }).then(async res => {
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error && (data.error.message || data.error.code);
      throw new Error(msg || ('HTTP ' + res.status));
    }
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('接口返回里没有内容');
    return content;
  }).catch(err => {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('请求超时（120 秒），可重试或换更快的模型');
    if (err.message === 'Failed to fetch') {
      throw new Error('网络请求被拦截（跨域/断网/地址错误）——智谱国内站需中转，见设置页说明');
    }
    throw err;
  });
}

function extractJSON(text) {
  const t = String(text).trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

async function generateReport(gameId) {
  const s = loadAISettings();
  if (!s.apiKey) { alert('请先在「模型设置」里填入 API Key'); return; }
  const status = $('#aiStatus');
  status.style.display = 'block';
  status.className = 'ai-status loading';
  status.innerHTML = '<span class="spinner"></span> 分析中…（推理模型可能需要 30-90 秒，请勿关闭页面）';
  try {
    const ctx = buildAIContext(gameId);
    const content = await callAI(s, ctx.system, ctx.user);
    const rep = extractJSON(content);
    if (!rep || !Array.isArray(rep.insights)) throw new Error('返回内容解析失败，请重试一次或更换模型');
    aiReport = rep;
    aiMeta = {
      model: s.model || (AI_PROVIDERS[s.provider] || AI_PROVIDERS.zai).model,
      at: new Date().toLocaleString('zh-CN'),
      gameLabel: ctx.gameLabel,
      gameId,
    };
    $('#aiReportArea').innerHTML = renderAIReport(aiReport, aiMeta);
    status.className = 'ai-status ok';
    status.textContent = '✓ 生成完成';
    setTimeout(() => { status.style.display = 'none'; }, 1500);
  } catch (e) {
    status.className = 'ai-status err';
    status.textContent = '✗ ' + (e.message || '调用失败');
  }
}

function renderAIReport(rep, meta) {
  const insights = Array.isArray(rep.insights) ? rep.insights : [];
  const suggestions = Array.isArray(rep.suggestions) ? rep.suggestions : [];
  return `
    <div class="report-banner">
      <strong>AI 生成</strong> · ${esc(meta.at)} · ${esc(meta.model)} · 分析对象：${esc(meta.gameLabel)}。
      数字被约束为只能来自录入数据；若发现不符，以「赛后录入」页为准。
    </div>

    <div class="report-title">${esc(rep.title || '赛后分析报告')}</div>
    <div class="report-sub">${esc(meta.gameLabel)} ｜ 生成引擎 ${esc(meta.model)}</div>

    ${rep.mvp ? `
    <div class="mvp-card">
      <div class="mvp-emoji">🏆</div>
      <div>
        <div class="mvp-name">本场 MVP：${esc(rep.mvp.name || '')}</div>
        <div class="mvp-line">${esc(rep.mvp.line || '')}</div>
      </div>
    </div>` : ''}

    ${insights.length ? `
    <div class="card">
      <div class="section-title" style="margin-top:0">关键洞察</div>
      <ul class="insight-list">
        ${insights.map(i => `<li data-icon="${esc(i.icon || '📌')}">${i.title ? '<b>' + esc(i.title) + '：</b>' : ''}${esc(i.text || '')}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${suggestions.length ? `
    <div class="card">
      <div class="section-title" style="margin-top:0">下阶段训练建议</div>
      <ul class="insight-list">
        ${suggestions.map((s, i) => `<li data-icon="${i + 1}️⃣">${s.title ? '<b>' + esc(s.title) + '：</b>' : ''}${esc(s.text || '')}</li>`).join('')}
      </ul>
    </div>` : ''}

    ${rep.note ? `<div class="card"><div class="hint" style="margin-bottom:0">📝 ${esc(rep.note)}</div></div>` : ''}
  `;
}

/* ---------- 战报分享卡（canvas → PNG，增长飞轮核心） ----------
 * 设计：比分 + 各节 + MVP + 一句金句 + 二维码。
 * 金句优先引用已生成的 AI 报告第一条洞察；没有就自动拼 MVP 数据线。
 * 二维码指向线上站点——对手队扫码录入第一场，飞轮闭环。
 */

const PRODUCT_URL = 'https://johnnyfan-cuhk.github.io/basketball-stats-agent/';
const CARD_FONT = "'Microsoft YaHei', 'PingFang SC', sans-serif";

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  let line = '', lines = 0;
  for (const ch of String(text)) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      lines++;
      if (lines >= maxLines) {
        ctx.fillText(line.slice(0, -1) + '…', x, y);
        return y;
      }
      ctx.fillText(line, x, y);
      y += lineH;
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}

function pickMVP(g) {
  const rows = g.stats.slice().sort((a, b) => b.pts - a.pts || b.reb - a.reb);
  for (const s of rows) {
    const p = db.players.find(x => x.id === s.playerId);
    if (p) return { p, s };
  }
  return null;
}

function shareInsightLine(g) {
  if (aiReport && aiMeta && aiMeta.gameId === g.id &&
      Array.isArray(aiReport.insights) && aiReport.insights[0]) {
    const i = aiReport.insights[0];
    return (i.title ? i.title + '：' : '') + (i.text || '');
  }
  const res = gameResult(g) === 'win' ? '拿下' : gameResult(g) === 'loss' ? '憾负' : '战平';
  const m = pickMVP(g);
  return m
    ? `${res} ${g.opponent} · MVP ${m.p.name} ${m.s.pts}分${m.s.reb}篮板`
    : `${res} ${g.opponent}`;
}

function buildShareCard(g) {
  const W = 720, H = 960;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const us = teamScore(g, 'us'), them = teamScore(g, 'them');
  const res = gameResult(g);

  // 背景 + 描边
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#181b28');
  grad.addColorStop(1, '#101219');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#2c3145';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // 品牌行
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9aa3b2';
  ctx.font = `20px ${CARD_FONT}`;
  ctx.fillText('🏀 篮球队数据助手', 40, 56);
  ctx.textAlign = 'right';
  ctx.fillText(g.date, W - 40, 56);
  ctx.fillStyle = '#f97316';
  ctx.fillRect(40, 74, 84, 4);

  // 比分
  ctx.textAlign = 'center';
  ctx.font = `900 96px ${CARD_FONT}`;
  ctx.fillStyle = '#f97316';
  ctx.fillText(String(us), W / 2 - 120, 228);
  ctx.fillStyle = '#9aa3b2';
  ctx.fillText(String(them), W / 2 + 120, 228);
  ctx.fillStyle = '#3a405a';
  ctx.font = `bold 72px ${CARD_FONT}`;
  ctx.fillText(':', W / 2, 222);
  ctx.font = `24px ${CARD_FONT}`;
  ctx.fillStyle = '#e8eaf0';
  ctx.fillText('我方', W / 2 - 120, 266);
  ctx.fillStyle = '#9aa3b2';
  const opp = g.opponent.length > 9 ? g.opponent.slice(0, 9) + '…' : g.opponent;
  ctx.fillText(opp, W / 2 + 120, 266);

  // 胜负徽章
  const bColor = res === 'win' ? '#34d399' : res === 'loss' ? '#f87171' : '#9aa3b2';
  ctx.fillStyle = bColor + '26';
  rr(ctx, W / 2 - 40, 292, 80, 38, 19);
  ctx.fill();
  ctx.fillStyle = bColor;
  ctx.font = `bold 24px ${CARD_FONT}`;
  ctx.fillText(res === 'win' ? '胜' : res === 'loss' ? '负' : '平', W / 2, 319);

  // 各节比分
  ctx.fillStyle = '#9aa3b2';
  ctx.font = `18px ${CARD_FONT}`;
  ctx.fillText(`各节 ${g.us.join('-')} ｜ 对方 ${g.them.join('-')}`, W / 2, 364);

  // 分隔线
  ctx.strokeStyle = '#2c3145';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 392);
  ctx.lineTo(W - 40, 392);
  ctx.stroke();

  // MVP
  const m = pickMVP(g);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f97316';
  ctx.font = `22px ${CARD_FONT}`;
  ctx.fillText('🏆 本场 MVP', 40, 436);
  if (m) {
    ctx.fillStyle = '#e8eaf0';
    ctx.font = `bold 36px ${CARD_FONT}`;
    ctx.fillText(`#${m.p.number} ${m.p.name}`, 40, 486);
    ctx.fillStyle = '#9aa3b2';
    ctx.font = `24px ${CARD_FONT}`;
    ctx.fillText(`${m.s.pts}分 · ${m.s.reb}篮板 · ${m.s.ast}助攻`, 40, 524);
  } else {
    ctx.fillStyle = '#9aa3b2';
    ctx.font = `24px ${CARD_FONT}`;
    ctx.fillText('本场暂无球员数据', 40, 486);
  }

  // 金句框（优先 AI 洞察）
  ctx.fillStyle = 'rgba(249,115,22,0.08)';
  rr(ctx, 40, 560, W - 80, 150, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(249,115,22,0.4)';
  rr(ctx, 40, 560, W - 80, 150, 14);
  ctx.stroke();
  ctx.fillStyle = '#e8eaf0';
  ctx.font = `24px ${CARD_FONT}`;
  wrapText(ctx, shareInsightLine(g), 64, 604, W - 128, 38, 3);

  // 二维码
  ctx.fillStyle = '#ffffff';
  rr(ctx, 40, 736, 160, 160, 14);
  ctx.fill();
  const qr = qrcode(0, 'M');
  qr.addData(PRODUCT_URL);
  qr.make();
  const count = qr.getModuleCount();
  const cell = 124 / count;
  ctx.fillStyle = '#12141c';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(58 + c * cell, 754 + r * cell, cell + 0.4, cell + 0.4);
      }
    }
  }
  ctx.fillStyle = '#e8eaf0';
  ctx.font = `bold 24px ${CARD_FONT}`;
  ctx.fillText('扫码生成你队的 AI 战报', 224, 786);
  ctx.fillStyle = '#9aa3b2';
  ctx.font = `19px ${CARD_FONT}`;
  ctx.fillText('1 人录入 · 5 分钟 · 免费 AI 分析', 224, 822);
  ctx.font = `16px ${CARD_FONT}`;
  ctx.fillText('johnnyfan-cuhk.github.io', 224, 852);

  // 底部
  ctx.fillStyle = '#f97316';
  ctx.font = `bold 18px ${CARD_FONT}`;
  ctx.fillText('让业余球队也有专业分析', 40, 932);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#565e73';
  ctx.fillText('每场比赛都值得复盘', W - 40, 932);
  return canvas;
}

function showShareCard(gameId) {
  const g = db.games.find(x => x.id === gameId);
  if (!g) return;
  const canvas = buildShareCard(g);
  canvas.style.cssText = 'width:100%;max-width:340px;border-radius:12px;border:1px solid var(--border);display:block;margin:0 auto;';
  const area = $('#cardPreview');
  area.innerHTML = '';
  area.appendChild(canvas);
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.style.cssText = 'display:block;margin:12px auto 0;';
  btn.textContent = '⬇️ 下载战报卡 PNG';
  btn.addEventListener('click', () => {
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `战报_${g.date}_${g.opponent}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  });
  area.appendChild(btn);
}

/* ---------- 空状态 ---------- */

function emptyState() {
  return `
    <div class="card" style="text-align:center;padding:40px">
      <div style="font-size:40px">🏀</div>
      <div style="margin:10px 0">还没有比赛数据</div>
      <button class="btn" onclick="db=loadSample();setTab('dashboard')">载入示例数据</button>
    </div>`;
}

/* ---------- 启动 ---------- */

$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (btn) setTab(btn.dataset.tab);
});

render();
