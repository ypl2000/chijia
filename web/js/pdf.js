/* chijia v3 · PDF 文本抽取（pdf.js 已本地化，运行期零外部请求）
   按 transform[5]（y）分行、容差 3；行内按 transform[4]（x）升序拼接。 */
window.CJ = window.CJ || {};
(function (CJ) {
  'use strict';
  let loading = null;
  function load() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = () => {
        if (!window.pdfjsLib) return reject(new Error('pdf.js 加载后未找到全局对象'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('本地 pdf.js 组件缺失：请检查 vendor/pdfjs/ 目录，或改用「粘贴文本」'));
      document.head.appendChild(s);
    });
    return loading;
  }
  function extract(buf) {
    return load().then(lib => lib.getDocument({ data: buf }).promise).then(async pdf => {
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const lines = [];
        let cur = null, lastY = null;
        content.items.forEach(it => {
          if (!it.str || !it.str.trim()) return;
          const y = it.transform ? it.transform[5] : 0;
          const x = it.transform ? it.transform[4] : 0;
          if (lastY === null || Math.abs(y - lastY) > 3) { cur = { y, parts: [] }; lines.push(cur); lastY = y; }
          cur.parts.push({ x, s: it.str });
        });
        lines.forEach(l => { text += l.parts.sort((a, b) => a.x - b.x).map(v => v.s).join(' ').replace(/\s+/g, ' ').trim() + '\n'; });
      }
      return text;
    });
  }
  CJ.pdf = { load, extract };
})(window.CJ);
