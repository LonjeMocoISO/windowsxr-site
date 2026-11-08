const website = '54eb8a67-0f98-4d07-badf-6c2bb5ea3640';
const endpoint = 'https://gateway.umami.is/api/send';
const preferenceKey = 'windowsxr.analytics.disabled';
const attached = new WeakMap();

// Analytics is deliberately separate from pairing and never reads page content.
export function attachAnalytics(browser, page) {
  if (attached.has(page)) return attached.get(page);
  let closed = false;
  let viewSent = false;
  let preferenceUnavailable = false;
  const listeners = [];
  const controller = Object.freeze({ close() {
    closed = true;
    for (const [target, name, handler] of listeners) {
      try { target.removeEventListener(name, handler); } catch { /* Optional UI only. */ }
    }
    listeners.length = 0;
  } });
  attached.set(page, controller);

  function context() {
    try {
      const location = browser.location;
      if (location.protocol !== 'https:' ||
          !['windowsxr.com', 'www.windowsxr.com'].includes(location.hostname) ||
          (location.port !== '' && location.port !== '443')) return null;
      if (location.pathname === '/' || location.pathname === '/index.html') return { url: '/', title: 'Windows XR' };
      if (location.pathname === '/privacy.html') return { url: '/privacy.html', title: 'Privacy Policy · Windows XR' };
    } catch { /* Unsupported context must not send. */ }
    return null;
  }
  const initialContext = context();
  if (!initialContext) return controller;

  function preferences() {
    let privacySignal;
    try {
      const navigator = browser.navigator;
      const signals = [navigator.doNotTrack, navigator.msDoNotTrack, browser.doNotTrack];
      privacySignal = navigator.globalPrivacyControl === true ||
        signals.some(value => value === '1' || value === 'yes' || value === true);
    } catch { privacySignal = true; }
    if (privacySignal) return { off: true, privacySignal: true };
    if (preferenceUnavailable) return { off: true, unavailable: true };
    try { return { off: browser.localStorage.getItem(preferenceKey) === '1' }; }
    catch { return { off: true, unavailable: true }; }
  }

  let toggle;
  let status;
  try {
    toggle = page.getElementById('analytics-toggle');
    status = page.getElementById('analytics-status');
  } catch { /* These controls exist only on the privacy page. */ }

  function updateControls(state = preferences()) {
    try {
      if (toggle) {
        toggle.disabled = Boolean(state.privacySignal || state.unavailable);
        toggle.textContent = state.privacySignal ? 'Browser privacy preference respected' :
          state.unavailable ? 'Analytics preference unavailable' :
          state.off ? 'Turn website analytics on' : 'Turn website analytics off';
        toggle.setAttribute('aria-pressed', state.off ? 'false' : 'true');
      }
      if (status) status.textContent = state.privacySignal ?
        'Website analytics is off because your browser requests privacy.' :
        state.unavailable ? 'Website analytics is off because your saved preference is unavailable.' :
        state.off ? 'Website analytics is off in this browser.' :
        'Website analytics is on. Only page views and download-button clicks are counted.';
    } catch { /* Analytics controls cannot affect the connection page. */ }
    return state;
  }

  function screenSize() {
    try {
      const width = browser.screen.width;
      const height = browser.screen.height;
      return [width, height].every(value => Number.isInteger(value) && value > 0 && value <= 16384) ?
        `${width}x${height}` : '0x0';
    } catch { return '0x0'; }
  }
  function language() {
    try {
      const value = browser.navigator.language;
      return typeof value === 'string' && /^[a-z]{2}(?:-|$)/i.test(value) ?
        value.slice(0, 2).toLowerCase() : 'und';
    } catch { return 'und'; }
  }

  function send(name) {
    try {
      if (closed || updateControls().off) return;
      const current = context();
      if (!current || current.url !== initialContext.url) return;
      if (name !== undefined && name !== 'download_apk' && name !== 'download_connect') return;
      if (name !== undefined && current.url !== '/') return;
      const payload = {
        website, hostname: 'windowsxr.com', url: current.url, referrer: '',
        title: current.title, screen: screenSize(), language: language()
      };
      if (name !== undefined) payload.name = name;
      // No response cache, session identifier, retry, cookie or authorization.
      Promise.resolve(browser.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-umami-website-id': website, 'x-umami-hostname': 'windowsxr.com' },
        credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
        cache: 'no-store', redirect: 'error', body: JSON.stringify({ type: 'event', payload })
      })).catch(() => {});
    } catch { /* Offline analytics must never interrupt setup or a download. */ }
  }
  function sendViewOnce() {
    if (closed || viewSent || updateControls().off) return;
    viewSent = true;
    send();
  }
  function listen(target, name, action) {
    if (!target) return;
    const handler = event => { try { action(event); } catch { /* Optional analytics only. */ } };
    try { target.addEventListener(name, handler); listeners.push([target, name, handler]); } catch { /* No interception. */ }
  }

  listen(toggle, 'click', () => {
    const state = preferences();
    if (state.privacySignal || state.unavailable || closed) { updateControls(state); return; }
    try {
      if (state.off) browser.localStorage.removeItem(preferenceKey);
      else browser.localStorage.setItem(preferenceKey, '1');
    } catch { preferenceUnavailable = true; }
    updateControls();
    sendViewOnce();
  });
  listen(browser, 'storage', event => {
    if (event.key === preferenceKey || event.key === null) { updateControls(); sendViewOnce(); }
  });
  if (initialContext.url === '/') {
    try {
      for (const link of page.querySelectorAll('a[data-analytics-download]')) {
        const kind = link.getAttribute('data-analytics-download');
        const name = kind === 'apk' ? 'download_apk' : kind === 'connect' ? 'download_connect' : null;
        if (name) {
          listen(link, 'click', () => send(name));
          listen(link, 'auxclick', event => { if (event.button === 1) send(name); });
        }
      }
    } catch { /* A missing download link has no effect on navigation. */ }
  }
  updateControls();
  sendViewOnce();
  return controller;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try { attachAnalytics(window, document); } catch { /* Keep all setup features independent. */ }
}
