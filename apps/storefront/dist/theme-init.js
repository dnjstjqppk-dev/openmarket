/* Theme before first paint (see useTheme in @olmoa/ui). External file (not
 * inline) so the Content-Security-Policy script-src 'self' stays strict.
 * Render-blocking by design: it must run before Vue mounts to avoid a flash. */
try { var m = localStorage.getItem('olmoa_theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m) } catch (e) {}
/* Edge-rendered page text ([data-olmoa-edge] inside #app) is for crawlers and no-JS visitors. With JS it
 * used to paint as a bare unstyled list for ~1 s before Vue replaced it ("the page loads twice").
 * html.js hides it (index.html <style>); every visitor still gets the same HTML (no UA branching).
 * Safety net: if the app has not mounted after 8 s (blocked bundle, old browser), show it again. */
try {
  document.documentElement.classList.add('js');
  setTimeout(function () { if (document.querySelector('#app > [data-olmoa-edge]')) document.documentElement.classList.remove('js'); }, 8000);
} catch (e) {}
