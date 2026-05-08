const WAITLIST_SHEET_NAME = 'PERX Waitlist';
const PENDING_SHEET_NAME = 'PERX Pending Verifications';
const SPREADSHEET_ID = '19M0jKEKPFIeIeI5NIVIryoYY-cfuCF0CgqXEAfgrlrs';
const ADMIN_EMAIL = 'chasemallor@gmail.com';
const EMAIL_FROM_NAME = 'PERX';
const MIN_FORM_FILL_MS = 3000;
const VERIFICATION_TTL_HOURS = 72;
const TIMEZONE = 'America/New_York';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    return jsonResponse_(processSignup_(payload));
  } catch (error) {
    return jsonResponse_({ ok: false, message: 'Server error. Please try again later.' });
  }
}

function doGet(e) {
  const action = String((e.parameter && e.parameter.action) || '').trim();
  const callback = String((e.parameter && e.parameter.callback) || '').trim();

  if (action === 'signup') {
    const payload = {
      name: e.parameter.name,
      email: e.parameter.email,
      zipCode: e.parameter.zipCode,
      company: e.parameter.company,
      formStartedAt: e.parameter.formStartedAt,
      region: e.parameter.region,
      source: e.parameter.source,
      submittedAt: e.parameter.submittedAt,
      userAgent: e.parameter.userAgent,
    };

    const result = processSignup_(payload);
    if (callback) {
      return jsonpResponse_(callback, result);
    }

    return jsonResponse_(result);
  }

  if (action !== 'verify') {
    return HtmlService.createHtmlOutput(buildVerificationPage_({ ok: false, message: 'Invalid verification link.' }));
  }

  const token = String((e.parameter && e.parameter.token) || '').trim();
  if (!token) {
    return HtmlService.createHtmlOutput(buildVerificationPage_({ ok: false, message: 'Verification token is missing.' }));
  }

  const result = verifyPendingSignup_(token);
  return HtmlService.createHtmlOutput(buildVerificationPage_(result));
}

function processSignup_(payload) {
  const spreadsheet = getSpreadsheet_();
  const waitlistSheet = getOrCreateWaitlistSheet_(spreadsheet);
  const pendingSheet = getOrCreatePendingSheet_(spreadsheet);
  const email = normalizeEmail_(payload.email);
  const name = String(payload.name || '').trim();
  const zipCode = String(payload.zipCode || '').trim();
  const company = String(payload.company || '').trim();
  const formStartedAt = Number(payload.formStartedAt || 0);
  const elapsedMs = formStartedAt ? Date.now() - formStartedAt : 0;

  if (company) {
    return { ok: true, message: 'Submission received.' };
  }

  if (!name) {
    return { ok: false, message: 'Name is required.' };
  }

  if (!isValidEmail_(email)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  if (zipCode && !/^\d{5}(?:-\d{4})?$/.test(zipCode)) {
    return { ok: false, message: 'Enter a valid US ZIP code.' };
  }

  if (elapsedMs > 0 && elapsedMs < MIN_FORM_FILL_MS) {
    return { ok: false, message: 'Please wait a moment and try again.' };
  }

  const existingRow = findRowByEmail_(waitlistSheet, email);
  if (existingRow) {
    return { ok: false, message: 'That email is already on the waitlist.' };
  }

  const token = createVerificationToken_();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  upsertPendingSignup_(pendingSheet, {
    createdAt: now,
    name,
    email,
    zipCode,
    region: String(payload.region || 'Long Island').trim(),
    source: String(payload.source || '').trim(),
    userAgent: String(payload.userAgent || '').slice(0, 180),
    token,
    expiresAt,
  });

  sendVerificationEmail_(email, name, token);

  return {
    ok: true,
    message: 'Check your email and click the verification link to confirm your waitlist spot.',
  };
}

function verifyPendingSignup_(token) {
  const spreadsheet = getSpreadsheet_();
  const waitlistSheet = getOrCreateWaitlistSheet_(spreadsheet);
  const pendingSheet = getOrCreatePendingSheet_(spreadsheet);
  const pending = findPendingRowByToken_(pendingSheet, token);

  if (!pending) {
    return { ok: false, message: 'This verification link is invalid or has already been used.' };
  }

  if (pending.status === 'VERIFIED') {
    return { ok: true, message: 'Your email is already verified. You are on the waitlist.' };
  }

  if (pending.status !== 'PENDING') {
    return { ok: false, message: 'This verification link is no longer active. Submit the form again for a new link.' };
  }

  if (pending.expiresAt && pending.expiresAt.getTime() < Date.now()) {
    updatePendingStatus_(pendingSheet, pending.row, 'EXPIRED', '');
    return { ok: false, message: 'This verification link has expired. Submit the form again for a new link.' };
  }

  const existingRow = findRowByEmail_(waitlistSheet, pending.email);
  if (!existingRow) {
    waitlistSheet.appendRow([
      formatEasternTime_(new Date()),
      pending.name,
      pending.email,
      pending.zipCode,
      pending.region,
      pending.source,
    ]);

    notifyAdmin_(pending.name, pending.email, pending.zipCode);
  }

  updatePendingStatus_(pendingSheet, pending.row, 'VERIFIED', formatEasternTime_(new Date()));
  return { ok: true, message: 'Email verified. Your waitlist spot is confirmed.' };
}

function sendWaitlistBroadcast(subject, htmlBody, plainTextBody) {
  const sheet = getOrCreateWaitlistSheet_(getSpreadsheet_());
  const data = sheet.getDataRange().getValues();
  const sent = [];

  for (let index = 1; index < data.length; index += 1) {
    const email = normalizeEmail_(data[index][2]);

    if (!email) {
      continue;
    }

    if (sent.indexOf(email) !== -1) {
      continue;
    }

    MailApp.sendEmail({
      to: email,
      subject,
      htmlBody,
      body: plainTextBody || stripHtml_(htmlBody),
      name: EMAIL_FROM_NAME,
    });

    sent.push(email);
  }
}

function clearWaitlist() {
  const sheet = getOrCreateWaitlistSheet_(getSpreadsheet_());
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) {
    const spreadsheetId = extractSpreadsheetId_(SPREADSHEET_ID);
    if (spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}

function extractSpreadsheetId_(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  // Accept either a direct spreadsheet ID or a full Google Sheets URL.
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }

  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) {
    return raw;
  }

  return '';
}

function formatEasternTime_(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return Utilities.formatDate(date, TIMEZONE, 'M/d/yyyy h:mm:ss a');
}

function getOrCreateWaitlistSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(WAITLIST_SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(WAITLIST_SHEET_NAME);
    sheet.appendRow([
      'verifiedAt',
      'name',
      'email',
      'zipCode',
      'region',
      'source',
    ]);
  }

  return sheet;
}

function getOrCreatePendingSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(PENDING_SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(PENDING_SHEET_NAME);
    sheet.appendRow([
      'createdAt',
      'name',
      'email',
      'zipCode',
      'region',
      'source',
      'userAgent',
      'token',
      'status',
      'verifiedAt',
      'expiresAt',
    ]);
  }

  return sheet;
}

function findRowByEmail_(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const values = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (normalizeEmail_(values[index][0]) === email) {
      return index + 2;
    }
  }

  return null;
}

function upsertPendingSignup_(sheet, signup) {
  const existing = findPendingRowByEmail_(sheet, signup.email);
  const rowValues = [
    formatEasternTime_(signup.createdAt),
    signup.name,
    signup.email,
    signup.zipCode,
    signup.region,
    signup.source,
    signup.userAgent,
    signup.token,
    'PENDING',
    '',
    formatEasternTime_(signup.expiresAt),
  ];

  if (existing) {
    sheet.getRange(existing, 1, 1, rowValues.length).setValues([rowValues]);
    return existing;
  }

  sheet.appendRow(rowValues);
  return sheet.getLastRow();
}

function findPendingRowByEmail_(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const values = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (normalizeEmail_(values[index][0]) === email) {
      return index + 2;
    }
  }

  return null;
}

function findPendingRowByToken_(sheet, token) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    if (String(row[7] || '').trim() === token) {
      return {
        row: index + 2,
        name: String(row[1] || '').trim(),
        email: normalizeEmail_(row[2]),
        zipCode: String(row[3] || '').trim(),
        region: String(row[4] || '').trim(),
        source: String(row[5] || '').trim(),
        status: String(row[8] || '').trim().toUpperCase(),
        expiresAt: parseSheetDate_(row[10]),
      };
    }
  }

  return null;
}

function updatePendingStatus_(sheet, rowNumber, status, verifiedAt) {
  sheet.getRange(rowNumber, 9).setValue(status);
  sheet.getRange(rowNumber, 10).setValue(verifiedAt || '');
}

function createVerificationToken_() {
  const raw = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  return raw.slice(0, 48);
}

function parseSheetDate_(value) {
  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function sendVerificationEmail_(email, name, token) {
  const verifyUrl = ScriptApp.getService().getUrl() + '?action=verify&token=' + encodeURIComponent(token);
  const displayName = name || 'there';
  const subject = 'Confirm your PERX waitlist signup';
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#181423;">' +
    '<h2 style="margin-bottom:12px;">Confirm your PERX signup</h2>' +
    '<p>Hi ' + escapeHtml_(displayName) + ',</p>' +
    '<p>Click below to confirm your spot on the PERX waitlist.</p>' +
    '<p style="margin:0 0 10px;">For security, this link expires in ' + VERIFICATION_TTL_HOURS + ' hours.</p>' +
    '<p><a href="' + verifyUrl + '" style="display:inline-block;padding:12px 18px;background:#8b72e8;color:#ffffff;text-decoration:none;border-radius:999px;">Confirm waitlist spot</a></p>' +
    '<p>If you did not request this, you can ignore this email.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: email,
    subject,
    htmlBody,
    body: 'Confirm your PERX waitlist signup (expires in ' + VERIFICATION_TTL_HOURS + ' hours): ' + verifyUrl,
    name: EMAIL_FROM_NAME,
  });
}

function notifyAdmin_(name, email, zipCode) {
  if (!ADMIN_EMAIL || ADMIN_EMAIL === 'your-email@example.com') {
    return;
  }

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: 'New verified PERX waitlist member',
    body: 'Name: ' + name + '\nEmail: ' + email + '\nZIP code: ' + zipCode,
    name: EMAIL_FROM_NAME,
  });
}

function buildVerificationPage_(result) {
  const ok = !!(result && result.ok);
  const title = ok ? 'PERX Email Verified' : 'PERX Verification Needed';
  const message = escapeHtml_((result && result.message) || 'Verification could not be completed.');
  const accent = ok ? '#1d8b57' : '#ad2e2e';
  const bgA = ok ? 'rgba(116, 209, 151, 0.24)' : 'rgba(226, 151, 151, 0.22)';

  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font-family:Arial,sans-serif;background:radial-gradient(circle at 20% 10%,' + bgA + ',transparent 36%),linear-gradient(180deg,#fbfdf8,#ecf4e4);color:#162111;}' +
    '.card{max-width:560px;width:100%;background:rgba(255,255,255,.9);border:1px solid rgba(45,72,36,.15);border-radius:18px;padding:24px;box-shadow:0 18px 44px rgba(41,63,32,.14);}' +
    'h1{margin:0 0 10px;font-size:28px;line-height:1.1;color:#1a2b15;}' +
    '.status{display:inline-block;margin:0 0 12px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.75);border:1px solid rgba(0,0,0,.08);color:' + accent + ';font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;}' +
    'p{margin:0;color:#334b2a;line-height:1.55;font-size:16px;}' +
    '</style></head><body><main class="card"><p class="status">PERX</p><h1>' + title + '</h1><p>' + message + '</p></main></body></html>'
  );
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function jsonResponse_(payload, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function jsonpResponse_(callback, payload) {
  const safeCallback = String(callback || '').replace(/[^a-zA-Z0-9_$.]/g, '');
  const body = safeCallback + '(' + JSON.stringify(payload) + ');';
  const output = ContentService.createTextOutput(body);
  output.setMimeType(ContentService.MimeType.JAVASCRIPT);
  return output;
}

function stripHtml_(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
