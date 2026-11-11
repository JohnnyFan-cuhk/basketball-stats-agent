/* ---------- 案例1 · 示例数据 3 场（手算对照） ----------
 * 09-27 胜 79:78 ｜ 10-04 负 61:78 ｜ 10-11 胜 83:71
 * n=3 → rN=1：recent = g3，early = g1,g2
 * 失误：g1=16 g2=20 g3=14；命中率：g1 32/71=45%，g2 23/63=37%，g3 34/66=52% */
console.log('案例1 · 示例数据 3 场（手算对照）');
let d = deepAnalysis();
eq(d.trendSplit.recentN, 1, 'D1 窗口 recent=1');
eq(d.trendSplit.earlyN, 2, 'D1 窗口 early=2');
eq(d.trendSplit.recent.pts, 83, 'D1 最近场均得分 83');
eq(d.trendSplit.early.pts, 70, 'D1 之前场均得分 70');
eq(d.trendSplit.recent.opp, 71, 'D1 最近场均失分 71');
eq(d.trendSplit.early.opp, 78, 'D1 之前场均失分 78');
eq(d.trendSplit.recent.diff, 12, 'D1 最近净胜 +12');
eq(d.trendSplit.early.diff, -8, 'D1 之前净胜 -8');
eq(d.trendSplit.recent.tov, 14, 'D1 最近失误 14');
eq(d.trendSplit.early.tov, 18, 'D1 之前失误 18');
eq(d.trendSplit.early.fgPct, 41, 'D1 早期命中率 41（45 与 37 均值）');
eq(d.trendSplit.recent.fgPct, 52, 'D1 近期命中率 52（34/66）');
eq(d.trendSplit.rows.map(r => r.state), ['good', 'good', 'good', 'good', 'good', 'good'], 'D1 六指标全部向好');
eq(d.trendSplit.verdict, '向好', 'D1 判定=向好');
eq(d.trendSplit.rows[4].k, '命中率%', 'D1 行含命中率');
eq(d.trendSplit.rows[5].k, '胜率%', 'D1 行含胜率');
eq(d.trendSplit.rows[5].delta, 50, 'D1 胜率变化 +50pp');

/* D2 手算：贡献值 = 分+板+助-失
 * 阿伦 [26,17,30] 季24.3 近2场23.5 Δ-0.8 ｜ 小北 [18,11,19] 季16.0 Δ-1.0
 * Jacky [20,16,22] 19.3 ｜ 大伟 [19,16,23] 19.3 Δ+0.2 ｜ 阿泽 [8,5,12] 8.3 Δ+0.2
 * 子谦 [15,10,15] 13.3 ｜ 小马 [8,3,9] 6.7 ｜ 老K [9,5,9] 7.7 */
console.log('  -- D2 球员轨迹 --');
eq(d.trajectory.length, 8, 'D2 8 名球员');
eq(d.trajectory.map(t => t.name), ['#23 阿伦', '#11 Jacky', '#32 大伟', '#7 小北', '#14 子谦', '#5 阿泽', '#21 老K', '#3 小马'], 'D2 排序=赛季贡献降序（并列按出场序）');
const byName = Object.fromEntries(d.trajectory.map(t => [t.name, t]));
eq(byName['#23 阿伦'].ptsSeq, [16, 12, 18], 'D2 阿伦得分轨迹');
eq(byName['#23 阿伦'].seasonContrib, 24.3, 'D2 阿伦赛季贡献 24.3');
eq(byName['#23 阿伦'].last2Contrib, 23.5, 'D2 阿伦近2场 23.5');
eq(byName['#23 阿伦'].delta, -0.8, 'D2 阿伦 Δ-0.8');
eq(byName['#7 小北'].delta, -1, 'D2 小北 Δ-1.0');
eq(byName['#32 大伟'].delta, 0.2, 'D2 大伟 Δ+0.2');
eq(byName['#5 阿泽'].delta, 0.2, 'D2 阿泽 Δ+0.2');
eq(d.trajectory.every(t => t.form === '平稳'), true, 'D2 示例全员平稳（样本小，近2场≈赛季，符合预期）');

/* D3：示例数据无重复对手 */
eq(d.rematches, [], 'D3 示例无二番战 → 空数组');

/* ---------- 案例2 · 6 场注入（recent 窗口=3 + 二番战泛化） ---------- */
console.log('案例2 · 6 场注入（窗口缩放 + 二番战）');
const st = () => [{ playerId: 'p1', pts: 0, reb: 5, ast: 1, tov: 1 }];
const mkGame = (id, date, opp, usV, themV) => ({
  id, date, opponent: opp,
  us: [usV, usV, usV, usV], them: [themV, themV, themV, themV],
  review: '', stats: st(),
});
db.games = [
  mkGame('x1', '2026-01-01', '甲', 20, 25),   // -20
  mkGame('x2', '2026-01-08', '乙', 22, 20),   // +8
  mkGame('x3', '2026-01-15', '甲', 24, 22),   // +8   甲二番战
  mkGame('x4', '2026-01-22', '丙', 18, 26),   // -32
  mkGame('x5', '2026-01-29', '丁', 26, 18),   // +32
  mkGame('x6', '2026-02-05', '丙', 28, 16),   // +48  丙二番战
];
const d2x = deepAnalysis();
eq(d2x.trendSplit.recentN, 3, '泛化 n=6 → recent=3');
eq(d2x.trendSplit.earlyN, 3, '泛化 early=3');
eq(d2x.trendSplit.recent.pts, 96, '泛化 recent 场均得分 96');
eq(d2x.trendSplit.early.opp, 89.3, '泛化 early 场均失分 89.3');
eq(d2x.trendSplit.early.diff, -1.3, '泛化 early 净胜 -1.3');
eq(d2x.trendSplit.recent.diff, 16, '泛化 recent 净胜 +16');
eq(d2x.trendSplit.rows.some(r => r.k === '命中率%'), false, '泛化 无投篮数据 → 命中率行自动缺席');
eq(d2x.trendSplit.rows[3], { k: '场均失误', a: 1, b: 1, delta: 0, state: 'flat' }, '泛化 失误持平行');
eq(d2x.trendSplit.verdict, '向好', '泛化 判定=向好');
eq(d2x.rematches.length, 2, '泛化 两个二番战对手');
eq(d2x.rematches[0].opponent, '甲', '泛化 首个二番战=甲');
eq(d2x.rematches[0].games[0].qDiff, [-5, -5, -5, -5], '泛化 甲G1 逐节-5');
eq(d2x.rematches[0].games[1].qDiff, [2, 2, 2, 2], '泛化 甲G2 逐节+2');
eq(d2x.rematches[1].opponent, '丙', '泛化 第二个=丙（插入序）');
eq(d2x.rematches[1].games[1].us - d2x.rematches[1].games[0].us, 40, '泛化 丙二番战得分差 +40');

/* ---------- 案例3 · 走低判定（g3 惨败） ---------- */
console.log('案例3 · 走低判定');
db.games = [
  mkGame('y1', '2026-01-01', '甲', 25, 15),   // +40
  mkGame('y2', '2026-01-08', '乙', 25, 15),   // +40
  mkGame('y3', '2026-01-15', '丙', 12, 28),   // -64
];
const d3x = deepAnalysis();
eq(d3x.trendSplit.rows.map(r => r.state), ['bad', 'bad', 'bad', 'flat', 'bad'], '走低 4差1平');
eq(d3x.trendSplit.verdict, '走低', '走低 判定=走低');

/* ---------- 案例4 · 单场边界 ---------- */
console.log('案例4 · 边界');
db.games = [db.games[0]];
const d4 = deepAnalysis();
eq(d4.trendSplit, null, '单场 trendSplit=null');
eq(d4.trajectory.length, 1, '单场 trajectory 仍有该球员');
eq(d4.rematches, [], '单场 rematches 空');

/* ---------- 案例5 · AI 上下文注入防回归 ---------- */
console.log('案例5 · AI 上下文注入');
db.games = [
  mkGame('x1', '2026-01-01', '甲', 20, 25),
  mkGame('x2', '2026-01-08', '乙', 22, 20),
  mkGame('x3', '2026-01-15', '甲', 24, 22),
  mkGame('x4', '2026-01-22', '丙', 18, 26),
  mkGame('x5', '2026-01-29', '丁', 26, 18),
  mkGame('x6', '2026-02-05', '丙', 28, 16),
];
const ctx = buildAIContext('x1');
const payload = JSON.parse(ctx.user);
eq(payload.deep.trend.window, '最近3场 vs 之前3场', 'AI trend 窗口标注');
eq(payload.deep.trend.verdict, '向好', 'AI trend 判定注入');
eq(payload.deep.playerTrend.length, 1, 'AI playerTrend 注入');
eq(payload.deep.playerTrend[0].ptsByGame.length, 6, 'AI playerTrend 轨迹 6 点');
ok(typeof payload.deep.structuralLeak === 'string', 'AI deep 原有字段仍在（防回归）');
ok(payload.deep.winSplit !== undefined && Array.isArray(payload.deep.playerProfiles), 'AI deep 原有结构完整（防回归）');
