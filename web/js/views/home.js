/* chijia v3 · 首页 */
window.CJ = window.CJ || {};
window.CJ.views = window.CJ.views || {};
(function (CJ) {
  'use strict';
  const U = CJ.ui, F = CJ.fmt;

  function stats(s) {
    const rows = s.overview.now.rows || [];
    const total = rows.filter(r => !r.muted && !r.neg).reduce((a, r) => a + F.parse(r.amt), 0);
    const debt = rows.filter(r => r.muted || r.neg).reduce((a, r) => a + Math.abs(F.parse(r.amt)), 0);
    const liquid = rows.filter(r => !r.muted && !r.neg && /银行|活期|现金|基金|安全垫|预备/.test(r.name)).reduce((a, r) => a + F.parse(r.amt), 0);
    const eng = CJ.plan.computePlan(s.plan);
    const exp = CJ.plan.expectedAssets(s, eng);
    return { total, debt, net: total - debt, liquid, eng, exp };
  }

  CJ.views.home = {
    title: '首页', sub: '一眼看清现在，和计划期末',
    render(s) {
      const k = stats(s), eng = k.eng, exp = k.exp;
      const delta = exp.total - k.total;
      const hasTxns = s.txns && s.txns.length;
      const imported = s.meta.importedAt ? new Date(s.meta.importedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '尚未导入';
      const backup = s.meta.lastBackup ? new Date(s.meta.lastBackup).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' }) : '尚未备份';

      let html = '';
      /* Hero */
      html += U.card({
        cls: 'card-hero', body:
          '<div class="hero-card">' +
          '<div class="hero-top"><div><div class="hero-eyebrow">当前净资产</div>' +
          '<div class="hero-big"><small>¥</small>' + F.money(k.net) + '</div>' +
          '<div class="hero-sub">总资产 ' + F.money(k.total) + ' 元 · 负债 ' + F.money(k.debt) + ' 元</div></div>' +
          '<div class="hero-arrow">' + U.icon('arrow', 16) + ' ' + exp.endYM + '</div></div>' +
          '<div class="kpi-grid k3" style="margin:18px 0 0">' +
          U.kpi({ label: '可随时调度', value: F.money(k.liquid), note: '约 ' + (s.settings.monthlyExpense ? (k.liquid / s.settings.monthlyExpense).toFixed(1) : '—') + ' 个月支出', tone: 'blue' }) +
          U.kpi({ label: '计划期末总资产', value: F.money(exp.total), note: (delta >= 0 ? '+' : '') + F.money(delta) + ' 元 · ' + exp.endYM, tone: 'mint' }) +
          U.kpi({ label: '流动资产合计', value: F.money(eng.liquid), note: '按当前四池参数推演', tone: 'amber' }) +
          '</div></div>'
      });

      /* 状态条 */
      html += U.card({
        title: '当前状态', icon: 'info',
        body: '<div class="pill-list">' +
          U.tag(hasTxns ? '已导入 ' + F.money(hasTxns) + ' 笔流水' : '示例账本 · 未导入流水', hasTxns ? 'mint' : 'gray') +
          U.tag('主题 ' + (s.settings.theme === 'dark' ? '深色' : '浅色'), 'blue') +
          U.tag('本机存储', 'mint') +
          '</div>' +
          '<div class="kv"><span>最近导入流水</span><b>' + imported + '</b></div>' +
          '<div class="kv"><span>最近一次备份</span><b>' + backup + '</b></div>' +
          '<div class="kv"><span>计划窗口</span><b>' + s.plan.start + ' 起 ' + s.plan.months + ' 个月</b></div>'
      });

      /* 四步 */
      html += U.sectionTitle('·', '这个月要做的事', '按顺序走一遍，账本就保持最新');
      const steps = [
        { n: '1', t: '导入流水', d: '选择银行流水 PDF / TXT / CSV，或粘贴文本。解析全在本机完成。', tab: 'settings', hook: 'import' },
        { n: '2', t: '调整计划', d: '按实际收入改四池参数，逐月执行表与期末预期一起重算。', tab: 'plan', hook: 'params' },
        { n: '3', t: '看分析与洞察', d: '收入结构、大额支出、消费画像、双口径健康度评分。', tab: 'analysis' },
        { n: '4', t: '导出备份', d: '固化成一份 JSON；可选口令加密，换设备时恢复即可。', tab: 'settings', hook: 'backup' }
      ];
      html += '<div class="step-list">' + steps.map(x =>
        '<button class="step" data-go="' + x.tab + '"' + (x.hook ? ' data-hook="' + x.hook + '"' : '') + '>' +
        '<span class="step-no">' + x.n + '</span><span><b>' + x.t + '</b><p>' + x.d + '</p></span></button>'
      ).join('') + '</div>';

      /* 直达 + 动态 */
      html += '<div class="grid-2" style="margin-top:16px">';
      html += U.card({
        title: '直达入口', icon: 'spark',
        body: '<div class="btn-row">' +
          U.btn('发送到计算器', { tone: 'primary', icon: 'calculator', act: 'send-calc' }) +
          U.btn('组合体检', { tone: 'quiet', icon: 'portfolio', act: 'go-pf' }) +
          U.btn('导出备份', { tone: 'quiet', icon: 'download', act: 'export' }) +
          '</div>' +
          U.callout('<b>数据从属：</b>账本（导出的数据包）是主数据源；银行流水只是凭证，只更新流水统计与当期余额，不会覆盖股权、汽车、公积金等资产。', 'info')
      });
      const acts = (s.activity || []).slice(0, 6);
      html += U.card({
        title: '最近动态', icon: 'clock',
        body: acts.length ? '<div class="activity">' + acts.map(a =>
          '<div class="activity-row"><time>' + new Date(a.t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</time><span>' + F.esc(a.text) + '</span></div>'
        ).join('') + '</div>' : U.empty('还没有操作记录', '导入流水或调整计划后，这里会留下痕迹（只存本机）')
      });
      html += '</div>';
      return html;
    },
    mount(root, s) {
      root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => CJ.app.go(b.dataset.go, { hook: b.dataset.hook }));
      root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'send-calc') {
          CJ.store.commit(st => {
            const rows = st.overview.now.rows || [];
            const pick = re => rows.filter(r => re.test(r.name) && !r.muted).reduce((x, r) => x + F.parse(r.amt), 0);
            st.calculator.p0 = pick(/基金|银行|活期|现金|安全垫|预备/);
            st.calculator.spend = st.settings.monthlyExpense || st.plan.spend;
            st.calculator.income = st.income.monthlyAvg || st.plan.income;
          }, { reason: 'prefill' });
          U.toast('已把消费、收入与持仓带入计算器');
          CJ.app.go('calculator');
        } else if (a === 'go-pf') CJ.app.go('portfolio');
        else if (a === 'export') CJ.app.go('settings', { hook: 'backup' });
      });
    }
  };
})(window.CJ);
