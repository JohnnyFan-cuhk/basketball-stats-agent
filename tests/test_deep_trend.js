/* ============================================================
 * tests/test_deep_trend.js · 深度分析引擎 D 模块（趋势与模式）单测
 * 运行：node tests/test_deep_trend.js
 * 案例1 = 示例数据 3 场手算对照
 * 案例2 = 6 场注入（窗口缩放 recent=3 + 二番战泛化）
 * 案例3 = 3 场走低判定
 * 案例4 = 单场边界
 * 案例5 = AI 上下文注入防回归
 * ============================================================ */
const fs = require('fs');
const path = require('path');

/* 浏览器桩：app.js 顶层会 loadDB / render，桩掉 document / localStorage / Chart */
const elStub = () => ({ innerHTML: '', style: {}, dataset: {}, classList: { toggle() {} }, addEventListener() {} });
global.document = { querySelector: () => elStub(), querySelectorAll: () => [] };
global.localStorage = {
  _s: {},
  getItem(k) { return k in this._s ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
global.Chart = function () { this.destroy = () => {}; };
global.Chart.defaults = {};

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + `（得到 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`);

/* 源码与断言体放在同一个 Function 作用域里执行，绕开顶层 let 在 eval 外不可见的问题 */
const root = path.join(__dirname, '..');
const src =
  fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/app.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(__dirname, 'deep_trend_body.js'), 'utf8');
try {
  new Function('ok', 'eq', src)(ok, eq);
} catch (e) {
  fail++;
  console.error('  ✗ 运行时异常：', e.stack);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
