export const giftOrigin = 'https://getbloomdoc.com';
export const previewEndpoint = 'https://yzbwuqwtlfrjngsuqswc.supabase.co/functions/v1/plant-gift-preview';
export const openAppUrl = 'com.schilllabs.bloomdoc://gift/';
const invalid = () => { throw new Error('Invalid plant introduction.'); };

export function parseGiftLink(raw) {
  if (typeof raw !== 'string') invalid();
  const match = /^https:\/\/getbloomdoc\.com\/gift\/#v=1&t=([a-f0-9]{64})$/.exec(raw);
  if (!match || match[0].length !== raw.length) invalid();
  return Object.freeze({token: match[1], url: raw});
}

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      !Object.keys(value).every(key => keys.includes(key))) invalid();
  return value;
}
function text(value, limit, note = false) {
  if (typeof value !== 'string' || !value || value.trim() !== value || [...value].length > limit) invalid();
  for (const char of value) {
    const code = char.codePointAt(0);
    if ((code < 32 && !(note && [9, 10, 13].includes(code))) ||
        (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff)) invalid();
  }
  return value;
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 2000 || parsed.getUTCFullYear() > 2100 ||
      parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) invalid();
  return value;
}
function microseconds(value) {
  const fraction = /\.(\d{1,6})(?:Z|\+00:00)$/.exec(value)?.[1] ?? '';
  return BigInt(Date.parse(value.slice(0, 19) + 'Z')) * 1000n + BigInt(fraction.padEnd(6, '0'));
}
export function validatePreview(raw) {
  const value = object(raw, ['version', 'id', 'revision', 'snapshot', 'created_at', 'expires_at']);
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 2147483647 ||
      typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id)) invalid();
  const source = object(value.snapshot, ['name', 'scientific_name', 'care_note']);
  const snapshot = Object.freeze({name: text(source.name, 80),
    scientific_name: source.scientific_name === null ? null : text(source.scientific_name, 120),
    care_note: source.care_note === null ? null : text(source.care_note, 1000, true)});
  const created = time(value.created_at), expires = time(value.expires_at);
  const duration = microseconds(expires) - microseconds(created), day = 86400000000n;
  if (duration < day || duration > 30n * day || duration % day !== 0n) invalid();
  return Object.freeze({version: 1, id: value.id, revision: value.revision, snapshot, created_at: created, expires_at: expires});
}

/// Reject duplicate JSON keys before field validation. JSON.parse alone accepts
/// ambiguous receipts. The wire body, nesting and total parsed nodes are bounded.
export function decodePreview(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 16384) invalid();
  let offset = 0, nodes = 0;
  function whitespace() { while (/[\x20\t\r\n]/.test(raw[offset] ?? '') && offset < raw.length) offset++; }
  function string() {
    const start = offset++;
    while (offset < raw.length) {
      const char = raw[offset++];
      if (char === '\\') { offset++; continue; }
      if (char === '"') return JSON.parse(raw.slice(start, offset));
    }
    invalid();
  }
  function read(depth = 0) {
    whitespace();
    if (++nodes > 100 || depth > 5) invalid();
    const char = raw[offset];
    if (char === '"') return string();
    if (char === '{') {
      offset++; whitespace();
      const result = Object.create(null), keys = new Set();
      if (raw[offset] === '}') { offset++; return result; }
      while (true) {
        whitespace(); if (raw[offset] !== '"') invalid();
        const key = string(); if (keys.has(key)) invalid(); keys.add(key);
        whitespace(); if (raw[offset++] !== ':') invalid();
        result[key] = read(depth + 1); whitespace();
        const ending = raw[offset++]; if (ending === '}') return result;
        if (ending !== ',') invalid();
      }
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(offset));
    if (!match) invalid(); offset += match[0].length; return JSON.parse(match[0]);
  }
  try { const value = read(); whitespace(); if (offset !== raw.length) invalid(); return validatePreview(value); }
  catch { invalid(); }
}

export class GiftPreviewError extends Error {
  constructor(kind) { super('Plant introduction could not be loaded.'); this.kind = kind; }
}
export async function fetchPreview(rawLink, {fetcher = fetch, signal} = {}) {
  const link = parseGiftLink(rawLink);
  let response;
  try {
    response = await fetcher(previewEndpoint, {method: 'POST', body: JSON.stringify({token: link.token}),
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal});
  } catch { throw new GiftPreviewError('network'); }
  if (response.status === 404) throw new GiftPreviewError('unavailable');
  if (response.status === 429) throw new GiftPreviewError('limited');
  if (!response.ok) throw new GiftPreviewError('network');
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new GiftPreviewError('invalid');
  const reader = response.body?.getReader();
  if (!reader) throw new GiftPreviewError('invalid');
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); throw new GiftPreviewError('invalid'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
    return decodePreview(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch { throw new GiftPreviewError('invalid'); }
  finally { reader.releaseLock(); }
}
