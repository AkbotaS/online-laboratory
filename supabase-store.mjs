import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningAnalyticsStore } from './learning-analytics-store.mjs';

const PAGE_SIZE = 1000;

function fromUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    groupId: row.group_id || '',
    active: row.active !== false,
    mustChangePassword: Boolean(row.must_change_password),
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    ...(row.password_changed_at ? { passwordChangedAt: row.password_changed_at } : {})
  };
}

function toUserRow(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName,
    role: user.role,
    group_id: user.groupId || '',
    active: user.active !== false,
    must_change_password: Boolean(user.mustChangePassword),
    password_salt: user.passwordSalt,
    password_hash: user.passwordHash,
    created_at: user.createdAt,
    password_changed_at: user.passwordChangedAt || null
  };
}

export class SupabaseLearningAnalyticsStore extends LearningAnalyticsStore {
  constructor(projectRoot) {
    // The parent class supplies the existing assessment and analytics rules.
    // Its filesystem initializer is intentionally disabled in Vercel Functions.
    super(projectRoot, tmpdir());
    this.isRemote = true;
    this.supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    this.supabaseKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const filesystemReady = this.ready;
    this.ready = filesystemReady.then(() => this.initializeRemote());
  }

  async initialize() {
    this.directory = await mkdtemp(join(tmpdir(), 'online-laboratory-'));
    this.eventsFile = join(this.directory, 'events.ndjson');
    this.measuresFile = join(this.directory, 'measures.ndjson');
    this.curriculumFile = join(this.directory, 'curriculum.json');
    this.settingsFile = join(this.directory, 'settings.json');
    this.usersFile = join(this.directory, 'users.json');
  }

  async initializeRemote() {
    if (!this.supabaseUrl || !this.supabaseKey) throw new Error('Supabase server credentials are not configured.');
    await this.loadRemoteState();
    this.isConnected = true;
  }

  async request(path, { method = 'GET', body, prefer, range } = {}) {
    const headers = {
      apikey: this.supabaseKey,
      Authorization: 'Bearer ' + this.supabaseKey,
      Accept: 'application/json'
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    if (range) { headers.Range = range; headers['Range-Unit'] = 'items'; }
    let response;
    try {
      response = await fetch(this.supabaseUrl + '/rest/v1/' + path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new Error('Supabase could not be reached.');
    }
    const text = await response.text();
    if (!response.ok) {
      const error = new Error('Supabase request failed with HTTP ' + response.status + '.');
      error.status = response.status;
      throw error;
    }
    if (!text) return null;
    try { return JSON.parse(text); }
    catch { throw new Error('Supabase returned an invalid response.'); }
  }

  async rows(table, query = 'select=*') {
    const all = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const part = await this.request(table + '?' + query, { range: offset + '-' + (offset + PAGE_SIZE - 1) });
      if (!Array.isArray(part)) throw new Error('Supabase returned an invalid table response.');
      all.push(...part);
      if (part.length < PAGE_SIZE) return all;
    }
  }

  async upsert(table, rows) {
    if (!rows.length) return;
    await this.request(table + '?on_conflict=id', {
      method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal'
    });
  }

  async saveDocument(id, payload) {
    await this.upsert('online_lab_documents', [{
      id,
      payload,
      revision: Number(payload?.revision) || 1,
      updated_at: payload?.updatedAt || new Date().toISOString()
    }]);
  }

  async loadRemoteState() {
    const [userRows, documents, eventRows] = await Promise.all([
      this.rows('online_lab_users'),
      this.rows('online_lab_documents'),
      this.rows('online_lab_events')
    ]);
    this.users = userRows.map(fromUserRow);
    const curriculum = documents.find(row => row.id === 'curriculum')?.payload;
    if (!curriculum || !Array.isArray(curriculum.labs) || !Array.isArray(curriculum.quizzes)) throw new Error('Supabase curriculum has not been migrated.');
    this.curriculum = {
      revision: Number(curriculum.revision) || 1,
      updatedAt: curriculum.updatedAt || '',
      labs: curriculum.labs,
      quizzes: curriculum.quizzes,
      assistantConfig: curriculum.assistantConfig || null
    };
    const settings = documents.find(row => row.id === 'settings')?.payload;
    if (!settings?.rubricWeights) throw new Error('Supabase assessment settings have not been migrated.');
    this.settings = settings;
    this.events = [];
    this.measures = [];
    this.eventIds = new Set();
    for (const row of eventRows) {
      if (!row?.id || !row.payload?.studentId || !row.payload?.type) continue;
      this.eventIds.add(row.id);
      const target = row.is_measure ? this.measures : this.events;
      if (target.length < 250_000) target.push(row.payload);
    }
  }

  async refresh() {
    await this.ready;
    await this.loadRemoteState();
    this.isConnected = true;
  }

  async persistUsers() {
    await this.upsert('online_lab_users', this.users.map(toUserRow));
  }

  async saveCurriculum(user, input) {
    const result = await super.saveCurriculum(user, input);
    await this.saveDocument('curriculum', this.curriculum);
    return result;
  }

  async setRubricWeights(user, input) {
    const result = await super.setRubricWeights(user, input);
    await this.saveDocument('settings', this.settings);
    return result;
  }

  async deleteStudent(id) {
    const result = await super.deleteStudent(id);
    const filter = encodeURIComponent(id);
    await Promise.all([
      this.request('online_lab_users?id=eq.' + filter, { method: 'DELETE' }),
      this.request('online_lab_events?student_id=eq.' + filter, { method: 'DELETE' }),
      this.request('online_lab_sessions?user_id=eq.' + filter, { method: 'DELETE' })
    ]);
    return result;
  }

  async appendEvent(user, input) {
    const result = await super.appendEvent(user, input);
    if (!result.accepted) return result;
    const event = (input.type === 'score_calculated' ? this.measures : this.events).find(item => item.id === input.eventId);
    if (!event) throw new Error('Accepted event was not available for persistence.');
    const persisted = await this.request('online_lab_events?on_conflict=id', {
      method: 'POST',
      body: [{ id: event.id, student_id: event.studentId, is_measure: input.type === 'score_calculated', payload: event }],
      prefer: 'resolution=ignore-duplicates,return=representation'
    });
    if (Array.isArray(persisted) && persisted.length === 0) {
      this.events = this.events.filter(item => item.id !== event.id);
      this.measures = this.measures.filter(item => item.id !== event.id);
      return { accepted: false, duplicate: true };
    }
    return result;
  }

  async createSession(tokenHash, userId, expiresAt) {
    await this.request('online_lab_sessions?on_conflict=token_hash', {
      method: 'POST',
      body: [{ token_hash: tokenHash, user_id: userId, expires_at: new Date(expiresAt).toISOString() }],
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
  }

  async getSession(tokenHash) {
    const rows = await this.rows('online_lab_sessions', 'select=token_hash,user_id,expires_at&token_hash=eq.' + encodeURIComponent(tokenHash));
    const session = rows[0];
    return session ? { userId: session.user_id, expiresAt: Date.parse(session.expires_at) } : null;
  }

  async deleteSession(tokenHash) {
    await this.request('online_lab_sessions?token_hash=eq.' + encodeURIComponent(tokenHash), { method: 'DELETE' });
  }

  async revokeUserSessions(userId) {
    await this.request('online_lab_sessions?user_id=eq.' + encodeURIComponent(userId), { method: 'DELETE' });
  }
}
