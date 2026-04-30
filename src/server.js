require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const { v4: uuid } = require('uuid');
const path         = require('path');
const db           = require('./db');
const email        = require('./email');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

function sendPage(res, page) {
  res.sendFile(path.join(__dirname, '..', 'public', page + '.html'));
}

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/',                  (req, res) => sendPage(res, 'index'));
app.get('/review/:token',     (req, res) => sendPage(res, 'review'));
app.get('/admin/login',       (req, res) => sendPage(res, 'admin-login'));
app.get('/admin',             requireAdmin, (req, res) => res.redirect('/admin/dashboard'));
app.get('/admin/dashboard',   requireAdmin, (req, res) => sendPage(res, 'admin'));
app.get('/admin/submissions', requireAdmin, (req, res) => sendPage(res, 'admin'));
app.get('/admin/settings',    requireAdmin, (req, res) => sendPage(res, 'admin'));
app.get('/admin/forms',       requireAdmin, (req, res) => sendPage(res, 'admin'));

// ═══════════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════════

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  if (pin === (process.env.ADMIN_PIN || '1234')) {
    req.session.isAdmin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Incorrect PIN' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// ── Forms ─────────────────────────────────────────────────────────────────────
app.get('/api/forms', (req, res) => res.json(db.getForms()));

app.post('/api/forms', requireAdmin, (req, res) => {
  const { name, recipientEmail, fields } = req.body;
  if (!name) return res.status(400).json({ error: 'Form name is required' });
  const id = 'custom-' + Date.now();
  db.createForm(id, name, recipientEmail || '', fields || []);
  res.json({ ok: true, id });
});

app.patch('/api/forms/:id/email', requireAdmin, (req, res) => {
  db.updateFormEmail(req.params.id, req.body.email || '');
  res.json({ ok: true });
});

app.delete('/api/forms/:id', requireAdmin, (req, res) => {
  db.deleteForm(req.params.id);
  res.json({ ok: true });
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAdmin, (req, res) => {
  res.json({ smtpStatus: !!process.env.SMTP_USER });
});

// ── Test SMTP ─────────────────────────────────────────────────────────────────
app.get('/api/admin/test-email', requireAdmin, async (req, res) => {
  try {
    await email.testConnection();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Submit a concession request ───────────────────────────────────────────────
app.post('/api/submissions', async (req, res) => {
  const { formId, name, email: reqEmail, department, affiliateCode, fields, notes } = req.body;

  if (!formId || !name || !reqEmail || !department || !affiliateCode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const form = db.getForm(formId);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  if (!form.recipient_email) {
    return res.status(400).json({ error: 'This form has no approver configured. Please ask your admin to set one up in Email routing.' });
  }

  for (const f of form.fields) {
    if (f.required && !fields?.[f.id]?.value?.trim()) {
      return res.status(400).json({ error: `Missing required field: ${f.label}` });
    }
  }

  const id    = uuid();
  const token = uuid();

  const submission = {
    id,
    form_id:         formId,
    form_name:       form.name,
    requester_name:  name,
    requester_email: reqEmail,
    department,
    affiliate_code:  affiliateCode,
    fields_json:     JSON.stringify(fields || {}),
    notes:           notes || '',
    decision_token:  token,
  };

  db.createSubmission(submission);
  const saved = db.getSubmissionById(id);

  // Send notification email to approver
  try {
    await email.sendSubmissionToApprover({ submission: saved, form });
  } catch (err) {
    console.error('Approver email failed:', err.message);
    return res.json({ ok: true, id, emailWarning: 'Request saved but notification email failed. Check SMTP settings in Render environment variables.' });
  }

  res.json({ ok: true, id });
});

// ── Get submission by token (review page) ─────────────────────────────────────
app.get('/api/review/:token', (req, res) => {
  const sub = db.getSubmissionByToken(req.params.token);
  if (!sub) return res.status(404).json({ error: 'Request not found' });
  const form = db.getForm(sub.form_id);
  res.json({ submission: sub, form });
});

// ── Submit decision ───────────────────────────────────────────────────────────
app.post('/api/review/:token/decide', async (req, res) => {
  const { decision, approverName, approverEmail, approverNotes } = req.body;
  const token = req.params.token;

  if (!['APPROVED', 'DENIED'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be APPROVED or DENIED' });
  }
  if (!approverName?.trim()) {
    return res.status(400).json({ error: 'Your name is required' });
  }
  if (decision === 'DENIED' && !approverNotes?.trim()) {
    return res.status(400).json({ error: 'Please provide a reason for denying this request' });
  }

  const existing = db.getSubmissionByToken(token);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.decision !== 'PENDING') {
    return res.status(409).json({ error: 'This request has already been decided', decision: existing.decision });
  }

  db.updateDecision(token, decision, approverName.trim(), approverEmail || '', approverNotes || '');
  const updated = db.getSubmissionByToken(token);

  // Notify requester
  try {
    await email.sendDecisionToRequester({ submission: updated });
  } catch (err) {
    console.error('Decision email failed:', err.message);
  }

  res.json({ ok: true, decision });
});

// ── Admin: metrics ────────────────────────────────────────────────────────────
app.get('/api/admin/metrics', requireAdmin, (req, res) => {
  res.json(db.getMetrics());
});

// ── Admin: submissions ────────────────────────────────────────────────────────
app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  const { formId, decision, search } = req.query;
  res.json(db.getAllSubmissions({ formId, decision, search }));
});

// ── Admin: export CSV ─────────────────────────────────────────────────────────
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const subs = db.getAllSubmissions({});
  const rows = [['Date','Form','Staff name','Staff email','Department','Affiliate','Decision','Approver','Approver notes','Details']];
  subs.forEach(s => {
    const fields  = JSON.parse(s.fields_json);
    const details = Object.values(fields).map(f => `${f.label}: ${f.value}`).join(' | ');
    rows.push([
      s.submitted_at, s.form_name, s.requester_name, s.requester_email,
      s.department, s.affiliate_code, s.decision,
      s.approver_name || '', s.approver_notes || '', details
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="concessions-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`iPROMOTEu Concession Portal running on port ${PORT}`);
  console.log(`Base URL: ${BASE}`);
  console.log(`SMTP configured: ${!!process.env.SMTP_USER}`);
});
