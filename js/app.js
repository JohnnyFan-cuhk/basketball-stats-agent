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
    au: sessionLoad(t), est: false,
  }));
  const games = db.games.map(g => ({
    date: g.date, label: `vs ${g.opponent}（比赛·估算）`,
    au: 5 * 90 / 10, est: true,
  }));
  return [...trainings, ...games].sort((a, b) => a.date.localeCompare(b.date));
}

function loadLast7Days() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return loadSessions().filter(s => s.date >= cutoffStr)
    .reduce((sum, s) => sum + s.au, 0);
}

/* ---------- 渲染入口 ---------- */

function render() {
  charts.forEach(c => c.destroy());
  charts = [];
  const main = $('#main');
  if (currentTab === 'dashboard') renderDashboard(main);
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

    <div class="section-title">训练明细</div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th style="text-align:left">日期</th><th>类型</th><th>强度(RPE)</th><th>时长</th><th>负荷AU</th><th style="text-align:left">备注</th></tr></thead>
        <tbody>
          ${[...db.trainings].sort((a, b) => b.date.localeCompare(a.date)).map(t => `
            <tr>
              <td class="name">${esc(t.date)}</td>
              <td><span class="badge ${t.type === '队练' ? 'accent' : 'gray'}">${esc(t.type)}</span></td>
              <td>${t.intensity}</td><td>${t.minutes}min</td><td>${sessionLoad(t)}</td>
              <td style="text-align:left;white-space:normal">${esc(t.note || '-')}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="hint">暂无</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
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
      <div class="hint">数据保存在本浏览器 localStorage。M2 会加「导出 JSON」交给后端与 AI。</div>
      <div class="btn-row">
        <button class="btn ghost" id="btnLoadSample">载入示例数据</button>
        <button class="btn danger" id="btnClear">清空全部数据</button>
      </div>
    </div>
  `;

  $('#btnSaveGame').addEventListener('click', saveGame);
  $('#btnSaveTraining').addEventListener('click', saveTraining);
  $('#btnAddPlayer').addEventListener('click', addPlayer);
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
  });
  saveDB(db);
  $('#trainMsg').style.display = 'inline';
  setTimeout(() => { $('#trainMsg').style.display = 'none'; render(); }, 900);
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

/* ---------- Tab 5 · AI 报告（M1 为预置示例） ---------- */

function renderReport(main) {
  const totals = playerTotals();
  const mvp = totals.find(r => r.player.id === 'p1');   // 示例：阿伦

  main.innerHTML = `
    <div class="report-banner">
      <strong>示例报告</strong> —— 以下内容为预置文案，用于定版 M2 的报告版式。
      M2 将把整库 JSON 交给 GLM Agent，按这个版式对<b>真实数据</b>自动生成。
    </div>

    <div class="report-title">赛后分析报告 · vs 新亚研究生队（83:71 胜）</div>
    <div class="report-sub">2026-10-11 ｜ 基于 3 场比赛 + 4 次训练 ｜ 生成引擎：GLM Agent（M2 上线）</div>

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
        <li data-icon="🦵"><b>负荷与膝盖：</b>10-08 队练 48AU + 10-11 比赛（估算 45AU）为大负荷窗口，10-12 低强度核心课恢复，安排合理。提醒：大负荷后 48h 内控制额外跳跃量。</li>
      </ul>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">下阶段训练建议</div>
      <ul class="insight-list">
        <li data-icon="1️⃣"><b>保持每周 1 次破紧逼专项</b>（失误 20→14 的直接原因），加入 2v2 全场压迫情景。</li>
        <li data-icon="2️⃣"><b>第三节开局包：</b>固定首攻战术 + 中场休息后 2 分钟渐进激活，专治第三节得分低谷。</li>
        <li data-icon="3️⃣"><b>第二篮板点：</b>本场 12 个前场板里 5 个来自对方身高劣势；对手升级后需要 #32 大伟之外再养一个篮板点。</li>
        <li data-icon="4️⃣"><b>记录膝盖反馈：</b>每次大负荷日后在训练日志标注膝盖状态（好/酸/痛），为负荷上限提供个人化依据。</li>
      </ul>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">M2 这份报告将如何生成</div>
      <div class="hint" style="margin-bottom:0">
        录入数据（本页 JSON）→ 组装 Prompt（含数据模型说明 + 分析框架：MVP/趋势/负荷/建议）→ 调用 GLM →
        结构化返回（标题/洞察/建议）→ 按本版式渲染。Agent 还会读取 PersonalAI-OS 的训练日志做负荷交叉分析。
      </div>
    </div>
  `;
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
