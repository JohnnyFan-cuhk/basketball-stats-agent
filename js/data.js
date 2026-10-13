/* ============================================================
 * data.js · 数据模型 + 示例数据 + localStorage 存储层
 * ------------------------------------------------------------
 * 数据模型 v0.1（M1 原型）
 *
 * 设计原则（来自竞品分析结论）：
 *   1. 为「1 个人、赛后 5 分钟录完」设计 —— 每人每场只录 5 个
 *      数字（得分/篮板/助攻/失误 + 可选投篮命中-出手），
 *      加一段自由文本回顾。其余一切（胜负、总计、趋势）都在
 *      读取时实时计算，不重复存储 —— 单一事实来源。
 *   2. 训练只录 4 个字段（日期/类型/主观强度/时长），
 *      负荷用 sRPE 方法计算：负荷AU = 强度 × 分钟 / 10。
 *      （session-RPE，运动科学里业余队可用的标准做法，M2
 *      报告生成时会作为 Agent 的输入之一。）
 *   3. 所有数据是纯 JSON，可以整库导出 —— M2 时把这份 JSON
 *      直接喂给 GLM Agent 生成赛后报告。
 * ============================================================ */

/* ---------- 数据模型定义 ----------

球员 Player:
  { id, name, number, position }        // position: PG/SG/SF/PF/C

比赛 Game:
  {
    id, date, opponent,
    us:   [q1, q2, q3, q4],             // 我方每节得分
    them: [q1, q2, q3, q4],             // 对方每节得分
    review: '自由文本回顾',              // 赛后口述，M2 报告的重要原料
    stats: [                            // 每人一条，只录出场的人
      { playerId, pts, reb, ast, tov, fg: [命中, 出手] }  // fg 可选
    ]
  }

训练 Training:
  { id, date, type, intensity, minutes, note }
    // type: 队练 | 力量 | 核心
    // intensity: 主观强度 1-5（RPE）
------------------------------------------ */

const STORAGE_KEY = 'bsa_data_v1';

/* ---------- 示例数据（8 名球员 + 3 场比赛 + 4 次训练） ----------
 * 数字经过校验：每人得分之和 = 该队四节总分，方便演示真实对账。
 * 首次打开页面时自动载入；点「清空全部数据」后从零开始。
 * ------------------------------------------------------------- */

const SAMPLE_PLAYERS = [
  { id: 'p1', name: '阿伦',  number: 23, position: 'C'  },
  { id: 'p2', name: '小北',  number: 7,  position: 'PG' },
  { id: 'p3', name: 'Jacky', number: 11, position: 'SG' },
  { id: 'p4', name: '大伟',  number: 32, position: 'PF' },
  { id: 'p5', name: '阿泽',  number: 5,  position: 'SG' },
  { id: 'p6', name: '子谦',  number: 14, position: 'SF' },
  { id: 'p7', name: '小马',  number: 3,  position: 'PG' },
  { id: 'p8', name: '老K',   number: 21, position: 'C'  },
];

const SAMPLE_GAMES = [
  {
    id: 'g1', date: '2026-09-27', opponent: '联合书院二队',
    us: [18, 22, 15, 24], them: [20, 18, 19, 21],   // 79:78 险胜
    review: '第一场正式磨合，防守端沟通比训练时好。最后2分钟阿伦关键前场篮板+两罚全中锁定胜局。',
    stats: [
      { playerId: 'p1', pts: 16, reb: 11, ast: 1, tov: 2, fg: [7, 13] },
      { playerId: 'p2', pts: 12, reb: 3,  ast: 7, tov: 4, fg: [4, 11] },
      { playerId: 'p3', pts: 15, reb: 4,  ast: 2, tov: 1, fg: [6, 12] },
      { playerId: 'p4', pts: 10, reb: 8,  ast: 3, tov: 2, fg: [4, 9]  },
      { playerId: 'p5', pts: 8,  reb: 2,  ast: 1, tov: 3, fg: [3, 8]  },
      { playerId: 'p6', pts: 9,  reb: 5,  ast: 2, tov: 1, fg: [4, 7]  },
      { playerId: 'p7', pts: 5,  reb: 1,  ast: 4, tov: 2, fg: [2, 6]  },
      { playerId: 'p8', pts: 4,  reb: 6,  ast: 0, tov: 1, fg: [2, 5]  },
    ],
  },
  {
    id: 'g2', date: '2026-10-04', opponent: '逸夫书院队',
    us: [14, 17, 12, 18], them: [21, 19, 16, 22],   // 61:78 第三节崩盘
    review: '第三节被一波 14-2 打崩，全队失误 20 次。对手全场紧逼我们应对不足，暂停后也没解决。',
    stats: [
      { playerId: 'p1', pts: 12, reb: 8, ast: 0, tov: 3, fg: [5, 12] },
      { playerId: 'p2', pts: 9,  reb: 2, ast: 5, tov: 5, fg: [3, 10] },
      { playerId: 'p3', pts: 14, reb: 3, ast: 1, tov: 2, fg: [5, 11] },
      { playerId: 'p4', pts: 8,  reb: 7, ast: 2, tov: 1, fg: [3, 8]  },
      { playerId: 'p5', pts: 6,  reb: 1, ast: 0, tov: 2, fg: [2, 7]  },
      { playerId: 'p6', pts: 7,  reb: 4, ast: 1, tov: 2, fg: [3, 6]  },
      { playerId: 'p7', pts: 3,  reb: 1, ast: 2, tov: 3, fg: [1, 5]  },
      { playerId: 'p8', pts: 2,  reb: 5, ast: 0, tov: 2, fg: [1, 4]  },
    ],
  },
  {
    id: 'g3', date: '2026-10-11', opponent: '新亚研究生队',
    us: [19, 21, 20, 23], them: [17, 20, 18, 16],   // 83:71
    review: '训练了破紧逼后明显改善，失误降到 14 次。Jacky 外线手感回暖，老K 护框出色。',
    stats: [
      { playerId: 'p1', pts: 18, reb: 12, ast: 2, tov: 2, fg: [8, 14] },
      { playerId: 'p2', pts: 11, reb: 3,  ast: 8, tov: 3, fg: [4, 9]  },
      { playerId: 'p3', pts: 17, reb: 5,  ast: 2, tov: 2, fg: [7, 13] },
      { playerId: 'p4', pts: 12, reb: 9,  ast: 3, tov: 1, fg: [5, 8]  },
      { playerId: 'p5', pts: 10, reb: 2,  ast: 1, tov: 1, fg: [4, 9]  },
      { playerId: 'p6', pts: 8,  reb: 6,  ast: 3, tov: 2, fg: [3, 5]  },
      { playerId: 'p7', pts: 4,  reb: 2,  ast: 5, tov: 2, fg: [2, 4]  },
      { playerId: 'p8', pts: 3,  reb: 7,  ast: 0, tov: 1, fg: [1, 3]  },
    ],
  },
];

const SAMPLE_TRAININGS = [
  { id: 't1', date: '2026-09-24', type: '队练', intensity: 4, minutes: 120, note: '全场战术走位 + 5v5 三组轮换' },
  { id: 't2', date: '2026-09-30', type: '力量', intensity: 3, minutes: 60,  note: '下肢：深蹲 5x5 + 罗马尼亚硬拉' },
  { id: 't3', date: '2026-10-08', type: '队练', intensity: 4, minutes: 120, note: '破紧逼专项 + 全场 2v2' },
  { id: 't4', date: '2026-10-12', type: '核心', intensity: 2, minutes: 30,  note: '平板 / 侧桥 / 死虫（低强度恢复课）' },
];

/* ---------- 存储层 ----------
 * 数据存在浏览器 localStorage（M1 原型够用，且离线可用）。
 * M2 会加「导出 JSON」按钮，把整库交给 Python 后端 / GLM Agent。
 */

function defaultDB() {
  return {
    players: SAMPLE_PLAYERS.map(p => ({ ...p })),
    games: SAMPLE_GAMES.map(g => JSON.parse(JSON.stringify(g))),
    trainings: SAMPLE_TRAININGS.map(t => ({ ...t })),
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* 解析失败就当作没有数据，重新播种 */ }
  const db = defaultDB();
  saveDB(db);
  return db;
}

function saveDB(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function loadSample() {
  const db = defaultDB();
  saveDB(db);
  return db;
}

function clearAll() {
  const db = { players: [], games: [], trainings: [] };
  saveDB(db);
  return db;
}

function newId(prefix) {
  return prefix + Date.now().toString(36);
}
