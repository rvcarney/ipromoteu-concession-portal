const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.office365.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { ciphers: 'SSLv3' }
});

const from = process.env.SMTP_FROM || process.env.SMTP_USER;
const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const styles = `
  body { font-family: Arial, sans-serif; background: #f5f4f0; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e4e2da; }
  .header { background: #231f20; padding: 24px 32px; }
  .header .app-label { color: rgba(255,255,255,0.4); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 8px; }
  .body { padding: 28px 32px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; color: #231f20; }
  .sub { font-size: 13px; color: #5c5758; margin-bottom: 24px; }
  .rule { width: 32px; height: 3px; background: #F5C800; border-radius: 2px; margin-bottom: 24px; }
  .section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #9a9898; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e4e2da; }
  .field-row { display: flex; margin-bottom: 8px; font-size: 14px; }
  .field-label { flex: 0 0 160px; color: #5c5758; }
  .field-value { color: #231f20; font-weight: 500; }
  .btn { display: inline-block; padding: 14px 28px; border-radius: 6px; font-size: 15px; font-weight: 600; text-decoration: none; text-align: center; }
  .btn-primary { background: #F5C800; color: #231f20; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
  .badge-approved { background: #f0faf4; color: #16a34a; border: 1px solid #a7d9bb; }
  .badge-denied   { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; }
  .badge-pending  { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .footer { background: #f2f1ec; padding: 16px 32px; font-size: 12px; color: #9a9898; border-top: 1px solid #e4e2da; }
`;

function logoTag() {
  try {
    const logoPath = path.join(__dirname, '..', 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
      const data = fs.readFileSync(logoPath).toString('base64');
      return `<img src="data:image/png;base64,${data}" alt="iPROMOTEu" style="height:28px;display:block;"/>`;
    }
  } catch (e) {}
  return '<span style="color:white;font-weight:700;font-size:16px">iPROMOTEu</span>';
}

function buildFields(label, rows) {
  return `
    <div class="section-label">${label}</div>
    ${rows.map(([l, v]) => `
      <div class="field-row">
        <div class="field-label">${l}</div>
        <div class="field-value">${v || '—'}</div>
      </div>`).join('')}
    <br/>`;
}

// ── 1. Notify approver of new submission ─────────────────────────────────────
async function sendSubmissionToApprover({ submission, form }) {
  const reviewUrl = `${base}/review/${submission.decision_token}`;
  const fields = JSON.parse(submission.fields_json);
  const fieldRows = form.fields.map(f => [f.label, fields[f.id]?.value]);

  const html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
    <div class="wrap">
      <div class="header">${logoTag()}<div class="app-label">Concession Requests</div></div>
      <div class="body">
        <h1>New concession request</h1>
        <p class="sub">Submitted by ${submission.requester_name} on ${new Date(submission.submitted_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</p>
        <div class="rule"></div>
        ${buildFields('Requester', [
          ['Name',           submission.requester_name],
          ['Email',          submission.requester_email],
          ['Department',     submission.department],
          ['Affiliate code', submission.affiliate_code],
        ])}
        ${buildFields('Request details', fieldRows)}
        ${submission.notes ? buildFields('Notes', [['', submission.notes]]) : ''}
        <div class="section-label">Action required</div>
        <p style="font-size:14px;color:#5c5758;margin-bottom:20px">Please review this request and approve or deny it in the portal.</p>
        <a href="${reviewUrl}" class="btn btn-primary">Review request</a>
      </div>
      <div class="footer">iPROMOTEu Concession Request Portal &nbsp;·&nbsp; <a href="${base}/admin" style="color:#9a9898">Admin dashboard</a></div>
    </div>
  </body></html>`;

  await transporter.sendMail({
    from,
    to:      form.recipient_email,
    subject: `[Action Required] Concession Request — ${submission.form_name} — ${submission.requester_name}`,
    html,
  });
}

// ── 2. Notify requester of decision ──────────────────────────────────────────
async function sendDecisionToRequester({ submission }) {
  const approved = submission.decision === 'APPROVED';
  const badgeClass = approved ? 'badge-approved' : 'badge-denied';

  const html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
    <div class="wrap">
      <div class="header">${logoTag()}<div class="app-label">Concession Requests</div></div>
      <div class="body">
        <h1>Your request has been ${submission.decision.toLowerCase()}</h1>
        <p class="sub">${submission.form_name} &nbsp;·&nbsp; submitted ${new Date(submission.submitted_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</p>
        <div class="rule"></div>
        <div style="margin-bottom:20px"><span class="badge ${badgeClass}">${submission.decision}</span></div>
        ${buildFields('Request summary', [
          ['Form type',      submission.form_name],
          ['Affiliate code', submission.affiliate_code],
          ['Department',     submission.department],
        ])}
        ${buildFields('Decision details', [
          ['Decision',   submission.decision],
          ['Decided by', submission.approver_name  || '—'],
          ['Notes',      submission.approver_notes || '—'],
          ['Decided at', submission.decided_at ? new Date(submission.decided_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '—'],
        ])}
      </div>
      <div class="footer">iPROMOTEu Concession Request Portal</div>
    </div>
  </body></html>`;

  await transporter.sendMail({
    from,
    to:      submission.requester_email,
    subject: `[Concession ${submission.decision}] ${submission.form_name} — ${submission.affiliate_code}`,
    html,
  });
}

// ── 3. Test SMTP connection ───────────────────────────────────────────────────
async function testConnection() {
  return transporter.verify();
}

module.exports = { sendSubmissionToApprover, sendDecisionToRequester, testConnection };
