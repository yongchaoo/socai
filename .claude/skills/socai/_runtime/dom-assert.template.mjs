/**
 * DOM 断言模板 — executor 填 selectors，gate 拒占位断言。
 *
 * 用法：
 * 1. 复制 selectors 到 test-fixtures/.../selectors.json
 * 2. 跑：node run-dom-assert.mjs <htmlPath> <selectors.json>
 *
 * selectors.json 格式：
 * {
 *   "mustExist": [".opts", ".q"],
 *   "mustCount": { ".opt": 4 }
 * }
 *
 * 禁止占位：mustExist 不能为空数组且无 mustCount。
 */
export const SELECTOR_TEMPLATE = {
  mustExist: ['.REPLACE_ME'],
  mustCount: {},
};
