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
 *       amt 为数字；rest 用于雇主/补贴关键词分类；
 *       可选附加字段：bal（交易后余额）、time（行内交易时间 HH:MM[:SS]，
 *       仅供 core.js parseLines 去重键使用，不写入 Txn、不落库）
 *
 * 解析流程（core.js parseLines）：逐行尝试注册表中的格式，首个命中的即采用，
 * 不同格式可混在同一份文本里。社区贡献新银行格式 = 加一个 entry。
 */

/** @typedef {(m: RegExpMatchArray) => {d: string, t: string, dc: 'C'|'D', amt: number, rest: string, bal?: number, time?: string}} FormatMapFn */

/**
 * @typedef {Object} FormatEntry
 * @property {string} name 展示名
 * @property {RegExp} re 行正则（5 个必备捕获组 + 可选余额/时间组，见文件头契约）
 * @property {FormatMapFn} map 捕获组 → 标准交易对象
 */

/** @type {Record<string, FormatEntry>} */
export const FORMATS = {
  'bocom-personal': {
    name: '交通银行 · 个人客户交易清单',
    // 行结构：[序号] 日期 时间 交易类型 C/D 金额 [余额 [对方账号 [户名+摘要…]]]
    // 捕获组：1 日期 | 2 时间（问题⑧新增捕获：供 parseLines 去重键，不写入 Txn）
    //         | 3 交易类型 | 4 C/D | 5 金额（可含千分位逗号）
    //         | 6 余额（可选，D18/F-3：必须含小数点 .\d{2}，防止把纯数字
    //           对方账号误捕为余额）| 7 户名+摘要（可选）
    // 问题⑧：尾列「对方账号 + 户名摘要」改为整体可选——「本行存现/本行取现」
    //         等现金行余额后直接结束（无对方信息），旧正则 `\s+\S+\s+(.+?)`
    //         强制要求尾列导致这类行解析失败；缺失时 map 产出 rest=''。
    //         账号在行尾但摘要折到下一物理行的行（户名+摘要为 pdf.js 换行折断）
    //         由旧正则的「余额被 \S+ 吞掉」错误路径命中（bal 丢失），新正则下
    //         bal 正确捕获、rest 退化为账号串——严格更优，现有正常行匹配不变。
    // 对方账号只匹配不捕获；无余额列的变体行仍可命中（第 6 组可为空）。
    re: /^\s*(?:\d+\s+)?(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(\S+)\s+([CD])\s+([\d,]+(?:\.\d{1,2})?)(?:\s+([\d,]+\.\d{2}))?(?:\s+(?:\S+\s+)?(.+?))?\s*$/,

    /** @type {FormatMapFn} */
    map: (m) => ({
      d: m[1],
      time: m[2],
      t: m[3],
      dc: /** @type {'C'|'D'} */ (m[4]),
      amt: Number(m[5].replace(/,/g, '')),
      ...(m[6] != null ? { bal: Number(m[6].replace(/,/g, '')) } : {}),
      rest: (m[7] ?? '').trim(),
    }),
  },
};

export default FORMATS;
