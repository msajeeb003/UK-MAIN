/* Application state, server persistence (BRD 2.9: projects are stored
   server-side and shared by all users) and small shared utilities. */

export const state = {
  screen: 'login',
  user: null,               // { email, initials }
  csrf: '',                 // CSRF token, echoed in X-CSRF-Token on writes
  projects: [],             // loaded from the server
  currentId: null,
  source: null,             // { caption, docId, page }
  userMenu: false,          // avatar dropdown open?
  notice: null,             // themed message dialog text (replaces alert())
  projSearch: '',
  projFilter: 'All',
};

export function setUser(email) {
  const parts = email.split('@')[0].split(/[._-]/).filter(Boolean);
  const initials = (parts.length > 1
    ? parts[0][0] + parts[1][0] : email.slice(0, 2)).toUpperCase();
  state.user = { email, initials };
}

/* The backend stores a project as a resource (searchable columns + the
   ordered insurers-approached relation) with the working document under
   `state`; this SPA works on the flat object, so map at the edge. */
const STATUSES = ['draft', 'ready', 'sent', 'closed'];

function fromResource(r) {
  const s = r.state || {};
  return {
    ...s,
    id: r.id,
    clientName: r.client_name,
    ref: r.reference,
    projectType: r.project_type || undefined,
    policyType: r.policy_type || undefined,
    approached: (r.insurers_approached || []).map((i) => i.id),
    status: r.status,
    generatedAt: r.generated_at ? Date.parse(r.generated_at) : undefined,
    created: typeof s.created === 'number' ? s.created : Date.parse(r.created_at),
    updated: s.updated !== undefined ? s.updated : Date.parse(r.updated_at),
  };
}

function toWrite(p) {
  const { id, clientName, ref, projectType, policyType, approached, status, generatedAt, ...rest } = p;
  return {
    client_name: clientName || '',
    reference: ref || '',
    project_type: projectType || null,
    policy_type: policyType || null,
    status: STATUSES.includes(status) ? status : 'draft',
    insurers_approached: approached || [],
    generated_at: typeof generatedAt === 'number' ? new Date(generatedAt).toISOString() : null,
    state: rest,
  };
}

export async function loadProjects() {
  const items = [];
  let offset = 0;
  for (;;) {
    const res = await fetch('/projects?limit=200&offset=' + offset);
    if (!res.ok) return;
    const page = await res.json();
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) break;
  }
  state.projects = items.map(fromResource);
}

/* Session restore on page load: an existing cookie session goes straight
   to the project list (BRD S1: Next -> Project list). */
export async function boot() {
  try {
    const me = await fetch('/auth/me');
    if (me.ok) {
      const body = await me.json();
      // A session from before the CSRF feature has no token — every write
      // would 403. Treat it as not-signed-in so the broker re-logs in once
      // and gets a valid token, instead of a broken authenticated state.
      if (!body.csrf_token) return;
      setUser(body.email);
      state.csrf = body.csrf_token;
      await loadProjects();
      state.screen = 'projects';
    }
  } catch (e) { /* server unreachable: stay on the login screen */ }
}

/* Headers for state-changing requests: the CSRF token the backend expects. */
export function csrfHeaders() {
  return state.csrf ? { 'X-CSRF-Token': state.csrf } : {};
}

/* ── Save with status, retry and failure notification ──────────────────
   A silent .catch() used to swallow save failures — offline edits were
   lost without a trace. Now: a visible status ("Saving…"/"Saved"/
   "Offline"), automatic retries, a user notice if it keeps failing, and a
   beforeunload guard so a pending save is not lost by closing the tab. */

export const saveStatus = { status: 'idle' };   // idle|saving|saved|offline
const SAVE_VIEW = {
  idle:    { text: '',                                 color: 'var(--ink3)' },
  saving:  { text: 'Saving…',                          color: 'var(--ink3)' },
  saved:   { text: '✓ Saved',                          color: 'var(--ok)' },
  offline: { text: '⚠ Offline — changes not saved',    color: 'var(--warn)' },
};

export function saveStatusView() {
  return SAVE_VIEW[saveStatus.status] || SAVE_VIEW.idle;
}

/* Something is not safely on the server yet — used by the tab-close guard. */
export function hasUnsavedWork() {
  return saveStatus.status === 'saving' || saveStatus.status === 'offline';
}

// notify() lives in views.js (which imports this module); main.js wires it
// in at boot to avoid a circular import.
let _notify = null;
export function setNotifier(fn) { _notify = fn; }

function setSaveStatus(s) {
  saveStatus.status = s;
  const el = document.getElementById('save-indicator');
  if (el) {
    el.textContent = SAVE_VIEW[s].text;
    el.style.color = SAVE_VIEW[s].color;
  }
}

const SAVE_DEBOUNCE = 500;
const RETRY_DELAY = 5000;
const MAX_RETRIES = 3;
const saveTimers = {};     // debounce timer per project id
const retryTimers = {};    // retry timer per project id
const retryCounts = {};    // consecutive failures per project id
let offlineNotified = false;

async function attemptSave(p) {
  setSaveStatus('saving');
  try {
    const res = await fetch('/projects/' + encodeURIComponent(p.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(toWrite(p)),
    });
    if (res.status === 401 || res.status === 403) {
      // Auth/CSRF problem — retrying won't help; the broker must re-sign-in.
      setSaveStatus('offline');
      if (_notify) _notify('Your session has expired — sign in again to save your changes.');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    retryCounts[p.id] = 0;
    offlineNotified = false;
    setSaveStatus('saved');
  } catch (e) {
    // Network/server failure — keep the edits and retry.
    const n = (retryCounts[p.id] || 0) + 1;
    retryCounts[p.id] = n;
    setSaveStatus('offline');
    if (n <= MAX_RETRIES) {
      clearTimeout(retryTimers[p.id]);
      retryTimers[p.id] = setTimeout(() => attemptSave(p), RETRY_DELAY);
    } else if (!offlineNotified) {
      offlineNotified = true;
      retryCounts[p.id] = 0;
      if (_notify) {
        _notify("Changes couldn't be saved — check your connection. Your "
          + "edits are still here and will save automatically once you're "
          + "back online.");
      }
    }
  }
}

export function save(p) {
  p = p || proj();
  if (!p) return;
  setSaveStatus('saving');                 // reflect the pending change at once
  clearTimeout(saveTimers[p.id]);
  saveTimers[p.id] = setTimeout(() => attemptSave(p), SAVE_DEBOUNCE);
}

export const proj = () => state.projects.find(p => p.id === state.currentId) || null;

/* Collision-resistant id. A project's uid becomes its server-side primary
   key (INSERT ... ON CONFLICT(id) DO UPDATE), so a clash would silently
   overwrite another project — Math.random()'s ~7 chars was not safe.
   crypto.randomUUID needs a secure context (https / localhost, both true
   here); getRandomValues covers the rest; Math.random is a last resort. */
export function uid() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  if (c && c.getRandomValues) {
    return Array.from(c.getRandomValues(new Uint32Array(4)),
      x => x.toString(16).padStart(8, '0')).join('');
  }
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function monthLabel() {
  return new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/* ── Project factory ─────────────────────────────────────────────────── */
export function createProject() {
  const n = 2400 + state.projects.length + 1;
  const p = {
    id: uid(), created: Date.now(), clientName: '', ref: 'UKCIB-' + n,
    projectType: 'new', policyType: 'Whole Turnover',
    approached: [], columns: [], files: [],
    credit: [],               // { id, buyer, reg, req, offers: {colId: val} }
    confirmed: { premium: false, indemnity: false, excess: false, maxLiability: false },
    recommended: null, manualSeq: 1,
    notes: 'All quotes shown are subject to underwriting and the terms of the policy documents. Premiums exclude IPT.',
    reasons: '', exported: false, status: 'draft', updated: todayLabel(),
  };
  state.projects.unshift(p);
  state.currentId = p.id;
  return p;
}

export function touch(p) { p.updated = todayLabel(); save(); }
