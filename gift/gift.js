import {fetchPreview, parseGiftLink} from './gift-protocol.mjs';

const byId = id => document.getElementById(id);
const input = byId('gift-link'), status = byId('status'), details = byId('introduction');
const preview = byId('preview'), copy = byId('copy');
let current = null, generation = 0, controller = null;

function clearDetails() {
  details.hidden = true;
  for (const id of ['plant-name', 'scientific-name', 'care-note', 'introduced-at', 'expires-at']) byId(id).textContent = '';
}
function cancel() { generation++; controller?.abort(); controller = null; preview.disabled = false; }
function readLink() { try { return parseGiftLink(input.value); } catch { return null; } }
input.addEventListener('input', () => {
  cancel(); clearDetails(); current = null; copy.disabled = !readLink();
  status.textContent = 'Choose Preview introduction to check this link.';
});
function date(value) { return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value)); }
async function load() {
  cancel(); clearDetails(); current = readLink(); copy.disabled = !current;
  if (!current) { status.textContent = 'Paste the complete, unchanged BloomDoc gift link. Other links are not accepted.'; return; }
  const version = generation;
  controller = new AbortController(); const active = controller;
  const timeout = setTimeout(() => active.abort(), 20000);
  preview.disabled = true; status.textContent = 'Checking the shared introduction…';
  try {
    const result = await fetchPreview(current.url, {signal: active.signal});
    if (version !== generation || document.hidden) return;
    byId('plant-name').textContent = result.snapshot.name;
    byId('scientific-name').textContent = result.snapshot.scientific_name ?? 'Not shared';
    byId('care-note').textContent = result.snapshot.care_note ?? 'No care note was shared.';
    byId('introduced-at').textContent = date(result.created_at);
    byId('expires-at').textContent = date(result.expires_at);
    details.hidden = false;
    status.textContent = 'Only these deliberately shared details are included. Availability is checked again when you accept in BloomDoc.';
  } catch (error) {
    if (version !== generation || document.hidden) return;
    status.textContent = error.kind === 'unavailable'
      ? 'This introduction is not available. The link may have expired, ended, or already been accepted. Ask the sender for a new introduction.'
      : error.kind === 'limited' ? 'Too many preview requests. Please wait a little, then try again.'
      : 'The introduction could not be checked. Check your connection and try again. Nothing has been accepted.';
  } finally { clearTimeout(timeout); if (version === generation) { preview.disabled = false; controller = null; } }
}
preview.addEventListener('click', load);
copy.addEventListener('click', async () => {
  const link = readLink(); if (!link) return;
  const version = generation;
  try {
    await navigator.clipboard.writeText(link.url);
    if (version === generation) status.textContent = 'Gift link copied. Open BloomDoc, then tap Paste gift link.';
  } catch {
    if (version === generation) { input.focus(); input.select(); status.textContent = 'Copy the selected link using your browser, then explicitly paste it in BloomDoc.'; }
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  cancel(); clearDetails();
  status.textContent = 'Preview hidden. Choose Preview introduction to check the latest shared details.';
});
window.addEventListener('pagehide', () => { cancel(); clearDetails(); });
window.addEventListener('hashchange', () => {
  cancel(); clearDetails(); input.value = ''; current = null; copy.disabled = true;
  initialize();
});
function initialize() {
  // Local preview is an empty working surface, never a synthetic live gift.
  // Do not turn an arbitrary hosting origin's fragment into an accepted URL.
  try { const link = parseGiftLink(window.location.href); input.value = link.url; copy.disabled = false; void load(); }
  catch { status.textContent = 'Open the original gift link, or paste it below to preview the introduction.'; }
}
initialize();
