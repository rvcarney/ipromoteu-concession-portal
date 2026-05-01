require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const { v4: uuid } = require('uuid');
const path         = require('path');
const db           = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
function requireApprover(req, res, next) {
  if (req.session.approverId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
function sendPage(res, page) {
  res.sendFile(path.join(__dirname, '..', 'public', page + '.html'));
}

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/',                      (req, res) => sendPage(res, 'landing'));
app.get('/staff', (req, res) => sendPage(res, 'staff'));
app.get('/approve',               (req, res) => sendPage(res, 'approver-login'));
app.get('/approve/dashboard',     (req, res) => sendPage(res, 'approver'));
app.get('/approve/review/:token', (req, res) => sendPage(res, 'approver'));
app.get('/admin',                 (req, res) => sendPage(res, 'admin-login'));
app.get('/admin/dashboard',       (req, res) => sendPage(res, 'admin'));
app.get('/admin/submissions',     (req, res) => sendPage(res, 'admin'));
app.get('/admin/forms',           (req, res) => sendPage(res, 'admin'));
app.get('/admin/approvers',       (req, res) => sendPage(res, 'admin'));
app.get('/admin/departments',     (req, res) => sendPage(res, 'admin'));

// ── Admin auth ────────────────────────────────────────────────────────────────
app.post('/api/auth/admin/login', (req, res) => {
  if (req.body.pin === (process.env.ADMIN_PIN || '1234')) {
    req.session.isAdmin = true; res.json({ ok: true });
  } else { res.status(401).json({ error: 'Incorrect PIN' }); }
});
app.post('/api/auth/admin/logout', (req, res) => { req.session.isAdmin = false; res.json({ ok: true }); });
app.get('/api/auth/admin/status', (req, res) => res.json({ isAdmin: !!req.session.isAdmin }));

// ── Approver auth ─────────────────────────────────────────────────────────────
app.post('/api/auth/approver/login', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Username and PIN required' });
  const approver = db.verifyApproverPin(username.trim(), pin);
  if (!approver) return res.status(401).json({ error: 'Incorrect username or PIN' });
  req.session.approverId      = approver.id;
  req.session.approverName    = approver.username;
  req.session.approverFormIds = approver.form_ids;
  res.json({ ok: true, username: approver.username });
});
app.post('/api/auth/approver/logout', (req, res) => {
  req.session.approverId = req.session.approverName = req.session.approverFormIds = null;
  res.json({ ok: true });
});
app.get('/api/auth/approver/status', (req, res) => {
  if (!req.session.approverId) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: req.session.approverName, formIds: req.session.approverFormIds });
});
app.post('/api/auth/approver/change-pin', requireApprover, (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!newPin || newPin.length < 4) return res.status(400).json({ error: 'New PIN must be at least 4 characters' });
  const approver = db.verifyApproverPin(req.session.approverName, currentPin);
  if (!approver) return res.status(401).json({ error: 'Current PIN is incorrect' });
  db.resetApproverPin(req.session.approverId, newPin);
  res.json({ ok: true });
});

// ── Forms ─────────────────────────────────────────────────────────────────────
app.get('/api/forms', (req, res) => res.json(db.getForms()));
app.post('/api/forms', requireAdmin, (req, res) => {
  const { name, fields } = req.body;
  if (!name) return res.status(400).json({ error: 'Form name required' });
  const id = 'custom-' + Date.now();
  db.createForm(id, name, fields || []);
  res.json({ ok: true, id });
});
app.delete('/api/forms/:id', requireAdmin, (req, res) => { db.deleteForm(req.params.id); res.json({ ok: true }); });

// ── Departments ───────────────────────────────────────────────────────────────
app.get('/api/departments', (req, res) => res.json(db.getDepartments()));
app.post('/api/departments', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  try { db.addDepartment(name); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: 'Department already exists' }); }
});
app.delete('/api/departments/:id', requireAdmin, (req, res) => { db.deleteDepartment(req.params.id); res.json({ ok: true }); });

// ── Approvers (admin) ─────────────────────────────────────────────────────────
app.get('/api/approvers', requireAdmin, (req, res) => res.json(db.getApprovers()));
app.post('/api/approvers', requireAdmin, (req, res) => {
  const { username, pin, formIds } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Username and PIN required' });
  if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  if (db.getApproverByUsername(username.trim())) return res.status(400).json({ error: 'Username already exists' });
  db.createApprover(uuid(), username.trim(), pin, formIds || []);
  res.json({ ok: true });
});
app.patch('/api/approvers/:id/forms', requireAdmin, (req, res) => { db.updateApproverForms(req.params.id, req.body.formIds || []); res.json({ ok: true }); });
app.post('/api/approvers/:id/reset-pin', requireAdmin, (req, res) => {
  const { newPin } = req.body;
  if (!newPin || newPin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  db.resetApproverPin(req.params.id, newPin);
  res.json({ ok: true });
});
app.delete('/api/approvers/:id', requireAdmin, (req, res) => { db.deleteApprover(req.params.id); res.json({ ok: true }); });

// ── Submit ────────────────────────────────────────────────────────────────────
app.post('/api/submissions', (req, res) => {
  const { formId, name, email: reqEmail, department, affiliateCode, fields, notes } = req.body;
  if (!formId || !name || !reqEmail || !department || !affiliateCode)
    return res.status(400).json({ error: 'Missing required fields' });
  const form = db.getForm(formId);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  for (const f of form.fields) {
    if (f.required && !fields?.[f.id]?.value?.trim())
      return res.status(400).json({ error: `Missing required field: ${f.label}` });
  }
  const id = uuid(), token = uuid();
  db.createSubmission({
    id, form_id: formId, form_name: form.name,
    requester_name: name, requester_email: reqEmail,
    department, affiliate_code: affiliateCode.toUpperCase(),
    fields_json: JSON.stringify(fields || {}),
    notes: notes || '', decision_token: token,
  });
  res.json({ ok: true, id });
});

// ── Review (approver only) ────────────────────────────────────────────────────
app.get('/api/review/:token', requireApprover, (req, res) => {
  const sub = db.getSubmissionByToken(req.params.token);
  if (!sub) return res.status(404).json({ error: 'Request not found' });
  if (!(req.session.approverFormIds || []).includes(sub.form_id))
    return res.status(403).json({ error: 'You are not assigned to this form type' });
  const form    = db.getForm(sub.form_id);
  const history = db.getAffiliateHistory(sub.affiliate_code, req.params.token);
  res.json({ submission: sub, form, history });
});

app.post('/api/review/:token/decide', requireApprover, (req, res) => {
  const { decision, approverNotes } = req.body;
  if (!['APPROVED','DENIED'].includes(decision))
    return res.status(400).json({ error: 'Decision must be APPROVED or DENIED' });
  if (decision === 'DENIED' && !approverNotes?.trim())
    return res.status(400).json({ error: 'Please provide a reason for denying this request' });
  const existing = db.getSubmissionByToken(req.params.token);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.decision !== 'PENDING')
    return res.status(409).json({ error: 'Already decided', decision: existing.decision });
  db.updateDecision(req.params.token, decision, req.session.approverId, req.session.approverName, approverNotes || '');
  res.json({ ok: true, decision, submission: db.getSubmissionByToken(req.params.token) });
});

// ── Approver data ─────────────────────────────────────────────────────────────
app.get('/api/approver/pending', requireApprover, (req, res) => {
  const formIds = req.session.approverFormIds || [];
  res.json(formIds.length ? db.getAllSubmissions({ formIds, decision: 'PENDING' }) : []);
});
app.get('/api/approver/history', requireApprover, (req, res) => {
  res.json(db.getAllSubmissions({ approverId: req.session.approverId }));
});
app.get('/api/approver/metrics', requireApprover, (req, res) => {
  const formIds = req.session.approverFormIds || [];
  res.json(db.getMetrics(formIds.length ? formIds : null));
});

// ── Admin data ────────────────────────────────────────────────────────────────
app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  const { formId, decision, search } = req.query;
  res.json(db.getAllSubmissions({ formId, decision, search }));
});
app.get('/api/admin/metrics', requireAdmin, (req, res) => res.json(db.getMetrics()));
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const subs = db.getAllSubmissions({});
  const rows = [['Date','Form','Staff','Email','Department','Affiliate','Decision','Approver','Notes','Details']];
  subs.forEach(s => {
    const f = JSON.parse(s.fields_json);
    rows.push([s.submitted_at,s.form_name,s.requester_name,s.requester_email,s.department,s.affiliate_code,s.decision,s.approver_name||'',s.approver_notes||'',Object.values(f).map(x=>`${x.label}: ${x.value}`).join(' | ')]);
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition',`attachment; filename="concessions-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

app.listen(PORT, () => console.log(`iPROMOTEu Concession Portal on port ${PORT}`));
