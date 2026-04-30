const nodemailer = require('nodemailer');

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

// ── Shared email styles ───────────────────────────────────────────────────────
const styles = `
  body { font-family: Arial, sans-serif; background: #f5f4f0; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e4e2da; }
  .header { background: #231f20; padding: 24px 32px; }
  .header img { height: 28px; }
  .header .app-label { color: rgba(255,255,255,0.4); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 8px; }
  .body { padding: 28px 32px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; color: #231f20; }
  .sub { font-size: 13px; color: #5c5758; margin-bottom: 24px; }
  .rule { width: 32px; height: 3px; background: #F5C800; border-radius: 2px; margin-bottom: 24px; }
  .section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #9a9898; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e4e2da; }
  .field-row { display: flex; margin-bottom: 8px; font-size: 14px; }
  .field-label { flex: 0 0 160px; color: #5c5758; }
  .field-value { color: #231f20; font-weight: 500; }
  .actions { display: flex; gap: 12px; margin: 24px 0; }
  .btn { display: inline-block; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none; text-align: center; }
  .btn-approve { background: #16a34a; color: #fff; }
  .btn-deny    { background: #b91c1c; color: #fff; }
  .btn-view    { background: #F5C800; color: #231f20; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
  .badge-approved { background: #f0faf4; color: #16a34a; border: 1px solid #a7d9bb; }
  .badge-denied   { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; }
  .badge-pending  { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .footer { background: #f2f1ec; padding: 16px 32px; font-size: 12px; color: #9a9898; border-top: 1px solid #e4e2da; }
`;

const logoDataUri = () => {
  try {
    const fs = require('fs'), path = require('path');
    const logoPath = path.join(__dirname, '..', 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
      const data = fs.readFileSync(logoPath).toString('base64');
      return `data:image/png;base64,${data}`;
    }
  } catch (e) {}
  return '';
};

function buildHeader(title, subtitle, badge) {
  const logo = logoDataUri();
  return `
    <div class="header">
      ${logo ? `<img src="${logo}" alt="iPROMOTEu"/>` : '<span style="color:white;font-weight:700;font-size:16px">iPROMOTEu</span>'}
      <div class="app-label">Concession Requests</div>
    </div>
    <div class="body">
      <h1>${title}</h1>
      ${badge ? `<div style="margin-bottom:8px">${badge}</div>` : ''}
      <p class="sub">${subtitle}</p>
      <div class="rule"></div>
  `;
}

function buildFields(label, rows) {
  return `
    <div class="section-label">${label}</div>
    ${rows.map(([l, v]) => `
      <div class="field-row">
        <div class="field-label">${l}</div>
        <div class="field-value">${v || '—'}</div>
      </div>`).join('')}
    <br/>
  `;
}

// ── Send submission to approver ───────────────────────────────────────────────
async function sendSubmissionToApprover({ submission, form, approveUrl, denyUrl }) {
  const fields = JSON.parse(submission.fields_json);
  const fieldRows = form.fields.map(f => [f.label, fields[f.id]?.value]);

  const html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
    <div class="wrap">
      ${buildHeader('New concession request', `Submitted by ${submission.requester_name} on ${new Date(submission.submitted_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`)}
      ${buildFields('Requester', [
        ['Name',           submission.requester_name],
        ['Email',          submission.requester_email],
        ['Department',     submission.department],
        ['Affiliate code', submission.affiliate_code],
      ])}
      ${buildFields('Request details', fieldRows)}
      ${submission.notes ? buildFields('Additional notes', [['Notes', submission.notes]]) : ''}
      <div class="section-label">Actions</div>
      <p style="font-size:13px;color:#5c5758;margin-bottom:16px">Review the request above and click to approve or deny. You will be prompted to confirm and add optional notes before the decision is recorded.</p>
      <div class="actions">
        <a href="${approveUrl}" class="btn btn-approve">Approve request</a>
        <a href="${denyUrl}"    class="btn btn-deny">Deny request</a>
      </div>
      <a href="${base}/review/${submission.decision_token}" style="font-size:12px;color:#5c5758;">View full request page</a>
    </div>
    <div class="footer">iPROMOTEu Concession Request Portal &nbsp;·&nbsp; Do not forward this email — approval links are unique to this request.</div>
    </div></body></html>`;

  await transporter.sendMail({
    from,
    to:      form.recipient_email,
    cc:      submission.requester_email,
    subject: `[Concession Request] ${submission.form_name} — ${submission.requester_name} — ${submission.affiliate_code}`,
    html,
  });
}

// ── Notify requester of decision ──────────────────────────────────────────────
async function sendDecisionToRequester({ submission }) {
  const approved = submission.decision === 'APPROVED';
  const badge = `<span class="badge badge-${approved ? 'approved' : 'denied'}">${submission.decision}</span>`;

  const html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
    <div class="wrap">
      ${buildHeader(
        `Your request has been ${submission.decision.toLowerCase()}`,
        `${submission.form_name} · submitted ${new Date(submission.submitted_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`,
        badge
      )}
      ${buildFields('Request summary', [
        ['Form type',      submission.form_name],
        ['Affiliate code', submission.affiliate_code],
        ['Department',     submission.department],
      ])}
      ${buildFields('Decision', [
        ['Decision',  submission.decision],
        ['Decided by', submission.approver_name || '—'],
        ['Decided at', submission.decided_at ? new Date(submission.decided_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '—'],
        ['Notes',      submission.approver_notes || '—'],
      ])}
    </div>
    <div class="footer">iPROMOTEu Concession Request Portal</div>
    </div></body></html>`;

  await transporter.sendMail({
    from,
    to:      submission.requester_email,
    subject: `[Concession ${submission.decision}] ${submission.form_name} — ${submission.affiliate_code}`,
    html,
  });
}

// ── Notify log keeper of decision ─────────────────────────────────────────────
async function sendDecisionToLogKeeper({ submission, logKeeperEmail }) {
  if (!logKeeperEmail) return;
  const approved = submission.decision === 'APPROVED';
  const badge = `<span class="badge badge-${approved ? 'approved' : 'denied'}">${submission.decision}</span>`;
  const fields = JSON.parse(submission.fields_json);
  const detailRows = Object.values(fields).map(f => [f.label, f.value]);

  const html = `<!DOCTYPE html><html><head><style>${styles}</style></head><body>
    <div class="wrap">
      ${buildHeader(`Concession ${submission.decision.toLowerCase()}`, `${submission.form_name} — for your records`, badge)}
      ${buildFields('Requester', [
        ['Name',           submission.requester_name],
        ['Email',          submission.requester_email],
        ['Department',     submission.department],
        ['Affiliate code', submission.affiliate_code],
      ])}
      ${buildFields('Request details', detailRows)}
      ${buildFields('Decision', [
        ['Decision',   submission.decision],
        ['Approver',   submission.approver_name || '—'],
        ['Notes',      submission.approver_notes || '—'],
        ['Decided at', submission.decided_at ? new Date(submission.decided_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '—'],
      ])}
      <a href="${base}/admin/submissions" class="btn btn-view" style="margin-top:8px">View dashboard</a>
    </div>
    <div class="footer">iPROMOTEu Concession Request Portal</div>
    </div></body></html>`;

  await transporter.sendMail({
    from,
    to:      logKeeperEmail,
    subject: `[Concession Log] ${submission.decision} — ${submission.form_name} — ${submission.requester_name}`,
    html,
  });
}

module.exports = { sendSubmissionToApprover, sendDecisionToRequester, sendDecisionToLogKeeper };
