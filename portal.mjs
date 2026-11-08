import { ConnectionClient } from './connection-client.mjs';
import { PagePresenceClient, startPermittedPresence, attachDownloadPresence } from './page-presence.mjs?v=preview-09';

const COMPANION_ORIGIN = 'http://127.0.0.1:23875';
const UNAVAILABLE = 'Open Windows XR Connect from the latest download after closing any earlier copy. Return here and choose Get my code. If prompted, allow local network access.';
const NOT_AUTHORIZED = 'Windows XR Connect has not authorized this page. Close the previous companion and open the latest version downloaded here, then choose Get my code again.';

export function bootstrapToken(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || typeof raw.controlToken !== 'string' || !/^[a-fA-F0-9]{64}$/.test(raw.controlToken)) {
    throw new Error('Invalid companion authorization');
  }
  return raw.controlToken;
}

/** No requests occur until activate() is called by the user's button click. */
export class WebConnectionPortal {
  constructor({ fetcher, changed, clock = Date.now,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer) }) {
    if (typeof fetcher !== 'function' || typeof changed !== 'function') throw new Error('Web connection unavailable');
    this.fetcher = fetcher; this.changed = changed; this.clock = clock;
    this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.client = null; this.bootstrapping = false; this.bootstrap = null; this.generation = 0; this.active = true; this.authorizationLost = false; this.instance = null;
  }
  async localFetch(path, options) {
    if (!/^\/api\/(status|start|pairing|disconnect)$/.test(path)) throw new Error('Unsupported companion action');
    const response = await this.fetcher(COMPANION_ORIGIN + path, { ...options, credentials: 'omit', mode: 'cors', targetAddressSpace: 'loopback' });
    if (response.status === 401 || response.status === 403) this.authorizationLost = true;
    return response;
  }
  get busy() { return this.bootstrapping || !!this.client?.busy; }
  async activate() {
    if (!this.active || this.bootstrapping) return false;
    if (this.authorizationLost) {
      this.client?.pause(); if (this.client) this.client.token = ''; this.client = null; this.authorizationLost = false;
    }
    if (this.client) return this.client.refresh();
    const generation = ++this.generation;
    const controller = new AbortController(); this.bootstrap = controller; this.bootstrapping = true;
    this.changed({ status: null, busy: true, error: null });
    let timeout = null;
    let authorized = false;
    try {
      timeout = this.setTimer(() => controller.abort(), 8000);
      const response = await this.fetcher(COMPANION_ORIGIN + '/api/web-bootstrap', {
        method: 'POST', mode: 'cors', targetAddressSpace: 'loopback', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'X-XROS-Web': '1' }, signal: controller.signal
      });
      if (!this.active || generation !== this.generation) return false;
      if (!response.ok) {
        this.changed({ status: null, busy: false, error: response.status === 403 ? NOT_AUTHORIZED : UNAVAILABLE });
        return false;
      }
      const raw = await response.json();
      const token = bootstrapToken(raw);
      if (!this.active || generation !== this.generation) return false;
      this.client = new ConnectionClient({ token, fetcher: this.localFetch.bind(this), changed: this.changed,
        clock: this.clock, setTimer: this.setTimer, clearTimer: this.clearTimer });
      this.instance = typeof raw.instance === 'string' && /^[a-f0-9]{32}$/.test(raw.instance) ? raw.instance : null;
      authorized = true;
    } catch {
      if (this.active && generation === this.generation) this.changed({ status: null, busy: false, error: UNAVAILABLE });
    } finally {
      // A timer failure must not leave the explicit action permanently busy.
      try { if (timeout !== null) this.clearTimer(timeout); } catch { controller.abort(); }
      if (generation === this.generation) { this.bootstrap = null; this.bootstrapping = false; }
    }
    return authorized ? this.client.refresh() : false;
  }
  refresh() { return this.active && this.client && !this.authorizationLost ? this.client.refresh() : Promise.resolve(false); }
  start(address) { return this.active && this.client ? this.client.start(address) : Promise.resolve(false); }
  pair() { return this.active && this.client ? this.client.pair() : Promise.resolve(false); }
  disconnect() { return this.active && this.client ? this.client.disconnect() : Promise.resolve(false); }
  pause() {
    this.active = false; this.generation++; this.bootstrap?.abort(); this.bootstrap = null; this.bootstrapping = false;
    this.client?.pause();
  }
  resume() { this.active = true; return this.client ? this.client.resume() : Promise.resolve(false); }
  resetAuthorization(message = null) {
    // A native activation refreshes this UI, never the live XR/backend session.
    const active = this.active; this.pause(); this.active = active;
    if (this.client) this.client.token = '';
    this.client = null; this.instance = null; this.authorizationLost = false;
    this.changed({ status: null, busy: false, error: message, reset: true });
  }
  close() { this.pause(); if (this.client) this.client.token = ''; this.client = null; this.instance = null; }
}

export function attachPortal(document, window) {
  const byId = id => document.getElementById(id);
  const network = byId('web-network');
  let portal; let current = null; let busy = false; let error = null; let optionsKey = null; let poll = null; let tick = null;
  function renderCode() {
    const remaining = current && Number.isFinite(current.expires) ? Math.max(0, Math.ceil((current.expires - Date.now()) / 1000)) : 0;
    const visible = current?.state === 'ready' && !!current.code && remaining > 0;
    byId('web-pairing').hidden = !visible;
    byId('web-pairing-code').textContent = visible ? current.code : '';
    byId('web-pairing-countdown').textContent = visible ? `Enter this code in Windows XR on Quest · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining` : '';
    const renew = current?.state === 'ready' && !current.paired && !visible;
    byId('web-renew-button').hidden = !renew; byId('web-renew-button').disabled = busy;
    if (current?.code && !visible && current.state === 'ready') byId('portal-status').textContent = 'The code expired. Get a new code to connect.';
  }
  const changed = update => {
    if (update.reset) { error = null; optionsKey = null; }
    if (update.error) error = update.error;
    else if (!update.settled && update.status && update.status !== current) error = null;
    current = update.status; busy = update.busy;
    byId('portal-notice').textContent = error || current?.notice || '';
    byId('portal-notice').hidden = !byId('portal-notice').textContent;
    byId('get-code-button').hidden = !!current && !portal?.authorizationLost;
    byId('get-code-button').disabled = busy;
    byId('portal-status').textContent = current?.description || (busy ? 'Checking Windows XR Connect on this PC…' : 'Close any previous companion and open the updated Windows XR Connect on this PC. Then select Get my code and allow local network access if prompted.');
    const canStart = !!current?.canStart;
    byId('web-connection-form').hidden = !canStart;
    if (current) {
      const key = JSON.stringify(current.addresses);
      if (key !== optionsKey) {
        const selected = network.value;
        const options = current.addresses.map(row => { const option = document.createElement('option'); option.value = row.address; option.textContent = row.name ? `${row.name} · ${row.address}` : row.address; return option; });
        network.replaceChildren(...options);
        if (current.addresses.some(row => row.address === selected)) network.value = selected;
        optionsKey = key;
      }
      if (current.selectedAddress && current.addresses.some(row => row.address === current.selectedAddress)) network.value = current.selectedAddress;
      network.hidden = current.addresses.length <= 1; byId('web-network-label').hidden = network.hidden;
      network.disabled = busy;
      byId('web-allow-button').disabled = busy || !canStart || !network.value;
      byId('web-disconnect-button').hidden = !current.canDisconnect;
      byId('web-disconnect-button').disabled = busy || !current.canDisconnect;
    } else {
      byId('web-disconnect-button').hidden = true;
    }
    renderCode();
  };
  portal = new WebConnectionPortal({ fetcher: window.fetch.bind(window), changed });
  let presence = null; let permission = null;
  if (window.crypto?.getRandomValues) {
    const pageId = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    presence = new PagePresenceClient({ pageId,
      fetcher: (path, options) => window.fetch(COMPANION_ORIGIN + path, { ...options, mode: 'cors', targetAddressSpace: 'loopback' }),
      changed: ({ restarted }) => {
        // A current explicit first bootstrap has no stale credential to clear.
        // A real instance change still fences any old in-flight bootstrap.
        if (restarted || !portal.bootstrapping || portal.client) portal.resetAuthorization();
      }, unavailable: () => portal.resetAuthorization(UNAVAILABLE) });
    permission = startPermittedPresence(presence, window.navigator);
  }
  const downloadPresence = attachDownloadPresence(document, presence);
  const localDashboard = window.isSecureContext === false
    && ['windowsxr.com', 'www.windowsxr.com'].includes(window.location.hostname);
  if (localDashboard) {
    byId('portal-status').textContent = 'Open the updated Windows XR Connect on this PC. Get my code opens its local dashboard while HTTPS is being set up.';
  }
  byId('get-code-button').addEventListener('click', () => {
    if (localDashboard) { window.location.assign(COMPANION_ORIGIN + '/'); return; }
    void (async () => {
      await portal.activate();
      // This button is the explicit local-network permission interaction.
      if (presence && portal.instance) presence.instance = portal.instance;
      presence?.start();
    })();
  });
  byId('web-connection-form').addEventListener('submit', event => { event.preventDefault(); void portal.start(network.value); });
  byId('web-renew-button').addEventListener('click', () => { void portal.pair(); });
  byId('web-disconnect-button').addEventListener('click', () => { void portal.disconnect(); });
  function stopTimers() { if (poll !== null) window.clearInterval(poll); if (tick !== null) window.clearInterval(tick); poll = tick = null; }
  function startTimers() { stopTimers(); poll = window.setInterval(() => { if (!document.hidden) void portal.refresh(); }, 2000); tick = window.setInterval(renderCode, 1000); }
  const visibility = () => { if (document.hidden) { stopTimers(); portal.pause(); } else { startTimers(); void portal.resume(); } };
  document.addEventListener('visibilitychange', visibility);
  const close = () => { stopTimers(); downloadPresence.close(); permission?.close(); presence?.close(); portal.close(); document.removeEventListener('visibilitychange', visibility); };
  window.addEventListener('pagehide', close, { once: true });
  if (!document.hidden) startTimers();
  return { close };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') attachPortal(document, window);
