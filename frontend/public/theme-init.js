// Applies the theme chosen in the settings before the first paint (no light flash in dark mode).
// Colour themes also bring their derived colours (stored by the app when the theme was chosen).
// External file because the CSP allows no inline scripts.
(function () {
  try {
    var root = document.documentElement;
    var prefs = JSON.parse(localStorage.getItem('disslxt:prefs') || '{}');
    if (prefs.theme === 'light' || prefs.theme === 'dark') {
      root.dataset.theme = prefs.theme;
    } else if (prefs.theme && prefs.theme !== 'system') {
      var stored = JSON.parse(localStorage.getItem('disslxt:theme-vars') || 'null');
      if (stored && (stored.base === 'light' || stored.base === 'dark')) {
        root.dataset.theme = stored.base;
        for (var name in stored.vars) {
          if (/^--[a-z0-9-]+$/.test(name)) root.style.setProperty(name, String(stored.vars[name]));
        }
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        for (var i = 0; i < metas.length; i++) metas[i].content = stored.vars['--bg-tertiary'];
      }
    }
  } catch {
    // Storage blocked: follow the system setting.
  }
})();
