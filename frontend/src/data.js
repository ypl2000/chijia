/**
 * 持家 chijia v2 · data.js
 * `const DATA` 全量示例数据（docs/DATA.md 结构；数值全部虚构，千分位纯数字）。
 *
 * DATA 是「账本·主数据源」：资产、计划、分析的完整快照；
 * 银行流水 PDF 是「凭证·补充输入」：只更新第二部分流水统计与当期余额。
 * 真实数据经设置页「数据包导入」覆盖本对象。
 *
 * @typedef {Object} DATA
 * @property {{title: string, subtitle: string, footer: string,
 *   statsDim: {label: string, text: string},
 *   calculator: {file: string, btn: string, label: string, fields: Record<string, number>, tip: string},
 *   importer: {employer: string[], salaryAbstract?: string, subsidyKeywords?: string[], skipTypes?: string[], bonusMin?: number, bigExpenseMin?: number},
 * }} meta 页头页脚、统计维度、计算器联动、导入分类规则
 * @property {{now: HeroSide, exp: HeroSide}} hero 顶部左右分栏指标
 * @property {{title: string, open?: boolean, blocks: Block[]}} guide 使用说明折叠面板（可删）
 * @property {{title: string, note: string, arrowCap: string,
 *   now: OverviewSide, exp: OverviewSide,
 *   tableRows: Array<{tag: string, tagCls?: string, tagStyle?: string, now: string, exp: string, note: string, total?: boolean}>,
 *   readout: string}} overview 置顶资金分布&计划总览
 * @property {Part[]} parts 三大部分的全部章节
 *
 * @typedef {{head: string, items: Array<{label: string, b: string}>}} HeroSide
 * @typedef {{head: string, total: string, sub: string,
 *   stack: Array<{w: number, color: string, label?: string}>,
 *   rows: Array<{c: string, name: string, amt: string, pc: string, muted?: boolean, neg?: boolean}>,
 *   callout?: string}} OverviewSide
 *
 * @typedef {Object} Part
 * @property {string} id
 * @property {{ico: string, lab: string}} nav
 * @property {string} no 章节号（'1'|'2'|'3'）
 * @property {string} title
 * @property {string} note
 * @property {Array<{id: string, title: string, blocks: Block[]}>} sections
 * @property {{title: string, blocks: Block[]}} [rules] 存在时该部分自动双栏
 *
 * block 词表（docs/DATA.md，t 判别）：
 *   sub{html} h4{html} callout{html,kind?'ok'|'warn'} table{head,rows}
 *   allocbar{items:[{cls,label}]} cards{items:[{lab,val,note,total?}]}
 *   picgrid{items:[{h,d}]} flow{steps:[{t,d}]} tier{rows:[{w,bg,label,tag,tagCls,ink?}]}
 *   ms{items:[str]} procons{prosTitle,pros[],consTitle,cons[]}
 *   distrows{rows:[{name,w,color,pct}]} details{title,blocks} gap{h}
 * table 行：{cls?, cells:[string|{h, num?, cls?, bar?}]}；bar 渲染分布条 {pct}。
 */

export const DATA = {
  /* ---------------------------------- meta --------------------------------- */
  meta: {
    title: '持家 · 个人财务计划报告',
    subtitle: '账本主数据 · 全部数值为示例虚构',
    footer: '持家 chijia · 数据仅存本机 · 无遥测',
    statsDim: {
      label: '统计维度',
      text: '近 12 个月 · 示例流水 6 笔 · 2025-01 ~ 2025-04',
    },
    calculator: {
      file: './calculator.html',
      btn: '🧮 发送到计算器',
      label: '来自计划页',
      fields: { spend: 6000, rent: 3200 },
      tip: '点击后计算器自动填入月支出/房租等参数（30 分钟内有效）',
    },
    importer: {
      employer: ['示例科技有限公司'],
      salaryAbstract: '工资',
      subsidyKeywords: ['补贴', '报销'],
      skipTypes: ['理财申购', '理财赎回', '内部转账'],
      bonusMin: 20000,
      bigExpenseMin: 5000,
    },
  },

  /* ---------------------------------- hero ---------------------------------- */
  hero: {
    now: {
      head: '现在 · 2026-10',
      items: [
        { label: '金融资产', b: '589,128' },
        { label: '固定资产(残值)', b: '96,000' },
        { label: '负债', b: '-32,000' },
        { label: '净资产', b: '653,128' },
      ],
    },
    exp: {
      head: '计划期末 · 2031-12',
      items: [
        { label: '金融资产(估)', b: '≈1,160,000' },
        { label: '固定资产(残值)', b: '96,000' },
        { label: '负债', b: '0' },
        { label: '净资产(估)', b: '≈1,256,000' },
      ],
    },
  },

  /* ---------------------------------- guide --------------------------------- */
  guide: {
    title: '使用说明',
    open: true,
    blocks: [
      { t: 'sub', html: '四步上手；数据全部留在本机，解析在本机浏览器完成，原始 PDF 不上传不落库。' },
      {
        t: 'flow',
        steps: [
          { t: '① 建账本', d: '设置页导入数据包 JSON（账本主数据）' },
          { t: '② 导流水', d: '设置页选择 PDF / 粘贴文本，解析预览后应用' },
          { t: '③ 调计划', d: '计划页参数面板调整后一键重算推演' },
          { t: '④ 做备份', d: '设置页导出备份 JSON / 建快照，固化成果' },
        ],
      },
      { t: 'callout', kind: 'ok', html: '月度节奏建议：导入流水并应用 → 导出备份固化 → 再做下月计划。' },
    ],
  },

  /* --------------------------------- overview -------------------------------- */
  overview: {
    title: '资金分布 & 计划总览',
    note: '口径：汽车按残值入固定资产；公司股权按购入成本；公积金限用途单列。',
    arrowCap: '月投 6,000 × 60 个月<br>年化 5% 复利推演',
    now: {
      head: '现在',
      total: '653,128',
      sub: '净资产（资产 − 负债）',
      stack: [
        { w: 86, color: '#4e8cff', label: '金融资产 86%' },
        { w: 14, color: '#2fbf71', label: '固定资产 14%' },
      ],
      rows: [
        { c: '#4e8cff', name: '指数基金', amt: '269,128', pc: '41%' },
        { c: '#4e8cff', name: '货币基金', amt: '160,000', pc: '25%' },
        { c: '#9aa4b2', name: '公积金（限用途）', amt: '118,000', pc: '18%' },
        { c: '#2fbf71', name: '汽车（残值）', amt: '96,000', pc: '15%' },
        { c: '#9aa4b2', name: '汽车贷款', amt: '-32,000', pc: '—', muted: true, neg: true },
      ],
    },
    exp: {
      head: '计划期末',
      total: '≈1,256,000',
      sub: '净资产估算（含复利假设）',
      stack: [
        { w: 92, color: '#4e8cff', label: '金融资产 92%' },
        { w: 8, color: '#2fbf71', label: '固定资产 8%' },
      ],
      rows: [
        { c: '#4e8cff', name: '指数基金', amt: '≈688,000', pc: '55%' },
        { c: '#4e8cff', name: '货币基金', amt: '≈262,000', pc: '21%' },
        { c: '#9aa4b2', name: '公积金（限用途）', amt: '≈210,000', pc: '17%' },
        { c: '#2fbf71', name: '汽车（残值）', amt: '96,000', pc: '7%' },
      ],
      callout: '推演含复利假设，非承诺收益；月末用实际数据复核。',
    },
    tableRows: [
      { tag: '金融资产', now: '589,128', exp: '≈1,160,000', note: '月定投 6,000 · 年化 5% 复利', total: true },
      { tag: '固定资产(残值)', now: '96,000', exp: '96,000', note: '汽车按残值估值' },
      { tag: '负债', now: '-32,000', exp: '0', note: '2027-06 结清', tagCls: 'tag-warn' },
      { tag: '净资产', now: '653,128', exp: '≈1,256,000', note: '5 年 +92%', total: true, tagCls: 'tag-ok' },
    ],
    readout:
      '<p>金融资产 589,128 元中，限用途（公积金）118,000 元，可动用 471,128 元；' +
      '月度可支配约 10,500 元，按投资率 40% 推演，5 年后金融资产约 <b>≈1,160,000</b> 元，' +
      '净资产约 <b>≈1,256,000</b> 元。</p>',
  },

  /* ---------------------------------- parts --------------------------------- */
  parts: [
    /* -------- 第一部分 · 计划（1.1~1.4 + 1.5 保护规则双栏） -------- */
    {
      id: 'plan',
      nav: { ico: '📋', lab: '计划' },
      no: '1',
      title: '月度计划与推演',
      note: '基于近 12 个月收入均值与目标支出推演；金额为整数元。',
      sections: [
        {
          id: 's11',
          title: '1.1 四池分配',
          blocks: [
            { t: 'sub', html: '月度可支配收入按「消费 / 投资 / 缓冲 / ESOP」四池分配，先转出后消费。' },
            {
              t: 'allocbar',
              items: [
                { cls: 'ab-consume', label: '消费 40%' },
                { cls: 'ab-invest', label: '投资 40%' },
                { cls: 'ab-cushion', label: '缓冲 12%' },
                { cls: 'ab-esop', label: 'ESOP 8%' },
              ],
            },
            { t: 'h4', html: '月度分配明细 <span class="hint">（按月可支配 10,500 计）</span>' },
            {
              t: 'table',
              head: [{ h: '池子' }, { h: '金额(元/月)', num: true, w: '22%' }, { h: '占比', num: true, w: '14%' }, '用途'],
              rows: [
                { cells: ['消费池', { h: '4,200', num: true }, { h: '40%', num: true }, '房租 3,200 + 日常 1,000'] },
                { cells: ['投资池', { h: '4,200', num: true }, { h: '40%', num: true }, '指数基金定投（发薪日自动转出）'] },
                { cells: ['缓冲池', { h: '1,260', num: true }, { h: '12%', num: true }, '应急备用金，只进不出'] },
                { cells: ['ESOP 池', { h: '840', num: true }, { h: '8%', num: true }, '公司股权按购入成本计'] },
              ],
            },
            { t: 'callout', kind: 'ok', html: '四池合计 10,500 = 可支配收入，无超配。' },
          ],
        },
        {
          id: 's12',
          title: '1.2 结余推演',
          blocks: [
            {
              t: 'table',
              head: [{ h: '项目' }, { h: '金额(元/月)', num: true, w: '26%' }, '说明'],
              rows: [
                { cells: ['月均流入', { h: '15,000', num: true }, '工资 + 奖金摊平'] },
                { cells: ['月度流出', { h: '9,000', num: true }, '消费池 4,200 + 其他固定 4,800'] },
                { cells: ['月度结余', { h: '6,000', num: true, cls: 'strong' }, '全部进入投资池复利'] },
              ],
            },
            {
              t: 'details',
              title: '推演假设明细',
              blocks: [
                { t: 'ms', items: ['年化 5% 复利', '收入不增长（保守）', '支出按 settings 口径 6,000', '年终奖计入 3、9 月'] },
                { t: 'gap', h: '8px' },
                { t: 'sub', html: '任一假设变化请在计划页参数面板重算，不要手改本文。' },
              ],
            },
          ],
        },
        {
          id: 's13',
          title: '1.3 期末预期',
          blocks: [
            {
              t: 'table',
              head: [{ h: '项目' }, { h: '现在(元)', num: true, w: '20%' }, { h: '期末(元)', num: true, w: '22%' }, '构成'],
              rows: [
                {
                  cells: [
                    '指数基金',
                    { h: '269,128', num: true },
                    { h: '≈688,000', num: true, bar: { pct: 59 } },
                    '存量复利 + 月定投',
                  ],
                },
                {
                  cells: [
                    '货币基金',
                    { h: '160,000', num: true },
                    { h: '≈262,000', num: true, bar: { pct: 23 } },
                    '缓冲池滚动',
                  ],
                },
                {
                  cells: [
                    '公积金',
                    { h: '118,000', num: true },
                    { h: '≈210,000', num: true, bar: { pct: 18 } },
                    '限用途，不计流动性',
                  ],
                },
                {
                  cells: [
                    '净资产合计',
                    { h: '653,128', num: true, cls: 'strong' },
                    { h: '≈1,256,000', num: true, cls: 'strong', bar: { pct: 100 } },
                    '负债 2027-06 清零',
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 's14',
          title: '1.4 里程碑',
          blocks: [
            {
              t: 'flow',
              steps: [
                { t: '2027-06', d: '结清汽车贷款 32,000' },
                { t: '2028-12', d: '应急金达 72,000（12 个月支出）' },
                { t: '2030-06', d: '金融资产破 1,000,000' },
                { t: '2031-12', d: '金融资产 ≈1,160,000' },
              ],
            },
          ],
        },
      ],
      rules: {
        title: '1.5 保护规则',
        blocks: [
          { t: 'h4', html: '只进不出的池子' },
          { t: 'ms', items: ['投资池发薪日自动转出', '缓冲池低于 3 个月支出时暂停 ESOP', '年终奖 50% 直接进缓冲池'] },
          { t: 'callout', kind: 'warn', html: '任意一池超支不得挪用投资池：先动用缓冲池，缓冲不足时下调当月消费，事后在计划页重算。' },
        ],
      },
    },

    /* -------- 第二部分 · 分析（2.1~2.5，导入流水后自动更新） -------- */
    {
      id: 'txns',
      nav: { ico: '🔎', lab: '分析' },
      no: '2',
      title: '流水分析',
      note: '来自导入流水（近 12 个月）；金额两位小数。',
      sections: [
        {
          id: 's21',
          title: '2.1 收入构成',
          blocks: [
            {
              t: 'table',
              head: [{ h: '来源' }, { h: '金额(元)', num: true, w: '24%' }, { h: '笔数', num: true, w: '12%' }, { h: '占比', num: true, w: '24%' }],
              rows: [
                { cells: ['工资', { h: '180,000.00', num: true }, { h: '12', num: true }, { h: '85.9%', num: true, bar: { pct: 86 } }] },
                { cells: ['奖金', { h: '24,000.00', num: true }, { h: '1', num: true }, { h: '11.5%', num: true, bar: { pct: 12 } }] },
                { cells: ['补贴', { h: '3,600.00', num: true }, { h: '6', num: true }, { h: '1.7%', num: true, bar: { pct: 2 } }] },
                { cells: ['理财收益', { h: '1,984.56', num: true }, { h: '4', num: true }, { h: '0.9%', num: true, bar: { pct: 1 } }] },
              ],
            },
            { t: 'callout', html: '收入通道单一（工资 &gt; 85%），建议保持 6 个月以上应急覆盖。' },
          ],
        },
        {
          id: 's22',
          title: '2.2 支出结构',
          blocks: [
            {
              t: 'tier',
              rows: [
                { w: 53, bg: '#4e8cff', label: '房租', tag: '53%', tagCls: '' },
                { w: 22, bg: '#2fbf71', label: '餐饮', tag: '22%', tagCls: '' },
                { w: 9, bg: '#e8a13c', label: '交通', tag: '9%', tagCls: '' },
                { w: 16, bg: '#9aa4b2', label: '其他', tag: '16%', tagCls: '' },
              ],
            },
            { t: 'sub', html: '固定支出占比 53%，弹性空间主要在餐饮与其他。' },
          ],
        },
        {
          id: 's23',
          title: '2.3 月度趋势',
          blocks: [
            {
              t: 'table',
              head: [{ h: '月份' }, { h: '流入(元)', num: true, w: '22%' }, { h: '流出(元)', num: true, w: '22%' }, { h: '结余(元)', num: true, w: '22%' }],
              rows: [
                { cells: ['2025-01', { h: '15,000.00', num: true }, { h: '9,214.50', num: true }, { h: '5,785.50', num: true }] },
                { cells: ['2025-02', { h: '15,600.00', num: true }, { h: '8,930.00', num: true }, { h: '6,670.00', num: true }] },
                { cells: ['2025-03', { h: '15,000.00', num: true }, { h: '10,482.40', num: true }, { h: '4,517.60', num: true }] },
                { cells: ['2025-04', { h: '15,600.00', num: true }, { h: '9,102.80', num: true }, { h: '6,497.20', num: true }] },
              ],
            },
          ],
        },
        {
          id: 's24',
          title: '2.4 类型分布',
          blocks: [
            { t: 'h4', html: '交易类型笔数 <span class="hint">（已排除理财申购/赎回等内部转账）</span>' },
            {
              t: 'table',
              head: [{ h: '类型' }, { h: '笔数', num: true, w: '16%' }, { h: '金额(元)', num: true, w: '26%' }],
              rows: [
                { cells: ['工资入账', { h: '12', num: true }, { h: '180,000.00', num: true }] },
                { cells: ['消费', { h: '28', num: true }, { h: '36,412.90', num: true }] },
                { cells: ['转账', { h: '9', num: true }, { h: '18,000.00', num: true }] },
                { cells: ['大额支出', { h: '1', num: true }, { h: '6,000.00', num: true }] },
              ],
            },
          ],
        },
        {
          id: 's25',
          title: '2.5 往来对手 Top',
          blocks: [
            {
              t: 'table',
              head: [{ h: '对手' }, { h: '方向', w: '14%' }, { h: '笔数', num: true, w: '14%' }, { h: '金额(元)', num: true, w: '26%' }],
              rows: [
                { cells: ['示例科技有限公司', '收', { h: '13', num: true }, { h: '184,200.00', num: true }] },
                { cells: ['（特约）某商场', '支', { h: '8', num: true }, { h: '6,000.00', num: true }] },
                { cells: ['某房贷银行', '支', { h: '6', num: true }, { h: '19,200.00', num: true }] },
              ],
            },
          ],
        },
      ],
    },

    /* -------- 第三部分 · 健康度（3.1~3.4） -------- */
    {
      id: 'health',
      nav: { ico: '🧪', lab: '健康度' },
      no: '3',
      title: '财务健康度',
      note: '四维评估：应急覆盖 / 储蓄率 / 流动性结构 / 综合红绿灯。',
      sections: [
        {
          id: 's31',
          title: '3.1 应急覆盖',
          blocks: [
            {
              t: 'cards',
              items: [
                { lab: '活期现金', val: '42,000', note: '可 T+0 取用' },
                { lab: '月支出', val: '6,000', note: '设置页收入口径' },
                { lab: '覆盖月数', val: '7.0', note: '活期现金 ÷ 月支出', total: '🟢 达标' },
              ],
            },
            { t: 'sub', html: '口径：仅活期现金计入应急覆盖，货币基金与公积金不计。' },
          ],
        },
        {
          id: 's32',
          title: '3.2 储蓄率',
          blocks: [
            {
              t: 'table',
              head: [{ h: '项目' }, { h: '数值', num: true, w: '26%' }],
              rows: [
                { cells: ['月均流入', { h: '15,000.00', num: true }] },
                { cells: ['月均流出', { h: '9,000.00', num: true }] },
                { cells: ['储蓄率', { h: '40%', num: true, cls: 'strong' }] },
              ],
            },
            { t: 'callout', kind: 'warn', html: '含年终奖月份时储蓄率波动约 ±8%，按年口径评估更稳。' },
          ],
        },
        {
          id: 's33',
          title: '3.3 流动性结构',
          blocks: [
            {
              t: 'distrows',
              rows: [
                { name: '指数基金', w: 46, color: '#4e8cff', pct: '46%' },
                { name: '货币基金', w: 27, color: '#2fbf71', pct: '27%' },
                { name: '公积金（限用途）', w: 20, color: '#9aa4b2', pct: '20%' },
                { name: '活期现金', w: 7, color: '#e8a13c', pct: '7%' },
              ],
            },
            { t: 'sub', html: '公积金等限用途资产不计入流动性口径；可动用部分 471,128 元。' },
          ],
        },
        {
          id: 's34',
          title: '3.4 综合红绿灯',
          blocks: [
            {
              t: 'picgrid',
              items: [
                { h: '🟢 应急覆盖', d: '7.0 个月，达标（≥6）' },
                { h: '🟢 储蓄率', d: '40%，达标（≥30%）' },
                { h: '🟡 流动性', d: '限用途占比 20%，持续关注' },
                { h: '🟢 负债', d: '小额且按期递减' },
              ],
            },
            {
              t: 'procons',
              prosTitle: '做得好',
              pros: ['储蓄率稳定 40%+', '应急金覆盖 7 个月'],
              consTitle: '待改进',
              cons: ['公积金占比偏高', '收入通道单一'],
            },
          ],
        },
      ],
    },
  ],
};

export default DATA;
