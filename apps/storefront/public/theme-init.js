/* Theme before first paint (see useTheme in @olmoa/ui). External file (not
 * inline) so the Content-Security-Policy script-src 'self' stays strict.
 * Render-blocking by design: it must run before Vue mounts to avoid a flash. */
try { var m = localStorage.getItem('olmoa_theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m) } catch (e) {}
