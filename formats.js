"use strict";
window.FORMATS = {
  "bocom-personal": {
    name: "交通银行 · 个人客户交易清单",
    // 行结构：序号 日期 时间 交易类型 C/D 金额 余额 对方账号 户名 摘要…
    re: /^\s*\d+\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\S+)\s+([CD])\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\S+)\s+(.*)$/,
    map: (m) => ({ d: m[1], t: m[3], dc: m[4], amt: parseFloat(m[5].replace(/,/g, "")), bal: parseFloat(m[6].replace(/,/g, "")), rest: (m[8] || "").trim() })
  }
};
