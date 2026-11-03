const STATES = new Set(['idle', 'starting', 'ready', 'paired', 'stopping', 'error']);
const PAIRING_CODE = /^[0-9]{6}$/;
const NETWORK_MESSAGE = 'Windows XR Connect is not responding. Keep it open on this PC, then choose Check again.';
const SAFE_MESSAGES = {
  400: 'Check the selected network and try again.',
  401: 'This connection page is no longer authorized. Open it again from Windows XR Connect.',
  403: 'This connection page is not authorized. Open it from Windows XR Connect on this PC.',
  409: 'The connection changed. Check its status before trying again.',
  429: 'Please wait a moment before trying again.',
  503: 'The connection is not ready yet. Check its status and try again.'
};

export function privateIpv4(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  if (parts.some((n, i) => n > 255 || String(n) !== value.split('.')[i])) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function formatPairingCode(value) {
  return typeof value === 'string' && PAIRING_CODE.test(value) ? value : null;
}

export function projectStatus(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !STATES.has(raw.state)
      || !Array.isArray(raw.addresses) || raw.addresses.length > 64
      || typeof raw.paired !== 'boolean') throw new Error('Invalid connection status');
  const addresses = [];
  const seen = new Set();
  for (const row of raw.addresses) {
    if (!row || !privateIpv4(row.address) || typeof row.name !== 'string'
        || row.name.length > 160 || seen.has(row.address)) continue;
    seen.add(row.address);
    addresses.push({ address: row.address, name: row.name.replace(/[\x00-\x1f\x7f]/g, '') });
  }
  const state = raw.state;
  const paired = state === 'paired' && raw.paired;
  if ((state === 'paired') !== raw.paired) throw new Error('Inconsistent connection status');
  const expires = typeof raw.pairingExpiresUtc === 'string' ? Date.parse(raw.pairingExpiresUtc) : NaN;
  const candidate = formatPairingCode(raw.pairingCode);
  const secondsRemaining = Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - now) / 1000)) : 0;
  const code = state === 'ready' && !paired && candidate && secondsRemaining > 0 ? candidate : null;
  const text = {
    idle: ['Not connected', 'Choose the PC network your Quest uses, then allow a connection.'],
    starting: ['Starting', 'Preparing the connection. Keep Windows XR Connect open.'],
    ready: ['Ready to pair', code ? 'Enter this six-digit code in Windows XR on your Quest, before its opening animation.' : 'Generate a new six-digit code to pair your Quest.'],
    paired: ['Paired', 'Your Quest is paired. Open Windows XR on your headset to choose a Windows app.'],
    stopping: ['Disconnecting', 'Ending access from Quest. Your Windows apps will remain open.'],
    error: ['Needs attention', 'The connection could not be prepared. Check the notice below.']
  }[state];
  return {
    state, addresses, paired, code, expires, secondsRemaining,
    selectedAddress: privateIpv4(raw.selectedAddress) ? raw.selectedAddress : null,
    label: text[0], description: text[1],
    canStart: (state === 'idle' || state === 'error') && addresses.length > 0,
    canPair: state === 'ready' && !paired && !code,
    canDisconnect: state === 'starting' || state === 'ready' || state === 'paired' || state === 'error',
    networkLocked: state !== 'idle' && state !== 'error',
    notice: typeof raw.notice === 'string' && raw.notice.length <= 480
      ? raw.notice.replace(/[\x00-\x1f\x7f]/g, ' ') : null
  };
}

export class ConnectionClient {
  constructor({ fetcher, token, changed, clock = Date.now,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer) }) {
    if (typeof fetcher !== 'function' || typeof changed !== 'function'
        || typeof setTimer !== 'function' || typeof clearTimer !== 'function'
        || typeof token !== 'string' || token.length < 32 || token.length > 256
        || !/^[a-zA-Z0-9_-]+$/.test(token)) throw new Error('Connection page authorization unavailable');
    this.fetcher = fetcher;
    this.token = token;
    this.changed = changed;
    this.clock = clock;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.generation = 0;
    this.request = null;
    this.busy = false;
    this.active = true;
    this.status = null;
  }
  emit(error = null) { this.changed({ status: this.status, busy: this.busy, error }); }
  async exchange(path, body) {
    if (!this.active) return false;
    if (this.busy && body === undefined) return false;
    const isAction = body !== undefined;
    if (this.busy && isAction) return false;
    const generation = ++this.generation;
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    if (isAction) this.busy = true;
    this.emit();
    // Starting a fresh Windows backend has its own bounded cold-start budget.
    // Keep observing that same operation instead of cutting it off at the
    // shorter status-read timeout and encouraging an accidental second start.
    const timeoutMs = path === '/api/start' ? 35000 : path === '/api/disconnect' ? 20000 : path === '/api/pairing' ? 15000 : 8000;
    let timeout = null;
    try {
      timeout = this.setTimer(() => controller.abort(), timeoutMs);
      const response = await this.fetcher(path, {
        method: isAction ? 'POST' : 'GET',
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        headers: { 'X-XROS-Control': this.token, ...(isAction ? { 'Content-Type': 'application/json' } : {}) },
        ...(isAction ? { body: JSON.stringify(body) } : {}), signal: controller.signal
      });
      if (!this.active || generation !== this.generation) return false;
      if (!response.ok) throw new ResponseError(SAFE_MESSAGES[response.status] || 'Windows XR Connect could not complete this action. Check again before retrying.');
      const raw = await response.json();
      if (!this.active || generation !== this.generation) return false;
      this.status = projectStatus(raw, this.clock());
      this.emit();
      return true;
    } catch (error) {
      if (this.active && generation === this.generation) this.emit(error instanceof ResponseError ? error.message : NETWORK_MESSAGE);
      return false;
    } finally {
      // Cleanup cannot strand an otherwise completed or failed user action.
      try { if (timeout !== null) this.clearTimer(timeout); } catch { controller.abort(); }
      if (generation === this.generation) {
        this.request = null;
        this.busy = false;
        // Keep an error shown by catch until the next successful response.
        if (this.active) this.changed({ status: this.status, busy: false, settled: true });
      }
    }
  }
  refresh() { return this.exchange('/api/status'); }
  start(address) {
    if (!privateIpv4(address)) { this.emit('Choose a valid PC network first.'); return Promise.resolve(false); }
    return this.exchange('/api/start', { address });
  }
  pair() { return this.exchange('/api/pairing', {}); }
  disconnect() { return this.exchange('/api/disconnect', {}); }
  pause() {
    this.active = false; this.generation++; this.request?.abort(); this.request = null; this.busy = false;
  }
  resume() { this.active = true; return this.refresh(); }
}
class ResponseError extends Error {}
