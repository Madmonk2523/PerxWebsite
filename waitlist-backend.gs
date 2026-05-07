const SHEET_NAME = 'PERX Waitlist';
const ADMIN_EMAIL = 'chasemallor@gmail.com';
const EMAIL_FROM_NAME = 'PERX';
const MIN_FORM_FILL_MS = 3000;

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
  const token = String((e.parameter && e.parameter.token) || '').trim();
  const callback = String((e.parameter && e.parameter.callback) || '').trim();

  if (action === 'signup') {
    const payload = {
      name: e.parameter.name,
      email: e.parameter.email,
      town: e.parameter.town,
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

  if (action !== 'verify' || !token) {
    return HtmlService.createHtmlOutput('Invalid verification link.');
  }

  const sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet());
  const data = sheet.getDataRange().getValues();

  for (let index = 1; index < data.length; index += 1) {
    if (String(data[index][7] || '') !== token) {
      continue;
    }

    const rowNumber = index + 1;
    const status = String(data[index][6] || '').toLowerCase();

    if (status !== 'verified') {
      sheet.getRange(rowNumber, 7).setValue('verified');
      sheet.getRange(rowNumber, 9).setValue(new Date());
    }

    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:Arial,sans-serif;padding:32px;background:#f6f3ff;color:#181423;">' +
        '<h2 style="margin:0 0 12px;">PERX</h2>' +
        '<p style="margin:0;">Your email is confirmed. You are on the waitlist.</p>' +
      '</body></html>'
    );
  }

  return HtmlService.createHtmlOutput('Verification link expired or invalid.');
}

function processSignup_(payload) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(spreadsheet);
  const email = normalizeEmail_(payload.email);
  const name = String(payload.name || '').trim();
  const town = String(payload.town || '').trim();
  const company = String(payload.company || '').trim();
  const submittedAt = new Date(payload.submittedAt || new Date().toISOString());
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

  if (elapsedMs > 0 && elapsedMs < MIN_FORM_FILL_MS) {
    return { ok: false, message: 'Please wait a moment and try again.' };
  }

  const existingRow = findRowByEmail_(sheet, email);
  if (existingRow) {
    const existingStatus = String(sheet.getRange(existingRow, 7).getValue() || '').toLowerCase();
    const existingToken = String(sheet.getRange(existingRow, 8).getValue() || '');

    if (existingStatus === 'verified') {
      return { ok: false, message: 'That email is already on the waitlist.' };
    }

    if (existingStatus === 'pending' && existingToken) {
      sendVerificationEmail_(email, name, existingToken);
      return {
        ok: true,
        message: 'You already signed up. We sent a fresh confirmation email.',
      };
    }
  }

  const verificationToken = Utilities.getUuid();
  sheet.appendRow([
    new Date(),
    name,
    email,
    town,
    String(payload.region || 'Long Island').trim(),
    String(payload.source || 'website').trim(),
    'pending',
    verificationToken,
    '',
    String(payload.userAgent || '').trim(),
    submittedAt,
  ]);

  sendVerificationEmail_(email, name, verificationToken);
  notifyAdmin_(name, email, town);

  return {
    ok: true,
    message: 'Check your email to confirm your spot on the waitlist.',
  };
}

function sendWaitlistBroadcast(subject, htmlBody, plainTextBody) {
  const sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet());
  const data = sheet.getDataRange().getValues();
  const sent = [];

  for (let index = 1; index < data.length; index += 1) {
    const email = normalizeEmail_(data[index][2]);
    const status = String(data[index][6] || '').toLowerCase();

    if (!email || status !== 'verified') {
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

function getOrCreateSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'createdAt',
      'name',
      'email',
      'town',
      'region',
      'source',
      'status',
      'verificationToken',
      'verifiedAt',
      'userAgent',
      'submittedAt',
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

function sendVerificationEmail_(email, name, token) {
  const verifyUrl = ScriptApp.getService().getUrl() + '?action=verify&token=' + encodeURIComponent(token);
  const displayName = name || 'there';
  const subject = 'Confirm your PERX waitlist signup';
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#181423;">' +
    '<h2 style="margin-bottom:12px;">Confirm your PERX signup</h2>' +
    '<p>Hi ' + escapeHtml_(displayName) + ',</p>' +
    '<p>Click below to confirm your spot on the PERX waitlist.</p>' +
    '<p><a href="' + verifyUrl + '" style="display:inline-block;padding:12px 18px;background:#8b72e8;color:#ffffff;text-decoration:none;border-radius:999px;">Confirm waitlist spot</a></p>' +
    '<p>If you did not request this, you can ignore this email.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: email,
    subject,
    htmlBody,
    body: 'Confirm your PERX waitlist signup: ' + verifyUrl,
    name: EMAIL_FROM_NAME,
  });
}

function notifyAdmin_(name, email, town) {
  if (!ADMIN_EMAIL || ADMIN_EMAIL === 'your-email@example.com') {
    return;
  }

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: 'New PERX waitlist signup',
    body: 'Name: ' + name + '\nEmail: ' + email + '\nTown: ' + town,
    name: EMAIL_FROM_NAME,
  });
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
