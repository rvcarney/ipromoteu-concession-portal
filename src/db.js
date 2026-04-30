const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'concessions.sqlite'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    recipient_email TEXT DEFAULT '',
    is_builtin INTEGER DEFAULT 0,
    fields_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
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
    approver_name TEXT DEFAULT '',
    approver_email TEXT DEFAULT '',
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

// ── Seed default forms if empty ───────────────────────────────────────────────
const formCount = db.prepare('SELECT COUNT(*) as c FROM forms').get().c;
if (formCount === 0) {
  const insert = db.prepare(`
    INSERT INTO forms (id, name, recipient_email, is_builtin, fields_json)
    VALUES (@id, @name, @recipient_email, @is_builtin, @fields_json)
  `);
  const defaultForms = [
    {
      id: 'txn-fee',
      name: 'Lower transaction fee',
      recipient_email: '',
      is_builtin: 1,
      fields_json: JSON.stringify([
        { id: 'order',   label: 'Order number',      type: 'text',     required: true },
        { id: 'req-fee', label: 'Requested fee %',   type: 'number',   required: true },
        { id: 'reason',  label: 'Reason for request',type: 'textarea', required: true }
      ])
    },
    {
      id: 'late-fee',
      name: 'Waive late fee',
      recipient_email: '',
      is_builtin: 1,
      fields_json: JSON.stringify([
        { id: 'invoice', label: 'Invoice number',      type: 'text',     required: true },
        { id: 'amount',  label: 'Late fee amount ($)', type: 'number',   required: true },
        { id: 'reason',  label: 'Reason for request', type: 'textarea', required: true }
      ])
    },
    {
      id: 'invoice-fee',
      name: 'Waive invoice fee',
      recipient_email: '',
      is_builtin: 1,
      fields_json: JSON.stringify([
        { id: 'invoice', label: 'Invoice number',         type: 'text',     required: true },
        { id: 'amount',  label: 'Invoice fee amount ($)', type: 'number',   required: true },
        { id: 'reason',  label: 'Reason for request',     type: 'textarea', required: true }
      ])
    },
    {
      id: 's-fee',
      name: 'Waive S Fee',
      recipient_email: '',
      is_builtin: 1,
      fields_json: JSON.stringify([
        { id: 'order',  label: 'Order number',        type: 'text',     required: true },
        { id: 'amount', label: 'S Fee amount ($)',     type: 'number',   required: true },
        { id: 'reason', label: 'Reason for request',  type: 'textarea', required: true }
      ])
    },
    {
      id: 'ldi',
      name: 'Waive loss & damage insurance',
      recipient_email: '',
      is_builtin: 1,
      fields_json: JSON.stringify([
        { id: 'order',  label: 'Order number',       type: 'text',     required: true },
        { id: 'amount', label: 'LDI amount ($)',      type: 'number',   required: true },
        { id: 'reason', label: 'Reason for request', type: 'textarea', required: true }
      ])
    }
  ];
  defaultForms.forEach(f => insert.run(f));
}

// ── Query helpers ─────────────────────────────────────────────────────────────
module.exports = {
  db,

  // Forms
  getForms: () => db.prepare('SELECT * FROM forms ORDER BY is_builtin DESC, created_at ASC').all()
    .map(f => ({ ...f, fields: JSON.parse(f.fields_json), is_builtin: !!f.is_builtin })),

  getForm: (id) => {
    const f = db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
    return f ? { ...f, fields: JSON.parse(f.fields_json), is_builtin: !!f.is_builtin } : null;
  },

  createForm: (id, name, recipientEmail, fields) =>
    db.prepare('INSERT INTO forms (id, name, recipient_email, is_builtin, fields_json) VALUES (?, ?, ?, 0, ?)')
      .run(id, name, recipientEmail, JSON.stringify(fields)),

  updateFormEmail: (id, email) =>
    db.prepare('UPDATE forms SET recipient_email = ? WHERE id = ?').run(email, id),

  deleteForm: (id) =>
    db.prepare('DELETE FROM forms WHERE id = ? AND is_builtin = 0').run(id),

  // Submissions
  createSubmission: (sub) =>
    db.prepare(`
      INSERT INTO submissions
        (id, form_id, form_name, requester_name, requester_email, department,
         affiliate_code, fields_json, notes, decision_token)
      VALUES
        (@id, @form_id, @form_name, @requester_name, @requester_email, @department,
         @affiliate_code, @fields_json, @notes, @decision_token)
    `).run(sub),

  getSubmissionByToken: (token) =>
    db.prepare('SELECT * FROM submissions WHERE decision_token = ?').get(token),

  getSubmissionById: (id) =>
    db.prepare('SELECT * FROM submissions WHERE id = ?').get(id),

  updateDecision: (token, decision, approverName, approverEmail, approverNotes) =>
    db.prepare(`
      UPDATE submissions
      SET decision = ?, approver_name = ?, approver_email = ?, approver_notes = ?, decided_at = datetime('now')
      WHERE decision_token = ? AND decision = 'PENDING'
    `).run(decision, approverName, approverEmail, approverNotes, token),

  getAllSubmissions: (filters = {}) => {
    let query = 'SELECT * FROM submissions WHERE 1=1';
    const params = [];
    if (filters.formId)   { query += ' AND form_id = ?';    params.push(filters.formId); }
    if (filters.decision) { query += ' AND decision = ?';   params.push(filters.decision); }
    if (filters.search) {
      query += ' AND (requester_name LIKE ? OR affiliate_code LIKE ? OR department LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s);
    }
    query += ' ORDER BY submitted_at DESC';
    if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(query).all(...params);
  },

  getMetrics: () => {
    const total     = db.prepare('SELECT COUNT(*) as c FROM submissions').get().c;
    const approved  = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE decision='APPROVED'").get().c;
    const denied    = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE decision='DENIED'").get().c;
    const pending   = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE decision='PENDING'").get().c;
    const thisMonth = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE strftime('%Y-%m', submitted_at) = strftime('%Y-%m', 'now')").get().c;
    const byType    = db.prepare("SELECT form_name, COUNT(*) as count FROM submissions GROUP BY form_name ORDER BY count DESC").all();
    const byAffiliate = db.prepare("SELECT affiliate_code, COUNT(*) as count FROM submissions GROUP BY affiliate_code ORDER BY count DESC LIMIT 10").all();
    const byStaff   = db.prepare("SELECT requester_name, requester_email, COUNT(*) as count FROM submissions GROUP BY requester_email ORDER BY count DESC LIMIT 10").all();
    const byDept    = db.prepare("SELECT department, COUNT(*) as count FROM submissions GROUP BY department ORDER BY count DESC").all();
    const byApprover = db.prepare("SELECT approver_name, COUNT(*) as count FROM submissions WHERE approver_name != '' GROUP BY approver_name ORDER BY count DESC").all();
    return { total, approved, denied, pending, thisMonth, byType, byAffiliate, byStaff, byDept, byApprover };
  },

  // Settings
  getSetting: (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  setSetting: (key, value) =>
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value),
};
