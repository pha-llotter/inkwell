/**
 * The resolved theme is already on <html> by the time this runs; an inline
 * script in the head does that before first paint. This only handles the
 * toggle, and keeps following the OS until the person chooses for themselves.
 */
const KEY = 'inkwell-theme';
const root = document.documentElement;

const stored = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
};

function apply(theme) {
  root.setAttribute('data-theme', theme);
  for (const b of document.querySelectorAll('[data-theme-toggle]')) {
    b.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
  btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* private mode: applies for this page only */ }
    apply(next);
  });
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
  if (!stored()) apply(e.matches ? 'dark' : 'light');
});

apply(root.getAttribute('data-theme') || 'light');
