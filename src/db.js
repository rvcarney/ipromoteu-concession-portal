const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'concessions.sqlite'));
db.pragma('journal_mode = WAL');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_builtin INTEGER DEFAULT 0,
    fields_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS approvers (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    pin_hash TEXT NOT NULL,
    form_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL,
    form_name TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    requester_email TEXT NOT NULL,
    department TEXT NOT NULL,
    affiliate_code TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT DEFAULT '',
    decision TEXT DEFAULT 'PENDING',
    approver_id TEXT DEFAULT '',
    approver_name TEXT DEFAULT '',
    approver_notes TEXT DEFAULT '',
    decision_token TEXT UNIQUE,
    submitted_at TEXT DEFAULT (datetime('now')),
    decided_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Seed default forms ────────────────────────────────────────────────────────
const formCount = db.prepare('SELECT COUNT(*) as c FROM forms').get().c;
if (formCount === 0) {
  const insert = db.prepare(`INSERT INTO forms (id, name, is_builtin, fields_json) VALUES (@id, @name, @is_builtin, @fields_json)`);
  [
    { id: 'txn-fee',     name: 'Lower transaction fee',          is_builtin: 1, fields_json: JSON.stringify([{ id:'order', label:'Order number', type:'text', required:true },{ id:'req-fee', label:'Requested fee %', type:'number', required:true },{ id:'reason', label:'Reason for request', type:'textarea', required:true }]) },
    { id: 'late-fee',    name: 'Waive late fee',                  is_builtin: 1, fields_json: JSON.stringify([{ id:'invoice', label:'Invoice number', type:'text', required:true },{ id:'amount', label:'Late fee amount ($)', type:'number', required:true },{ id:'reason', label:'Reason for request', type:'textarea', required:true }]) },
    { id: 'invoice-fee', name: 'Waive invoice fee',               is_builtin: 1, fields_json: JSON.stringify([{ id:'invoice', label:'Invoice number', type:'text', required:true },{ id:'amount', label:'Invoice fee amount ($)', type:'number', required:true },{ id:'reason', label:'Reason for request', type:'textarea', required:true }]) },
    { id: 's-fee',       name: 'Waive S Fee',                     is_builtin: 1, fields_json: JSON.stringify([{ id:'order', label:'Order number', type:'text', required:true },{ id:'amount', label:'S Fee amount ($)', type:'number', required:true },{ id:'reason', label:'Reason for request', type:'textarea', required:true }]) },
    { id: 'ldi',         name: 'Waive loss & damage insurance',   is_builtin: 1, fields_json: JSON.stringify([{ id:'order', label:'Order number', type:'text', required:true },{ id:'amount', label:'LDI amount ($)', type:'number', required:true },{ id:'reason', label:'Reason for request', type:'textarea', required:true }]) },
    { id: 'cc-fee',      name: 'Waive credit card fee',            is_builtin: 1, fields_json: JSON.stringify([{ id:'invoice', label:'Invoice number', type:'text', required:true },{ id:'amount', label:'Credit card fee amount ($)', type:'number', required:true },{ id:'reason', label:'Reason for request', type:'textarea', required:true }]) },
  ].forEach(f => insert.run(f));
}

// ── Seed default departments ──────────────────────────────────────────────────
const deptCount = db.prepare('SELECT COUNT(*) as c FROM departments').get().c;
if (deptCount === 0) {
  const insertDept = db.prepare('INSERT INTO departments (name, sort_order) VALUES (?, ?)');
  ['Operations','Marketing','Technology','Human Resources','Affiliate Services','Invoicing','Accounts Receivable','Accounts Payable','Corporate Accounting','Training and Onboarding'].forEach((d, i) => insertDept.run(d, i));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query helpers
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  db,

  // ── Forms ──────────────────────────────────────────────────────────────────
  getForms: () => db.prepare('SELECT * FROM forms ORDER BY is_builtin DESC, created_at ASC').all()
    .map(f => ({ ...f, fields: JSON.parse(f.fields_json), is_builtin: !!f.is_builtin })),

  getForm: (id) => {
    const f = db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
    return f ? { ...f, fields: JSON.parse(f.fields_json), is_builtin: !!f.is_builtin } : null;
  },

  createForm: (id, name, fields) =>
    db.prepare('INSERT INTO forms (id, name, is_builtin, fields_json) VALUES (?, ?, 0, ?)').run(id, name, JSON.stringify(fields)),

  deleteForm: (id) =>
    db.prepare('DELETE FROM forms WHERE id = ? AND is_builtin = 0').run(id),

  // ── Departments ────────────────────────────────────────────────────────────
  getDepartments: () => db.prepare('SELECT * FROM departments ORDER BY sort_order ASC, name ASC').all(),

  addDepartment: (name) => {
    const max = db.prepare('SELECT MAX(sort_order) as m FROM departments').get().m || 0;
    return db.prepare('INSERT INTO departments (name, sort_order) VALUES (?, ?)').run(name.trim(), max + 1);
  },

  deleteDepartment: (id) => db.prepare('DELETE FROM departments WHERE id = ?').run(id),

  reorderDepartments: (ids) => {
    const update = db.prepare('UPDATE departments SET sort_order = ? WHERE id = ?');
    ids.forEach((id, i) => update.run(i, id));
  },

  // ── Approvers ──────────────────────────────────────────────────────────────
  getApprovers: () => db.prepare('SELECT id, username, form_ids_json, created_at FROM approvers ORDER BY username ASC').all()
    .map(a => ({ ...a, form_ids: JSON.parse(a.form_ids_json) })),

  getApprover: (id) => {
    const a = db.prepare('SELECT * FROM approvers WHERE id = ?').get(id);
    return a ? { ...a, form_ids: JSON.parse(a.form_ids_json) } : null;
  },

  getApproverByUsername: (username) =>
    db.prepare('SELECT * FROM approvers WHERE username = ?').get(username),

  createApprover: (id, username, pin, formIds) => {
    const hash = bcrypt.hashSync(pin, 10);
    return db.prepare('INSERT INTO approvers (id, username, pin_hash, form_ids_json) VALUES (?, ?, ?, ?)').run(id, username, hash, JSON.stringify(formIds));
  },

  updateApproverForms: (id, formIds) =>
    db.prepare('UPDATE approvers SET form_ids_json = ? WHERE id = ?').run(JSON.stringify(formIds), id),

  resetApproverPin: (id, newPin) => {
    const hash = bcrypt.hashSync(newPin, 10);
    return db.prepare('UPDATE approvers SET pin_hash = ? WHERE id = ?').run(hash, id);
  },

  deleteApprover: (id) => db.prepare('DELETE FROM approvers WHERE id = ?').run(id),

  verifyApproverPin: (username, pin) => {
    const a = db.prepare('SELECT * FROM approvers WHERE username = ?').get(username);
    if (!a) return null;
    if (!bcrypt.compareSync(pin, a.pin_hash)) return null;
    return { ...a, form_ids: JSON.parse(a.form_ids_json) };
  },

  // ── Submissions ────────────────────────────────────────────────────────────
  createSubmission: (sub) =>
    db.prepare(`INSERT INTO submissions (id,form_id,form_name,requester_name,requester_email,department,affiliate_code,fields_json,notes,decision_token) VALUES (@id,@form_id,@form_name,@requester_name,@requester_email,@department,@affiliate_code,@fields_json,@notes,@decision_token)`).run(sub),

  getSubmissionByToken: (token) =>
    db.prepare('SELECT * FROM submissions WHERE decision_token = ?').get(token),

  getSubmissionById: (id) =>
    db.prepare('SELECT * FROM submissions WHERE id = ?').get(id),

  updateDecision: (token, decision, approverId, approverName, approverNotes) =>
    db.prepare(`UPDATE submissions SET decision=?,approver_id=?,approver_name=?,approver_notes=?,decided_at=datetime('now') WHERE decision_token=? AND decision='PENDING'`).run(decision, approverId, approverName, approverNotes, token),

  // Get all decisions for a given affiliate code (for history panel on review page)
  getAffiliateHistory: (affiliateCode, excludeToken) =>
    db.prepare(`SELECT * FROM submissions WHERE affiliate_code = ? AND decision_token != ? AND decision != 'PENDING' ORDER BY decided_at DESC LIMIT 10`).all(affiliateCode, excludeToken || ''),

  getAllSubmissions: (filters = {}) => {
    let query = 'SELECT * FROM submissions WHERE 1=1';
    const params = [];
    if (filters.formId)   { query += ' AND form_id = ?';    params.push(filters.formId); }
    if (filters.decision) { query += ' AND decision = ?';   params.push(filters.decision); }
    if (filters.approverId) { query += ' AND approver_id = ?'; params.push(filters.approverId); }
    if (filters.search) {
      query += ' AND (requester_name LIKE ? OR affiliate_code LIKE ? OR department LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s);
    }
    if (filters.formIds && filters.formIds.length) {
      query += ` AND form_id IN (${filters.formIds.map(() => '?').join(',')})`;
      params.push(...filters.formIds);
    }
    query += ' ORDER BY submitted_at DESC';
    if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(query).all(...params);
  },

  getMetrics: (formIds) => {
    const scope = formIds && formIds.length
      ? `AND form_id IN (${formIds.map(() => '?').join(',')})`
      : '';
    const p = formIds && formIds.length ? formIds : [];

    const total     = db.prepare(`SELECT COUNT(*) as c FROM submissions WHERE 1=1 ${scope}`).get(...p).c;
    const approved  = db.prepare(`SELECT COUNT(*) as c FROM submissions WHERE decision='APPROVED' ${scope}`).get(...p).c;
    const denied    = db.prepare(`SELECT COUNT(*) as c FROM submissions WHERE decision='DENIED' ${scope}`).get(...p).c;
    const pending   = db.prepare(`SELECT COUNT(*) as c FROM submissions WHERE decision='PENDING' ${scope}`).get(...p).c;
    const thisMonth = db.prepare(`SELECT COUNT(*) as c FROM submissions WHERE strftime('%Y-%m',submitted_at)=strftime('%Y-%m','now') ${scope}`).get(...p).c;
    const byType      = db.prepare(`SELECT form_name, COUNT(*) as count FROM submissions WHERE 1=1 ${scope} GROUP BY form_name ORDER BY count DESC`).all(...p);
    const byAffiliate = db.prepare(`SELECT affiliate_code, COUNT(*) as count FROM submissions WHERE 1=1 ${scope} GROUP BY affiliate_code ORDER BY count DESC LIMIT 10`).all(...p);
    const byStaff     = db.prepare(`SELECT requester_name, requester_email, COUNT(*) as count FROM submissions WHERE 1=1 ${scope} GROUP BY requester_email ORDER BY count DESC LIMIT 10`).all(...p);
    const byDept      = db.prepare(`SELECT department, COUNT(*) as count FROM submissions WHERE 1=1 ${scope} GROUP BY department ORDER BY count DESC`).all(...p);
    const byApprover  = db.prepare(`SELECT approver_name, COUNT(*) as count FROM submissions WHERE approver_name != '' ${scope} GROUP BY approver_name ORDER BY count DESC`).all(...p);
    const byMonth = db.prepare(`SELECT strftime('%Y-%m', submitted_at) as month, COUNT(*) as count FROM submissions WHERE 1=1 ${scope} GROUP BY month ORDER BY month DESC LIMIT 24`).all(...p);
    const byYear  = db.prepare(`SELECT strftime('%Y', submitted_at) as year, COUNT(*) as count FROM submissions WHERE 1=1 ${scope} GROUP BY year ORDER BY year DESC`).all(...p);
    const affiliateDetail = db.prepare(`SELECT affiliate_code, form_name, COUNT(*) as count, SUM(CASE WHEN decision='APPROVED' THEN 1 ELSE 0 END) as approved, SUM(CASE WHEN decision='DENIED' THEN 1 ELSE 0 END) as denied, SUM(CASE WHEN decision='PENDING' THEN 1 ELSE 0 END) as pending FROM submissions WHERE 1=1 ${scope} GROUP BY affiliate_code, form_name ORDER BY affiliate_code, count DESC`).all(...p);
    return { total, approved, denied, pending, thisMonth, byType, byAffiliate, byStaff, byDept, byApprover, byMonth, byYear, affiliateDetail };
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  getSetting: (key) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : null; },
  setSetting: (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, value),
};
