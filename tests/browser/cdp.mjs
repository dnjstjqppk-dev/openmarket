// tests/browser/cdp.mjs
// Minimal Chrome DevTools Protocol driver (no npm deps): launches headless Chrome/Edge, records console errors,
// uncaught exceptions and failed/4xx-5xx network requests, and captures PC/tablet/mobile screenshots.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  desktop1280: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
  tablet_landscape: { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true },
  tablet_portrait: { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  mobile360: { width: 360, height: 740, deviceScaleFactor: 2, mobile: true }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchBrowser({ port = 9333 } = {}) {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge executable found (set CHROME_PATH)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'olmoa-cdp-'));
  // GitHub Actions runs as root: Chrome refuses to start without --no-sandbox there.
  const ciFlags = process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : [];
  const proc = spawn(exe, [`--remote-debugging-port=${port}`, '--headless=new', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--lang=ko-KR', ...ciFlags, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* starting */ }
    await sleep(100);
  }
  return {
    exe,
    async newPage() {
      const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      return Page.connect(t.webSocketDebuggerUrl);
    },
    async close() { try { proc.kill(); } catch { /* ignore */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } }
  };
}

class Page {
  static async connect(wsUrl) {
    const p = new Page();
    p.ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { p.ws.onopen = res; p.ws.onerror = rej; });
    p.id = 0; p.pending = new Map(); p.listeners = []; p.console = []; p.network = []; p.requests = new Map();
    p.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && p.pending.has(msg.id)) {
        const { resolve, reject } = p.pending.get(msg.id); p.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
      } else if (msg.method) {
        p.onEvent(msg.method, msg.params);
        for (const l of p.listeners) l(msg.method, msg.params);
      }
    };
    await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'].map((m) => p.send(m)));
    return p;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  onEvent(method, params) {
    if (method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(params.type)) {
      this.console.push({ type: params.type, text: params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (method === 'Runtime.exceptionThrown') {
      this.console.push({ type: 'exception', text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text });
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      this.console.push({ type: 'log', text: `${params.entry.text} ${params.entry.url || ''}` });
    } else if (method === 'Network.requestWillBeSent') {
      this.requests.set(params.requestId, { url: params.request.url, method: params.request.method });
    } else if (method === 'Network.responseReceived') {
      const rq = this.requests.get(params.requestId);
      if (params.response.status >= 400) this.network.push({ status: params.response.status, url: params.response.url, method: rq?.method });
    } else if (method === 'Network.loadingFailed' && !params.canceled) {
      const rq = this.requests.get(params.requestId);
      this.network.push({ status: 'FAILED', url: rq?.url, error: params.errorText });
    }
  }
  async viewport(name) {
    const v = VIEWPORTS[name];
    this.currentWidth = v.width;
    await this.send('Emulation.setDeviceMetricsOverride', v);
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile });
  }
  async goto(url, { waitFor } = {}) {
    const loaded = new Promise((res) => { const l = (m) => { if (m === 'Page.loadEventFired') { this.listeners = this.listeners.filter((x) => x !== l); res(); } }; this.listeners.push(l); });
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(15000)]);
    if (waitFor) await this.waitFor(waitFor);
    await this.idle();
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async waitFor(jsCondition, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.eval(`Boolean(${jsCondition})`)) return true; } catch { /* page navigating */ }
      await sleep(150);
    }
    throw new Error(`timeout waiting for: ${jsCondition}`);
  }
  async idle(ms = 600) { await sleep(ms); }
  /** Sets an input's value through the native setter so Vue's v-model receives the input event. */
  async type(selector, text) {
    await this.waitFor(`document.querySelector(${JSON.stringify(selector)})`);
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  async check(selector) {
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el.checked) el.click(); })()`);
  }
  async click(selectorOrText) {
    const expr = selectorOrText.startsWith('text=')
      ? `[...document.querySelectorAll('button,a')].find((b) => b.offsetParent !== null && b.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(selectorOrText.slice(5))}))`
      : `document.querySelector(${JSON.stringify(selectorOrText)})`;
    await this.waitFor(expr);
    await this.eval(`(${expr}).click()`);
    await this.idle(400);
  }
  async screenshot(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
  async hasHorizontalOverflow() {
    // Compare against the emulated device width: when content overflows, mobile Chrome zooms out and innerWidth grows too.
    return this.eval(`Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth) > ${this.currentWidth || 0} + 1`);
  }
  drainIssues() {
    const out = { console: this.console.splice(0), network: this.network.splice(0) };
    return out;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
