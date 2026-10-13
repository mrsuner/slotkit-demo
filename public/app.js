const $ = id => document.getElementById(id);
let selected = null, pending = JSON.parse(sessionStorage.getItem('pending-operation') ?? 'null'), target = null, busy = false;
const stamp = booking => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: booking.guest.timezone }).format(new Date(booking.start_at));
function message(text) { $('message').textContent = text; }
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message ?? 'Request failed');
    error.code = data.error?.code; error.requestId = data.error?.request_id; error.status = response.status; error.retryAfter = response.headers.get('Retry-After');
    throw error;
  }
  return data;
}
function showError(error) { message(`${error.message}${error.code ? ` (${error.code})` : ''}${error.requestId ? ` · Request ${error.requestId}` : ''}`); }
function lock() {
  const blocked = busy || Boolean(pending);
  for (const control of document.querySelectorAll('input,select,#load-slots,#slots button,#book,.actions button')) control.disabled = blocked;
  $('book').disabled = blocked || !selected;
  $('retry').hidden = !pending;
  $('retry').disabled = busy;
}
async function loadSlots() {
  selected = null; $('book').disabled = true; $('selection').textContent = target ? 'Select a new time, then confirm your reschedule.' : 'Select an available time above.';
  $('slots').replaceChildren();
  try {
    const { data } = await api(`/api/slots?${new URLSearchParams({ date: $('date').value, timezone: $('timezone').value })}`);
    if (!data.length) { const p = document.createElement('p'); p.textContent = 'No available times on this date. Choose another day.'; $('slots').append(p); }
    for (const slot of data) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed', 'false');
      button.textContent = new Intl.DateTimeFormat('en', { timeStyle: 'short', timeZone: $('timezone').value }).format(new Date(slot.start_at));
      button.onclick = () => {
        selected = slot;
        for (const sibling of $('slots').children) sibling.setAttribute('aria-pressed', String(sibling === button));
        $('selection').textContent = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: $('timezone').value }).format(new Date(slot.start_at));
        lock();
      };
      $('slots').append(button);
    }
  } catch (error) { showError(error); }
  lock();
}
async function refresh() {
  try {
    const { data } = await api('/api/bookings'); $('bookings').replaceChildren();
    if (!data.length) { const p = document.createElement('p'); p.textContent = 'Your confirmed sessions will appear here.'; $('bookings').append(p); }
    for (const booking of data) {
      const card = document.createElement('article'); card.className = 'booking';
      const info = document.createElement('div');
      const state = document.createElement('span'); state.className = 'status'; state.textContent = booking.status;
      const time = document.createElement('p'); time.textContent = stamp(booking);
      const details = document.createElement('p'); details.textContent = `${booking.guest.name} · Calendar: ${booking.calendar.status} · Version ${booking.version}`;
      info.append(state, time, details); card.append(info);
      if (booking.status === 'confirmed') {
        const actions = document.createElement('div'); actions.className = 'actions';
        const move = document.createElement('button'); move.className = 'secondary'; move.textContent = 'Reschedule';
        move.onclick = async () => { target = booking; $('name').value = booking.guest.name; $('email').value = booking.guest.email; $('timezone').value = booking.guest.timezone; $('book').textContent = 'Confirm reschedule'; await loadSlots(); $('date').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
        const cancel = document.createElement('button'); cancel.className = 'secondary'; cancel.textContent = 'Cancel booking';
        cancel.onclick = () => {
          if (cancel.dataset.confirm !== 'yes') { cancel.dataset.confirm = 'yes'; cancel.textContent = 'Confirm cancellation'; message('Select Confirm cancellation to cancel this booking.'); return; }
          start(`/api/bookings/${booking.id}/cancel`, { expected_version: booking.version });
        };
        actions.append(move, cancel); card.append(actions);
      }
      $('bookings').append(card);
    }
  } catch (error) { showError(error); }
  lock();
}
function start(path, body) {
  if (pending || busy) return;
  pending = { path, body: { ...body, operation_id: crypto.randomUUID() } };
  sessionStorage.setItem('pending-operation', JSON.stringify(pending));
  execute();
}
async function execute() {
  if (!pending || busy) return;
  busy = true; lock(); message('Confirming with Slotkit…');
  try {
    const result = await api(pending.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.body) });
    pending = null; sessionStorage.removeItem('pending-operation'); target = null; $('book').textContent = 'Confirm booking';
    message(`Booking ${result.data.status}. ${stamp(result.data)} · Request ${result.meta.request_id}`);
    await refresh(); await loadSlots();
  } catch (error) {
    if (error.status && error.status < 500 && error.status !== 429) { pending = null; sessionStorage.removeItem('pending-operation'); }
    showError(error);
    if (pending) { message($('message').textContent + ' Keep this request unchanged and retry.'); }
    if (error.retryAfter) {
      const seconds = Number(error.retryAfter) || Math.max(0, Math.ceil((Date.parse(error.retryAfter) - Date.now()) / 1000));
      $('retry').dataset.waitUntil = String(Date.now() + seconds * 1000);
    }
  } finally { busy = false; lock(); }
}
$('booking-form').onsubmit = event => {
  event.preventDefault(); if (!selected) return;
  if (target) start(`/api/bookings/${target.id}/reschedule`, { start_at: selected.start_at, expected_version: target.version });
  else start('/api/bookings', { start_at: selected.start_at, guest: { name: $('name').value, email: $('email').value, timezone: $('timezone').value } });
};
$('load-slots').onclick = loadSlots; $('refresh').onclick = refresh;
$('date').onchange = () => { selected = null; $('slots').replaceChildren(); lock(); };
$('timezone').onchange = loadSlots;
$('retry').onclick = () => { if (Number($('retry').dataset.waitUntil ?? 0) > Date.now()) return message('Please wait for the retry delay to finish.'); execute(); };
(async () => {
  try {
    const config = await api('/api/config'); $('date').value = config.date;
    const { data } = await api('/api/event'); $('event-description').textContent = `${data.duration_minutes} minutes · ${data.name}`;
    if (!data.bookable) message(`This session is unavailable: ${data.unavailable_reason}`);
    await loadSlots(); await refresh();
    if (pending) message('An earlier request is unresolved. Retry the original request to recover its result.');
  } catch (error) { showError(error); }
  lock();
})();
