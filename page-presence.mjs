const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

/** Own-page activation only: no control token, code, PC address or session action. */
export class PagePresenceClient {
  constructor({ fetcher, pageId, changed, updated = () => {}, unavailable = () => {},
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay), clearTimer = timer => globalThis.clearTimeout(timer) }) {
    if (!id(pageId) || typeof fetcher !== 'function' || typeof changed !== 'function') throw new Error('Invalid page presence');
    Object.assign(this, { fetcher, pageId, changed, updated, unavailable, setTimer, clearTimer });
    this.instance = null; this.ticket = null; this.closed = false; this.busy = false; this.running = false;
    this.request = null; this.retry = null; this.available = false; this.pendingUpdate = false;
  }
  async pulse() {
    if (this.closed || this.busy) return false;
    this.busy = true;
    const controller = new AbortController(); this.request = controller;
    let timeout = null;
    try {
      timeout = this.setTimer(() => controller.abort(), 14000);
      // One extra exchange acknowledges the ticket only after our UI consumed it.
      for (let acknowledgement = null, turn = 0; turn < 2; turn++) {
        const response = await this.fetcher('/api/page-presence', {
          method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-XROS-Web': '1' }, signal: controller.signal,
          body: JSON.stringify({ pageId: this.pageId, instance: this.instance, acknowledgement })
        });
        if (this.closed) return false;
        if (!response.ok) throw new Error('Companion unavailable');
        const state = await response.json();
        if (this.closed) return false;
        if (!state || !id(state.instance) || state.activation !== null && !id(state.activation)) throw new Error('Invalid presence response');
        const restarted = this.instance !== null && this.instance !== state.instance;
        const activated = state.activation !== null && this.ticket !== state.activation;
        this.instance = state.instance; this.available = true;
        if (restarted || activated) { this.changed({ restarted, activated }); this.pendingUpdate = true; }
        if (state.activation === null) { this.finishUpdate(); return true; }
        this.ticket = acknowledgement = state.activation;
      }
      this.finishUpdate(); return true;
    } catch {
      if (!this.closed && this.available) { this.available = false; this.unavailable(); }
      return false;
    } finally {
      try { if (timeout !== null) this.clearTimer(timeout); } catch { controller.abort(); }
      this.request = null; this.busy = false;
    }
  }
  finishUpdate() { if (this.pendingUpdate && !this.closed) { this.pendingUpdate = false; this.updated(); } }
  start() {
    if (this.closed || this.running) return;
    this.running = true;
    this.loop = (async () => {
      try {
        while (!this.closed) {
          const ok = await this.pulse();
          if (this.closed) break;
          if (!ok) await new Promise(resolve => {
            const retry = { timer: null, resolve }; this.retry = retry;
            try { retry.timer = this.setTimer(() => { if (this.retry === retry) this.retry = null; resolve(); }, 2000); }
            catch { this.closed = true; this.retry = null; resolve(); }
          });
        }
      } catch { /* A UI callback failure cannot terminate the companion/XR. */ }
      finally { this.running = false; }
    })();
  }
  close() {
    this.closed = true; this.request?.abort();
    if (this.retry) {
      const retry = this.retry; this.retry = null;
      try { if (retry.timer !== null) this.clearTimer(retry.timer); } finally { retry.resolve(); }
    }
  }
}

// A first visit must not provoke an unsolicited local-network permission prompt.
// The explicit Get my code click can start presence; otherwise we only observe
// a permission that the browser reports as already granted.
export function startPermittedPresence(client, navigator) {
  let closed = false; let permission = null;
  const changed = () => { if (!closed && permission?.state === 'granted') client.start(); };
  const ready = (async () => {
    try {
      permission = await navigator?.permissions?.query({ name: 'local-network-access' });
      if (closed) return;
      permission?.addEventListener?.('change', changed); changed();
    } catch { /* Unsupported permission queries do not authorize a local request. */ }
  })();
  return { ready, close() { closed = true; permission?.removeEventListener?.('change', changed); } };
}

// Download is already an explicit PC-setup gesture. Start only the inert page
// handoff channel while the user installs; do not intercept the download or
// bootstrap credentials, choose a network, issue a code, or start a session.
export function attachDownloadPresence(document, client) {
  const download = document.querySelector('#pc-view .hero-download a.download');
  const clicked = () => client?.start();
  download?.addEventListener('click', clicked);
  return { close() { download?.removeEventListener('click', clicked); } };
}
