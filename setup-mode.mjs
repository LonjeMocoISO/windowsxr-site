// Presentation only. Connection state and controls stay mounted in the PC view.
const tabs = [...document.querySelectorAll('[data-device]')];
const panels = { pc: document.getElementById('pc-view'), headset: document.getElementById('headset-view') };
const tablist = document.querySelector('[role="tablist"]');

function selectDevice(device, { focus = false, updateHash = false } = {}) {
  if (device !== 'pc' && device !== 'headset') return;
  for (const tab of tabs) {
    const selected = tab.dataset.device === device;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== device;
  document.title = device === 'headset' ? 'Set up your headset · Windows XR' : 'Connect your PC · Windows XR';
  if (updateHash) history.replaceState(history.state, '', '#' + device);
}

for (const tab of tabs) tab.addEventListener('click', () => selectDevice(tab.dataset.device, { updateHash: true }));
tablist.addEventListener('keydown', event => {
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : delta ? (current + delta + tabs.length) % tabs.length : -1;
  if (next < 0) return;
  event.preventDefault();
  selectDevice(tabs[next].dataset.device, { focus: true, updateHash: true });
});
document.querySelector('[data-go-pc]').addEventListener('click', () => selectDevice('pc', { focus: true, updateHash: true }));
window.addEventListener('hashchange', () => selectDevice(location.hash === '#headset' ? 'headset' : 'pc'));
selectDevice(location.hash === '#headset' ? 'headset' : 'pc');
