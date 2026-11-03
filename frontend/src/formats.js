/**
 * 持家 chijia v2 · formats.js
 * 流水格式注册表（FORMATS）。
 *
 * 契约（docs/IMPORT.md 逐字执行）：
 *   每个 entry = { name, re, map }
 *   - name：展示名，"XX银行 · 清单类型"
 *   - re：行正则，必须产出捕获组（按序）：
 *       1 日期（YYYY-MM-DD） 2 交易类型 3 借贷标志（C/D）
 *       4 金额（可含千分位逗号） 5 户名+摘要（合并进最后一组）
 *   - map：捕获组 → 标准交易对象 { d, t, dc, amt, rest }
 *       amt 为数字；rest 用于雇主/补贴关键词分类
 *
 * 解析流程（core.js parseLines）：逐行尝试注册表中的格式，首个命中的即采用，
 * 不同格式可混在同一份文本里。社区贡献新银行格式 = 加一个 entry。
 */

/** @typedef {(m: RegExpMatchArray) => {d: string, t: string, dc: 'C'|'D', amt: number, rest: string, bal?: number}} FormatMapFn */

/**
 * @typedef {Object} FormatEntry
 * @property {string} name 展示名
 * @property {RegExp} re 行正则（5 个必备捕获组 + 可选余额组，见文件头契约）
 * @property {FormatMapFn} map 捕获组 → 标准交易对象
 */

/** @type {Record<string, FormatEntry>} */
export const FORMATS = {
  'bocom-personal': {
    name: '交通银行 · 个人客户交易清单',
    // 行结构：[序号] 日期 时间 交易类型 C/D 金额 [余额] 对方账号 户名+摘要…
    // 捕获组：1 日期 | 2 交易类型 | 3 C/D | 4 金额（可含千分位逗号）
    //         | 5 余额（可选，D18/F-3：必须含小数点 .\d{2}，防止把纯数字
    //           对方账号误捕为余额）| 6 户名+摘要
    // 对方账号只匹配不捕获；无余额列的变体行仍可命中（第 5 组可为空）。
    re: /^\s*(?:\d+\s+)?(\d{4}-\d{2}-\d{2})\s+\d{1,2}:\d{2}(?::\d{2})?\s+(\S+)\s+([CD])\s+([\d,]+(?:\.\d{1,2})?)(?:\s+([\d,]+\.\d{2}))?\s+\S+\s+(.+?)\s*$/,

    /** @type {FormatMapFn} */
    map: (m) => ({
      d: m[1],
      t: m[2],
      dc: /** @type {'C'|'D'} */ (m[3]),
      amt: Number(m[4].replace(/,/g, '')),
      ...(m[5] != null ? { bal: Number(m[5].replace(/,/g, '')) } : {}),
      rest: m[6].trim(),
    }),
  },
};

export default FORMATS;
