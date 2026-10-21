// Applies the theme chosen in the settings before the first paint (no light flash in dark mode).
// External file because the CSP allows no inline scripts.
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem('disslxt:prefs') || '{}');
    if (prefs.theme === 'light' || prefs.theme === 'dark') {
      document.documentElement.dataset.theme = prefs.theme;
    }
  } catch {
    // Storage blocked: follow the system setting.
  }
})();
