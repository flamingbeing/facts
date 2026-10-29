// A classic script, not a module, so the browser runs it before the first paint (a module waits until the page is
// parsed, and the page may paint by then). It puts back the look choice.js last showed on this device (the <html>
// marks, Solid and the palette sheet, which choice.js keeps in localStorage) until boot.js shows the choice itself
// and takes the sheet over. A file, not inline, so the Content-Security-Policy needs no inline script. Nothing kept: no-op.
(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('core-theme-paint') || 'null');
    if (!kept || typeof kept.css !== 'string') return;
    const root = document.documentElement;
    for (const key of ['theme', 'dark', 'look', 'density', 'motion', 'header', 'menu', 'glass', 'tick', 'tabbar']) {
      const value = kept.marks && kept.marks[key];
      if (typeof value === 'string') root.dataset[key] = value;
    }
    if (kept.solid === true) root.classList.remove('glass');
    if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(kept.css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    /** @type {any} */ (globalThis).coreThemeSheet = sheet;
  } catch { /* no storage or an unreadable copy: boot.js shows the choice a moment later */ }
})();
