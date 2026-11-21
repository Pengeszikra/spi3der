// Bounded, privacy-preserving diagnostics for the spi3der MCP App.
// Never log arguments, scene meshes, URLs, tokens or raw exception stacks.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const MAX_TRACES = 128;
const TTL_MS = 15 * 60 * 1000;
const MAX_EVENTS = 48;
const traces = new Map();
const fields = new Set(['stepCount','objects','vertices','faces','payloadBytes','durationMs','phase','reason','httpStatus','widgetObjects','widgetFaces']);
const phases = new Set(['request_received','steps_validated','model_started','model_finished','scene_unpacked','response_ready','request_failed','widget_loaded','widget_rendered','widget_error','widget_empty','native_frame_loaded']);
const number = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
function trim() {
  const now = Date.now();
  for (const [id, t] of traces) if (now - t.createdMs > TTL_MS) traces.delete(id);
  while (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value);
}
function log(t, e) {
  console.log(JSON.stringify({
    severity: e.phase === 'request_failed' || e.phase === 'widget_error' ? 'ERROR' : 'INFO',
    component: 'spi3der-mcp',
    traceId: t.id,
    phase: e.phase,
    elapsedMs: e.elapsedMs,
    ...Object.fromEntries(Object.entries(e).filter(([k]) => fields.has(k))),
  }));
}
export function startTrace(stepCount = 0) {
  trim();
  const id = randomUUID();
  const t = { id, createdMs: Date.now(), started: performance.now(), events: [], status: 'running' };
  traces.set(id, t);
  recordTrace(id, 'request_received', { stepCount });
  return id;
}
export function recordTrace(id, phase, details = {}) {
  trim();
  const t = traces.get(id);
  if (!t || !phases.has(phase)) return false;
  const e = { phase, elapsedMs: Math.round(performance.now() - t.started) };
  for (const [key, value] of Object.entries(details)) {
    if (!fields.has(key)) continue;
    if (key === 'reason') e.reason = String(value || 'unknown').slice(0, 64).replace(/[^\w .:-]/g, '_');
    else if (key === 'phase') continue;
    else { const n = number(value); if (n !== undefined) e[key] = n; }
  }
  t.events.push(e);
  if (t.events.length > MAX_EVENTS) t.events.shift();
  if (phase === 'response_ready') t.status = 'server_complete';
  if (phase === 'request_failed') t.status = 'server_error';
  if (phase === 'widget_rendered') t.status = 'widget_rendered';
  if (phase === 'native_frame_loaded') t.status = 'native_frame_loaded';
  if (phase === 'widget_error') t.status = 'widget_error';
  log(t, e);
  return true;
}
export function readTrace(id) {
  trim();
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(id)) return null;
  const t = traces.get(id);
  if (!t) return null;
  return {
    trace_id: t.id,
    status: t.status,
    created_at: new Date(t.createdMs).toISOString(),
    events: t.events.map(e => ({ ...e })),
    note: 'Instance-local, expires after 15 minutes. Missing client events do not prove a client failure. Cloud Logging provides cross-instance correlation.',
  };
}
export function safeErrorCode(error) {
  const s = String(error?.code || error?.name || 'Error');
  return s.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 48) || 'Error';
}
