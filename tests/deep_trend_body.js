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

/* ---------- 案例6 · E 模块胜负法则（示例手算对照） ----------
 * W={g1,g3} L={g2}
 * 篮板 W(40+46)/2=43 L31 gap12 ｜ 助攻 W(20+24)/2=22 L11 gap11
 * 命中率% W(45+52)/2=48.5 L37 gap11.5 ｜ 失误 W(16+14)/2=15 L20 gap5
 * 中位数：失误16 篮板40 助攻20 命中率45 */
console.log('案例6 · E 模块胜负法则（手算对照）');
db.players = SAMPLE_PLAYERS.map(p => ({ ...p }));
db.games = SAMPLE_GAMES.map(g => JSON.parse(JSON.stringify(g)));
const d5 = deepAnalysis();
eq(d5.winSignals.map(s => s.k), ['篮板', '命中率%', '助攻', '失误'], 'E1 信号排序=区分度降序');
eq(d5.winSignals[0], { k: '篮板', dir: 'high', wAvg: 43, lAvg: 31, gap: 12 }, 'E1 头号信号=篮板 gap12');
eq(d5.winSignals[1].wAvg, 48.5, 'E1 命中率胜场均值 48.5');
eq(d5.winSignals[3], { k: '失误', dir: 'low', wAvg: 15, lAvg: 20, gap: 5 }, 'E1 失误 gap5');
eq(d5.winRules.length, 4, 'E2 4 条规则');
eq(d5.winRules[0], { k: '失误', median: 16, dir: 'low', goodN: 2, goodW: 2, badN: 1, badW: 0 }, 'E2 失误≤16 → 2胜0负');
eq(d5.winRules[1], { k: '篮板', median: 40, dir: 'high', goodN: 2, goodW: 2, badN: 1, badW: 0 }, 'E2 篮板≥40 → 2胜0负');
eq(d5.winRules[2], { k: '助攻', median: 20, dir: 'high', goodN: 2, goodW: 2, badN: 1, badW: 0 }, 'E2 助攻≥20 → 2胜0负');
eq(d5.winRules[3], { k: '命中率%', median: 45, dir: 'high', goodN: 2, goodW: 2, badN: 1, badW: 0 }, 'E2 命中率≥45 → 2胜0负');

/* ---------- 案例7 · E 边界：可控指标完全相同 → 无区分度 ---------- */
console.log('案例7 · E 边界：无区分度');
db.games = [
  mkGame('x1', '2026-01-01', '甲', 20, 25), mkGame('x2', '2026-01-08', '乙', 22, 20),
  mkGame('x3', '2026-01-15', '甲', 24, 22), mkGame('x4', '2026-01-22', '丙', 18, 26),
  mkGame('x5', '2026-01-29', '丁', 26, 18), mkGame('x6', '2026-02-05', '丙', 28, 16),
];
const d6 = deepAnalysis();
eq(d6.winSignals.length, 3, 'E1 无投篮数据 → 3 项信号');
eq(d6.winSignals.every(s => s.gap === 0), true, 'E1 区分度全 0');
eq(d6.winRules, [], 'E2 差侧桶为空 → 规则空');

/* ---------- 案例8 · E 单场边界 ---------- */
console.log('案例8 · E 单场边界');
db.games = [db.games[0]];
const d7 = deepAnalysis();
eq(d7.winSignals, null, '单场（只有负场）→ winSignals null');
eq(d7.winRules, null, '单场 → winRules null');

/* ---------- 案例9 · AI 上下文：E 注入 + 阶段总结 ---------- */
console.log('案例9 · AI 上下文 E 注入 + 阶段总结');
db.games = SAMPLE_GAMES.map(g => JSON.parse(JSON.stringify(g)));
const ctx2 = buildAIContext('g1');
const p2 = JSON.parse(ctx2.user);
ok(p2.game && p2.game.usQuarters, '单场上下文 game 字段仍在（防回归）');
eq(p2.deep.winSignals[0].k, '篮板', 'AI winSignals 注入');
eq(p2.deep.winRules[0].rule, '失误≤16', 'AI winRules 注入且口径压缩正确');
eq(p2.deep.winRules[0].goodSide, '2胜0负', 'AI winRules 战绩注入');
const sctx = buildSeasonContext();
const ps = JSON.parse(sctx.user);
eq(ps.record, { games: 3, wins: 2, losses: 1, draws: 0 }, 'season record=2胜1负0平');
ok(ps.game === undefined, 'season 上下文无单场字段');
ok(ps.deep && ps.deep.winSignals && ps.deep.winRules && ps.deep.trend, 'season deep 含 E/D 模块');
ok(typeof AI_SEASON_PROMPT === 'string' && AI_SEASON_PROMPT.includes('只允许引用数据中存在的数字'), 'season prompt 硬性规则在位');
ok(AI_SEASON_PROMPT.includes('看方向'), 'season prompt 小样本规则在位');
eq(sctx.gameLabel, '阶段总结 · 3 场', 'season gameLabel');
eq(sctx.gameId, null, 'season gameId=null（战报卡不复用总结洞察）');
