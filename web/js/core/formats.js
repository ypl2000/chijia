/* chijia v3 · 银行流水格式注册表
   每行映射为统一交易对象 { d, t, dc, amt, bal, rest }
   d=YYYY-MM-DD  t=交易类型  dc=C(收入)/D(支出)  amt=金额  bal=余额  rest=对方户名+摘要 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  const n = s => parseFloat(String(s).replace(/,/g, '')) || 0;
  const normDate = s => {
    const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(s).trim());
    return m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : s;
  };

  CJ.formats = {
    /* 交通银行 · 个人客户交易清单（v1 原样移植，8 捕获组） */
    'bocom-personal': {
      name: '交通银行 · 个人客户交易清单',
      hint: '序号 日期 时间 类型 C/D 金额 余额 对方账号 户名摘要',
      re: /^\s*\d+\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\S+)\s+([CD])\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\S+)\s+(.*)$/,
      map: m => ({ d: m[1], t: m[3], dc: m[4], amt: n(m[5]), bal: n(m[6]), rest: (m[8] || '').trim() })
    },
    /* 通用 CSV：日期,收支标志,金额,余额,摘要 —— 便于其他银行导出后另存 */
    'generic-csv': {
      name: '通用 CSV（日期,C/D,金额,余额,摘要）',
      hint: '2026-11-01,D,128.50,20341.20,餐饮消费',
      re: /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*[,，]\s*([CD]|收入|支出)\s*[,，]\s*([\d,.]+)\s*[,，]\s*([\d,.]+)\s*[,，]\s*(.*)$/,
      map: m => ({
        d: normDate(m[1]), t: '', dc: (m[2] === 'C' || m[2] === '收入') ? 'C' : 'D',
        amt: n(m[3]), bal: n(m[4]), rest: (m[5] || '').trim()
      })
    },
    /* 简版 TXT：日期 C/D 金额 余额 摘要 —— 手工整理/粘贴最快 */
    'simple-txt': {
      name: '简版 TXT（日期 C/D 金额 余额 摘要）',
      hint: '2026-11-01 D 128.50 20341.20 餐饮消费',
      re: /^\s*(\d{4}-\d{2}-\d{2})\s+([CD])\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(.*)$/,
      map: m => ({ d: m[1], t: '', dc: m[2], amt: n(m[3]), bal: n(m[4]), rest: (m[5] || '').trim() })
    }
  };
})(window.CJ);
