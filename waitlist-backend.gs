const SPREADSHEET_ID = '19M0jKEKPFIeIeI5NIVIryoYY-cfuCF0CgqXEAfgrlrs';
const SUBMISSIONS_SHEET_NAME = 'PERX Submissions';
const VERIFICATIONS_SHEET_NAME = 'PERX Verifications';
const AUDIT_SHEET_NAME = 'PERX Audit Log';
const SETTINGS_SHEET_NAME = 'PERX Settings';

const ADMIN_EMAIL = 'chasemallor@gmail.com';
const SUPPORT_EMAIL = 'support@joinperx.com';
const EMAIL_FROM_NAME = 'PERX';

const AGREEMENT_PREFIX = 'PERX-';
const AGREEMENT_START_SEQUENCE = 241;
const VERIFICATION_TTL_MINUTES = 15;
const SUBMISSION_RATE_WINDOW_MS = 15 * 60 * 1000;
const SUBMISSION_RATE_LIMIT = 5;
const MAX_CODE_ATTEMPTS = 8;

const ACTIONS = {
  START_VERIFICATION: 'startVerification',
  VERIFY_CODE: 'verifyCode',
  SUBMIT_AGREEMENT: 'submitAgreement',
  ADMIN_APPROVE: 'adminApprove',
  ADMIN_REJECT: 'adminReject',
  ADMIN_REQUEST_INFO: 'adminRequestInfo'
};

function doGet(e) {
  const action = String((e.parameter && e.parameter.action) || '').trim();
  const callback = String((e.parameter && e.parameter.callback) || '').trim();

  if (action === ACTIONS.ADMIN_APPROVE || action === ACTIONS.ADMIN_REJECT || action === ACTIONS.ADMIN_REQUEST_INFO) {
    const status = action === ACTIONS.ADMIN_APPROVE
      ? 'Approved'
      : action === ACTIONS.ADMIN_REJECT
        ? 'Rejected'
        : 'More Info Requested';
    const result = adminDecision_(e.parameter || {}, status);
    return HtmlService.createHtmlOutput(buildAdminResultPage_(result, status));
  }

  try {
    const result = routeAction_(action, e.parameter || {});
    if (callback) {
      return jsonpResponse_(callback, result);
    }
    return jsonResponse_(result);
  } catch (error) {
    const fallback = {
      ok: false,
      message: 'Server error. Please try again.',
      errorCode: 'SERVER_ERROR'
    };

    if (callback) {
      return jsonpResponse_(callback, fallback);
    }

    return jsonResponse_(fallback);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = String(payload.action || '').trim();
    const result = routeAction_(action, payload);
    return jsonResponse_(result);
  } catch (error) {
    return jsonResponse_({ ok: false, message: 'Invalid request payload.', errorCode: 'BAD_REQUEST' });
  }
}

function routeAction_(action, payload) {
  switch (action) {
    case ACTIONS.START_VERIFICATION:
      return startVerification_(payload);
    case ACTIONS.VERIFY_CODE:
      return verifyCode_(payload);
    case ACTIONS.SUBMIT_AGREEMENT:
      return submitAgreement_(payload);
    case ACTIONS.ADMIN_APPROVE:
      return adminDecision_(payload, 'Approved');
    case ACTIONS.ADMIN_REJECT:
      return adminDecision_(payload, 'Rejected');
    case ACTIONS.ADMIN_REQUEST_INFO:
      return adminDecision_(payload, 'More Info Requested');
    default:
      return { ok: false, message: 'Unsupported action.', errorCode: 'UNSUPPORTED_ACTION' };
  }
}

function startVerification_(payload) {
  const businessName = cleanText_(payload.businessName);
  const businessEmail = normalizeEmail_(payload.businessEmail);
  const businessPhone = cleanPhone_(payload.businessPhone);
  const website = cleanText_(payload.website);
  const ownerName = cleanText_(payload.ownerName);
  const ipAddress = cleanText_(payload.ipAddress);

  if (!businessName || !isValidEmail_(businessEmail) || !businessPhone) {
    return {
      ok: false,
      message: 'Business name, valid email, and phone are required to send codes.',
      errorCode: 'VALIDATION_ERROR'
    };
  }

  if (!passesRateLimit_(ipAddress)) {
    return {
      ok: false,
      message: 'Too many attempts. Please wait a few minutes and try again.',
      errorCode: 'RATE_LIMITED'
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MINUTES * 60 * 1000);
  const sessionId = createSessionId_();
  const emailCode = generateSixDigitCode_();
  const phoneCode = generateSixDigitCode_();

  const sheet = getOrCreateVerificationSheet_();
  sheet.appendRow([
    sessionId,
    formatIso_(now),
    formatIso_(expiresAt),
    businessName,
    businessEmail,
    businessPhone,
    website,
    ownerName,
    maskCode_(emailCode),
    maskCode_(phoneCode),
    hashCode_(emailCode),
    hashCode_(phoneCode),
    'false',
    'false',
    '',
    '',
    ipAddress,
    cleanText_(payload.userAgent),
    cleanText_(payload.deviceInfo),
    '0',
    '0',
    ''
  ]);

  sendEmailCode_(businessEmail, ownerName || businessName, emailCode);
  sendSmsCodeFallback_(businessPhone, phoneCode);

  logAudit_('VERIFICATION_STARTED', {
    sessionId,
    businessName,
    businessEmail,
    businessPhone,
    ipAddress
  });

  return {
    ok: true,
    message: 'Verification codes sent to your business email and phone.',
    sessionId,
    expiresInMinutes: VERIFICATION_TTL_MINUTES,
    devHints: buildDevHint_(),
    verificationPolicy: 'Email and phone verification are required before submission.'
  };
}

function verifyCode_(payload) {
  const sessionId = cleanText_(payload.sessionId);
  const channel = cleanText_(payload.channel).toLowerCase();
  const code = cleanText_(payload.code);
  const ipAddress = cleanText_(payload.ipAddress);

  if (!sessionId || !/^[0-9]{6}$/.test(code) || (channel !== 'email' && channel !== 'phone')) {
    return { ok: false, message: 'Invalid verification request.', errorCode: 'VALIDATION_ERROR' };
  }

  const rowMatch = findVerificationSessionRow_(sessionId);
  if (!rowMatch) {
    return { ok: false, message: 'Verification session not found.', errorCode: 'SESSION_NOT_FOUND' };
  }

  const sheet = rowMatch.sheet;
  const row = rowMatch.row;
  const values = sheet.getRange(row, 1, 1, 22).getValues()[0];

  const expiresAt = parseDate_(values[2]);
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { ok: false, message: 'Verification session expired. Send new codes.', errorCode: 'SESSION_EXPIRED' };
  }

  let emailAttempts = Number(values[19] || 0);
  let phoneAttempts = Number(values[20] || 0);

  if (channel === 'email') {
    emailAttempts += 1;
    if (emailAttempts > MAX_CODE_ATTEMPTS) {
      return { ok: false, message: 'Too many email verification attempts.', errorCode: 'TOO_MANY_ATTEMPTS' };
    }

    const ok = safeEquals_(hashCode_(code), String(values[10] || ''));
    sheet.getRange(row, 20).setValue(String(emailAttempts));

    if (!ok) {
      return { ok: false, message: 'Incorrect email code.', errorCode: 'INVALID_CODE' };
    }

    sheet.getRange(row, 13).setValue('true');
    sheet.getRange(row, 15).setValue(formatIso_(new Date()));
    sheet.getRange(row, 22).setValue(ipAddress);

    logAudit_('EMAIL_VERIFIED', { sessionId, ipAddress });

    return { ok: true, message: 'Email verified successfully.' };
  }

  phoneAttempts += 1;
  if (phoneAttempts > MAX_CODE_ATTEMPTS) {
    return { ok: false, message: 'Too many phone verification attempts.', errorCode: 'TOO_MANY_ATTEMPTS' };
  }

  const ok = safeEquals_(hashCode_(code), String(values[11] || ''));
  sheet.getRange(row, 21).setValue(String(phoneAttempts));

  if (!ok) {
    return { ok: false, message: 'Incorrect phone code.', errorCode: 'INVALID_CODE' };
  }

  sheet.getRange(row, 14).setValue('true');
  sheet.getRange(row, 16).setValue(formatIso_(new Date()));
  sheet.getRange(row, 22).setValue(ipAddress);

  logAudit_('PHONE_VERIFIED', { sessionId, ipAddress });

  return { ok: true, message: 'Phone verified successfully.' };
}

function submitAgreement_(payload) {
  const submission = normalizeSubmissionPayload_(payload);

  const validationMessage = validateSubmission_(submission);
  if (validationMessage) {
    return { ok: false, message: validationMessage, errorCode: 'VALIDATION_ERROR' };
  }

  if (!passesRateLimit_(submission.ipAddress)) {
    return {
      ok: false,
      message: 'Too many submissions from this source. Please wait and try again.',
      errorCode: 'RATE_LIMITED'
    };
  }

  const verification = getVerifiedSession_(submission.sessionId);
  if (!verification.ok) {
    return verification;
  }

  const existingDupes = detectDuplicateSubmission_(submission);
  const fraudFlags = computeFraudFlags_(submission, verification.session, existingDupes);

  const agreementId = nextAgreementId_();
  const now = new Date();
  const status = 'Pending Approval';

  const pdfResult = generateAgreementPdf_(submission, verification.session, agreementId, fraudFlags, now);
  const pdfUrl = pdfResult.url || '';

  const rowData = buildSubmissionRow_(submission, verification.session, {
    agreementId,
    status,
    submittedAt: now,
    fraudFlags,
    pdfUrl,
    publicBusinessMatchStatus: simulateBusinessMatch_(submission),
    ownershipVerified: 'Pending Review'
  });

  const sheet = getOrCreateSubmissionSheet_();
  sheet.appendRow(rowData);

  sendBusinessConfirmation_(submission, agreementId, pdfResult.file);
  sendAdminSubmissionEmail_(submission, agreementId, status, fraudFlags, pdfUrl);

  logAudit_('AGREEMENT_SUBMITTED', {
    agreementId,
    businessName: submission.businessName,
    businessEmail: submission.businessEmail,
    status,
    fraudFlags: fraudFlags.join('|')
  });

  return {
    ok: true,
    message: 'Agreement submitted successfully. Pending admin review.',
    agreementId,
    pdfUrl,
    approvalStatus: status,
    fraudFlags
  };
}

function adminDecision_(payload, status) {
  const agreementId = cleanText_(payload.agreementId);
  const adminNotes = cleanText_(payload.adminNotes);

  if (!agreementId) {
    return { ok: false, message: 'Agreement ID is required.', errorCode: 'VALIDATION_ERROR' };
  }

  const found = findSubmissionByAgreementId_(agreementId);
  if (!found) {
    return { ok: false, message: 'Agreement not found.', errorCode: 'NOT_FOUND' };
  }

  const row = found.row;
  const sheet = found.sheet;
  const values = sheet.getRange(row, 1, 1, 41).getValues()[0];

  sheet.getRange(row, 36).setValue(status);
  sheet.getRange(row, 37).setValue(formatIso_(new Date()));
  sheet.getRange(row, 38).setValue(adminNotes);

  const businessEmail = normalizeEmail_(values[9]);
  const businessName = cleanText_(values[5]);
  const offer = cleanText_(values[14]);

  sendAdminDecisionEmail_(businessEmail, businessName, agreementId, status, offer, adminNotes);

  logAudit_('ADMIN_DECISION', {
    agreementId,
    status,
    adminNotes
  });

  return {
    ok: true,
    message: 'Decision updated successfully.',
    agreementId,
    status
  };
}

function normalizeSubmissionPayload_(payload) {
  return {
    sessionId: cleanText_(payload.sessionId),
    agreementVersion: cleanText_(payload.agreementVersion) || '2026.06.25',
    businessName: cleanText_(payload.businessName),
    businessAddress: cleanText_(payload.businessAddress),
    city: cleanText_(payload.city),
    state: cleanText_(payload.state).toUpperCase(),
    zipCode: cleanText_(payload.zipCode),
    businessPhone: cleanPhone_(payload.businessPhone),
    businessEmail: normalizeEmail_(payload.businessEmail),
    website: cleanText_(payload.website),
    businessCategory: cleanText_(payload.businessCategory),
    ownerName: cleanText_(payload.ownerName),
    jobTitle: cleanText_(payload.jobTitle),
    notes: cleanText_(payload.notes),
    offerDetails: cleanText_(payload.offerDetails),
    signatureName: cleanText_(payload.signatureName),
    signatureDate: cleanText_(payload.signatureDate),
    drawnSignature: cleanText_(payload.drawnSignature),
    drawnSignaturePresent: cleanText_(payload.drawnSignaturePresent) === 'true',
    consentAuthority: cleanText_(payload.consentAuthority) === 'true',
    consentAgreement: cleanText_(payload.consentAgreement) === 'true',
    consentLegalBinding: cleanText_(payload.consentLegalBinding) === 'true',
    consentESign: cleanText_(payload.consentESign) === 'true',
    consentPerjury: cleanText_(payload.consentPerjury) === 'true',
    formStartedAt: cleanText_(payload.formStartedAt),
    submittedAt: cleanText_(payload.submittedAt),
    ipAddress: cleanText_(payload.ipAddress),
    userAgent: cleanText_(payload.userAgent),
    browser: cleanText_(payload.browser),
    operatingSystem: cleanText_(payload.operatingSystem),
    deviceInfo: cleanText_(payload.deviceInfo),
    approxLocation: cleanText_(payload.approxLocation),
    emailVerificationStatus: cleanText_(payload.emailVerificationStatus) === 'true',
    phoneVerificationStatus: cleanText_(payload.phoneVerificationStatus) === 'true',
    emailDomainStatus: cleanText_(payload.emailDomainStatus)
  };
}

function validateSubmission_(submission) {
  const required = [
    submission.sessionId,
    submission.businessName,
    submission.businessAddress,
    submission.city,
    submission.state,
    submission.zipCode,
    submission.businessPhone,
    submission.businessEmail,
    submission.businessCategory,
    submission.ownerName,
    submission.jobTitle,
    submission.offerDetails,
    submission.signatureName,
    submission.signatureDate
  ];

  for (let index = 0; index < required.length; index += 1) {
    if (!required[index]) {
      return 'Please complete all required fields before submission.';
    }
  }

  if (!isValidEmail_(submission.businessEmail)) {
    return 'Enter a valid business email address.';
  }

  if (!submission.consentAuthority || !submission.consentAgreement || !submission.consentLegalBinding || !submission.consentESign || !submission.consentPerjury) {
    return 'All required agreement confirmations must be accepted.';
  }

  if (!submission.emailVerificationStatus || !submission.phoneVerificationStatus) {
    return 'Email and phone verification are required before submission.';
  }

  return '';
}

function getVerifiedSession_(sessionId) {
  const rowMatch = findVerificationSessionRow_(sessionId);
  if (!rowMatch) {
    return { ok: false, message: 'Verification session not found.', errorCode: 'SESSION_NOT_FOUND' };
  }

  const values = rowMatch.sheet.getRange(rowMatch.row, 1, 1, 22).getValues()[0];
  const expiresAt = parseDate_(values[2]);

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { ok: false, message: 'Verification session expired.', errorCode: 'SESSION_EXPIRED' };
  }

  const emailVerified = String(values[12]) === 'true';
  const phoneVerified = String(values[13]) === 'true';

  if (!emailVerified || !phoneVerified) {
    return {
      ok: false,
      message: 'Email and phone verification must both be completed.',
      errorCode: 'VERIFICATION_REQUIRED'
    };
  }

  return {
    ok: true,
    session: {
      sessionId: String(values[0] || ''),
      startedAt: String(values[1] || ''),
      expiresAt: String(values[2] || ''),
      businessName: cleanText_(values[3]),
      businessEmail: normalizeEmail_(values[4]),
      businessPhone: cleanPhone_(values[5]),
      website: cleanText_(values[6]),
      ownerName: cleanText_(values[7]),
      emailVerifiedAt: String(values[14] || ''),
      phoneVerifiedAt: String(values[15] || ''),
      verificationIp: String(values[21] || '')
    }
  };
}

function detectDuplicateSubmission_(submission) {
  const sheet = getOrCreateSubmissionSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {
      duplicateBusiness: false,
      duplicateEmail: false,
      duplicatePhone: false,
      duplicateIpRecentCount: 0,
      duplicateDeviceRecentCount: 0
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 41).getValues();
  const nowMs = Date.now();

  let duplicateBusiness = false;
  let duplicateEmail = false;
  let duplicatePhone = false;
  let duplicateIpRecentCount = 0;
  let duplicateDeviceRecentCount = 0;

  rows.forEach(function (row) {
    const businessName = cleanText_(row[5]).toLowerCase();
    const email = normalizeEmail_(row[9]);
    const phone = cleanPhone_(row[8]);
    const ipAddress = cleanText_(row[23]);
    const deviceInfo = cleanText_(row[26]);
    const submittedAt = parseDate_(row[1]);

    if (businessName && businessName === submission.businessName.toLowerCase()) {
      duplicateBusiness = true;
    }
    if (email && email === submission.businessEmail) {
      duplicateEmail = true;
    }
    if (phone && phone === submission.businessPhone) {
      duplicatePhone = true;
    }

    if (submittedAt) {
      const recent = nowMs - submittedAt.getTime() <= SUBMISSION_RATE_WINDOW_MS;
      if (recent && ipAddress && ipAddress === submission.ipAddress) {
        duplicateIpRecentCount += 1;
      }
      if (recent && deviceInfo && deviceInfo === submission.deviceInfo) {
        duplicateDeviceRecentCount += 1;
      }
    }
  });

  return {
    duplicateBusiness,
    duplicateEmail,
    duplicatePhone,
    duplicateIpRecentCount,
    duplicateDeviceRecentCount
  };
}

function computeFraudFlags_(submission, verificationSession, dupes) {
  const flags = [];

  if (submission.emailDomainStatus === 'PUBLIC_EMAIL_DOMAIN') {
    flags.push('Public email domain');
  }
  if (submission.emailDomainStatus === 'DOMAIN_MISMATCH') {
    flags.push('Email domain mismatch');
  }
  if (submission.emailDomainStatus === 'NO_WEBSITE_PROVIDED') {
    flags.push('Website not provided');
  }

  if (!websiteLooksValid_(submission.website)) {
    flags.push('Website does not exist or is unreachable');
  }

  if (dupes.duplicateBusiness) {
    flags.push('Duplicate business submitted');
  }
  if (dupes.duplicatePhone) {
    flags.push('Duplicate phone number');
  }
  if (dupes.duplicateEmail) {
    flags.push('Duplicate email address');
  }
  if (dupes.duplicateIpRecentCount >= 2) {
    flags.push('Duplicate IPs in a short period');
  }
  if (dupes.duplicateDeviceRecentCount >= 2) {
    flags.push('Multiple submissions from one device');
  }

  if (isHighRiskLocation_(submission.approxLocation)) {
    flags.push('Impossible or high-risk location pattern');
  }

  if (submission.approxLocation.toLowerCase().indexOf('vpn') !== -1 || submission.userAgent.toLowerCase().indexOf('proxy') !== -1) {
    flags.push('VPN/proxy signal');
  }

  if (!likelyBusinessName_(submission.businessName)) {
    flags.push('Business name cannot be confidently located');
  }

  if (verificationSession.businessEmail !== submission.businessEmail || verificationSession.businessPhone !== submission.businessPhone) {
    flags.push('Submission does not match verification session');
  }

  if (!flags.length) {
    flags.push('No automated fraud flags');
  }

  return flags;
}

function buildSubmissionRow_(submission, session, context) {
  return [
    context.agreementId,
    formatIso_(context.submittedAt),
    submission.agreementVersion,
    session.sessionId,
    context.status,
    submission.businessName,
    submission.businessAddress,
    submission.city,
    submission.businessPhone,
    submission.businessEmail,
    submission.website,
    submission.state,
    submission.zipCode,
    submission.businessCategory,
    submission.offerDetails,
    submission.ownerName,
    submission.jobTitle,
    submission.notes,
    submission.signatureName,
    submission.signatureDate,
    submission.drawnSignaturePresent ? 'Yes' : 'No',
    submission.drawnSignature,
    cleanText_(submission.submittedAt),
    submission.ipAddress,
    submission.browser,
    submission.operatingSystem,
    submission.deviceInfo,
    submission.userAgent,
    submission.approxLocation,
    submission.emailVerificationStatus ? 'Verified' : 'Not Verified',
    submission.phoneVerificationStatus ? 'Verified' : 'Not Verified',
    submission.emailDomainStatus,
    context.publicBusinessMatchStatus,
    context.fraudFlags.join(' | '),
    context.pdfUrl,
    context.status,
    '',
    '',
    context.ownershipVerified,
    formatIso_(new Date()),
    ''
  ];
}

function generateAgreementPdf_(submission, session, agreementId, fraudFlags, submittedAt) {
  const docName = agreementId + ' - ' + submission.businessName + ' - Signed Agreement';
  const doc = DocumentApp.create(docName);
  const body = doc.getBody();

  body.appendParagraph('PERX Business Participation Agreement').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Agreement ID: ' + agreementId);
  body.appendParagraph('Agreement Version: ' + submission.agreementVersion);
  body.appendParagraph('Submission Timestamp: ' + formatIso_(submittedAt));

  body.appendParagraph('');
  body.appendParagraph('Business Information').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Business Name: ' + submission.businessName);
  body.appendParagraph('Business Address: ' + submission.businessAddress + ', ' + submission.city + ', ' + submission.state + ' ' + submission.zipCode);
  body.appendParagraph('Business Phone: ' + submission.businessPhone);
  body.appendParagraph('Business Email: ' + submission.businessEmail);
  body.appendParagraph('Website: ' + (submission.website || 'N/A'));
  body.appendParagraph('Business Category: ' + submission.businessCategory);

  body.appendParagraph('');
  body.appendParagraph('Authorized Representative').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Full Name: ' + submission.ownerName);
  body.appendParagraph('Job Title: ' + submission.jobTitle);
  body.appendParagraph('Typed Legal Signature Name: ' + submission.signatureName);
  body.appendParagraph('Signature Date: ' + submission.signatureDate);
  body.appendParagraph('Drawn Signature Included: ' + (submission.drawnSignaturePresent ? 'Yes' : 'No'));

  body.appendParagraph('');
  body.appendParagraph('Promotion').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(submission.offerDetails);

  body.appendParagraph('');
  body.appendParagraph('Agreement Confirmations').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Authority certification: ' + yesNo_(submission.consentAuthority));
  body.appendParagraph('Agreement accepted: ' + yesNo_(submission.consentAgreement));
  body.appendParagraph('Legally binding acknowledgment: ' + yesNo_(submission.consentLegalBinding));
  body.appendParagraph('Electronic signature consent: ' + yesNo_(submission.consentESign));
  body.appendParagraph('Perjury declaration accepted: ' + yesNo_(submission.consentPerjury));

  body.appendParagraph('');
  body.appendParagraph('Verification and Metadata').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Verification Session ID: ' + session.sessionId);
  body.appendParagraph('Email Verification Status: ' + (submission.emailVerificationStatus ? 'Verified' : 'Not Verified'));
  body.appendParagraph('Phone Verification Status: ' + (submission.phoneVerificationStatus ? 'Verified' : 'Not Verified'));
  body.appendParagraph('Email Verified At: ' + (session.emailVerifiedAt || 'N/A'));
  body.appendParagraph('Phone Verified At: ' + (session.phoneVerifiedAt || 'N/A'));
  body.appendParagraph('Submission IP Address: ' + (submission.ipAddress || 'N/A'));
  body.appendParagraph('Verification IP Address: ' + (session.verificationIp || 'N/A'));
  body.appendParagraph('Browser: ' + submission.browser);
  body.appendParagraph('Operating System: ' + submission.operatingSystem);
  body.appendParagraph('Device Information: ' + submission.deviceInfo);
  body.appendParagraph('User Agent: ' + submission.userAgent);
  body.appendParagraph('Approximate Location: ' + submission.approxLocation);

  body.appendParagraph('');
  body.appendParagraph('Automated Fraud Detection Flags').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  fraudFlags.forEach(function (flag) {
    body.appendParagraph('- ' + flag);
  });

  body.appendParagraph('');
  body.appendParagraph('PERX retains this agreement and associated metadata as part of a permanent audit record.');

  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  const pdfBlob = file.getAs(MimeType.PDF).setName(docName + '.pdf');
  const pdfFile = DriveApp.createFile(pdfBlob);
  file.setTrashed(true);

  return {
    file: pdfFile,
    url: pdfFile.getUrl()
  };
}

function sendBusinessConfirmation_(submission, agreementId, pdfFile) {
  const subject = 'Welcome to PERX!';
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10233f;">' +
    '<h2 style="margin:0 0 12px;">Welcome to PERX!</h2>' +
    '<p>Thank you for joining PERX.</p>' +
    '<p>Your agreement has been received and is now pending review.</p>' +
    '<p><strong>Agreement Number:</strong> ' + escapeHtml_(agreementId) + '</p>' +
    '<p><strong>Your Offer:</strong> ' + escapeHtml_(submission.offerDetails) + '</p>' +
    '<p>If you have any questions, contact ' + escapeHtml_(SUPPORT_EMAIL) + '.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: submission.businessEmail,
    subject: subject,
    htmlBody: htmlBody,
    body:
      'Welcome to PERX!\n\n' +
      'Thank you for joining PERX.\n' +
      'Your agreement has been received and is pending review.\n\n' +
      'Agreement Number: ' + agreementId + '\n' +
      'Offer: ' + submission.offerDetails + '\n' +
      'Support: ' + SUPPORT_EMAIL,
    name: EMAIL_FROM_NAME,
    attachments: pdfFile ? [pdfFile.getBlob()] : []
  });
}

function sendAdminSubmissionEmail_(submission, agreementId, status, fraudFlags, pdfUrl) {
  if (!ADMIN_EMAIL) {
    return;
  }

  const approveUrl = buildAdminActionUrl_(ACTIONS.ADMIN_APPROVE, agreementId, submission.businessName);
  const rejectUrl = buildAdminActionUrl_(ACTIONS.ADMIN_REJECT, agreementId, submission.businessName);
  const requestInfoUrl = buildAdminActionUrl_(ACTIONS.ADMIN_REQUEST_INFO, agreementId, submission.businessName);

  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10233f;">' +
    '<h2 style="margin:0 0 12px;">New business submitted</h2>' +
    '<p><strong>Business Name:</strong> ' + escapeHtml_(submission.businessName) + '</p>' +
    '<p><strong>Owner:</strong> ' + escapeHtml_(submission.ownerName) + '</p>' +
    '<p><strong>Email:</strong> ' + escapeHtml_(submission.businessEmail) + '</p>' +
    '<p><strong>Phone:</strong> ' + escapeHtml_(submission.businessPhone) + '</p>' +
    '<p><strong>Offer:</strong> ' + escapeHtml_(submission.offerDetails) + '</p>' +
    '<p><strong>Agreement ID:</strong> ' + escapeHtml_(agreementId) + '</p>' +
    '<p><strong>Status:</strong> ' + escapeHtml_(status) + '</p>' +
    '<p><strong>Verification:</strong> Email ' +
    escapeHtml_(submission.emailVerificationStatus ? 'Verified' : 'Not Verified') +
    ' | Phone ' +
    escapeHtml_(submission.phoneVerificationStatus ? 'Verified' : 'Not Verified') +
    '</p>' +
    '<p><strong>Fraud Flags:</strong> ' + escapeHtml_(fraudFlags.join(' | ')) + '</p>' +
    '<p><a href="' + escapeHtml_(pdfUrl) + '">View Agreement PDF</a></p>' +
    '<p><a href="' + escapeHtml_(approveUrl) + '">Approve</a> | ' +
    '<a href="' + escapeHtml_(rejectUrl) + '">Reject</a> | ' +
    '<a href="' + escapeHtml_(requestInfoUrl) + '">Request More Information</a></p>' +
    '</div>';

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: 'PERX Submission Pending Review: ' + submission.businessName,
    htmlBody: htmlBody,
    body:
      'New business submitted\n\n' +
      'Business: ' + submission.businessName + '\n' +
      'Owner: ' + submission.ownerName + '\n' +
      'Email: ' + submission.businessEmail + '\n' +
      'Phone: ' + submission.businessPhone + '\n' +
      'Offer: ' + submission.offerDetails + '\n' +
      'Agreement ID: ' + agreementId + '\n' +
      'Status: ' + status + '\n' +
      'Verification: Email ' + (submission.emailVerificationStatus ? 'Verified' : 'Not Verified') +
      ' | Phone ' + (submission.phoneVerificationStatus ? 'Verified' : 'Not Verified') + '\n' +
      'Fraud Flags: ' + fraudFlags.join(' | ') + '\n' +
      'PDF: ' + pdfUrl + '\n\n' +
      'Approve: ' + approveUrl + '\n' +
      'Reject: ' + rejectUrl + '\n' +
      'Request More Info: ' + requestInfoUrl,
    name: EMAIL_FROM_NAME
  });
}

function sendAdminDecisionEmail_(toEmail, businessName, agreementId, status, offer, notes) {
  if (!toEmail) {
    return;
  }

  const subject = 'PERX Application Update: ' + status;
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10233f;">' +
    '<h2 style="margin:0 0 12px;">PERX Application Update</h2>' +
    '<p>Business: ' + escapeHtml_(businessName) + '</p>' +
    '<p>Agreement ID: ' + escapeHtml_(agreementId) + '</p>' +
    '<p>Status: <strong>' + escapeHtml_(status) + '</strong></p>' +
    '<p>Offer: ' + escapeHtml_(offer) + '</p>' +
    '<p>Notes: ' + escapeHtml_(notes || 'N/A') + '</p>' +
    '<p>For support, email ' + escapeHtml_(SUPPORT_EMAIL) + '.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody,
    body:
      'PERX Application Update\n\n' +
      'Business: ' + businessName + '\n' +
      'Agreement ID: ' + agreementId + '\n' +
      'Status: ' + status + '\n' +
      'Offer: ' + offer + '\n' +
      'Notes: ' + (notes || 'N/A') + '\n\n' +
      'Support: ' + SUPPORT_EMAIL,
    name: EMAIL_FROM_NAME
  });
}

function sendEmailCode_(toEmail, displayName, code) {
  const subject = 'Your PERX verification code';
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10233f;">' +
    '<p>Hi ' + escapeHtml_(displayName || 'there') + ',</p>' +
    '<p>Your PERX email verification code is:</p>' +
    '<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:8px 0;">' + escapeHtml_(code) + '</p>' +
    '<p>This code expires in ' + VERIFICATION_TTL_MINUTES + ' minutes.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody,
    body: 'Your PERX verification code is ' + code + '. It expires in ' + VERIFICATION_TTL_MINUTES + ' minutes.',
    name: EMAIL_FROM_NAME
  });
}

function sendSmsCodeFallback_(phoneNumber, code) {
  // Placeholder for SMS provider integration (Twilio/Vonage/etc.).
  // The code is logged to audit for operational traceability until provider is integrated.
  logAudit_('SMS_CODE_ISSUED', {
    phone: phoneNumber,
    codePreview: maskCode_(code)
  });
}

function getOrCreateSubmissionSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SUBMISSIONS_SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SUBMISSIONS_SHEET_NAME);
  }

  const headers = [[
    'agreementId',
    'createdAt',
    'agreementVersion',
    'verificationSessionId',
    'pendingStatus',
    'businessName',
    'businessAddress',
    'city',
    'businessPhone',
    'businessEmail',
    'website',
    'state',
    'zipCode',
    'businessCategory',
    'offerDetails',
    'ownerName',
    'jobTitle',
    'notes',
    'signatureName',
    'signatureDate',
    'drawnSignaturePresent',
    'drawnSignature',
    'submittedAtClient',
    'ipAddress',
    'browser',
    'operatingSystem',
    'deviceInfo',
    'userAgent',
    'approxLocation',
    'emailVerificationStatus',
    'phoneVerificationStatus',
    'emailDomainStatus',
    'publicBusinessMatchStatus',
    'fraudFlags',
    'pdfUrl',
    'approvalStatus',
    'approvalDate',
    'adminNotes',
    'ownershipVerified',
    'updatedAt',
    'internalTags'
  ]];

  const expectedColumns = headers[0].length;
  ensureHeaders_(sheet, headers, expectedColumns);
  return sheet;
}

function getOrCreateVerificationSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(VERIFICATIONS_SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(VERIFICATIONS_SHEET_NAME);
  }

  const headers = [[
    'sessionId',
    'createdAt',
    'expiresAt',
    'businessName',
    'businessEmail',
    'businessPhone',
    'website',
    'ownerName',
    'emailCodeMasked',
    'phoneCodeMasked',
    'emailCodeHash',
    'phoneCodeHash',
    'emailVerified',
    'phoneVerified',
    'emailVerifiedAt',
    'phoneVerifiedAt',
    'verificationIp',
    'userAgent',
    'deviceInfo',
    'emailAttempts',
    'phoneAttempts',
    'lastVerificationIp'
  ]];

  const expectedColumns = headers[0].length;
  ensureHeaders_(sheet, headers, expectedColumns);
  return sheet;
}

function getOrCreateAuditSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(AUDIT_SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(AUDIT_SHEET_NAME);
  }

  const headers = [['timestamp', 'eventType', 'detailsJson']];
  ensureHeaders_(sheet, headers, 3);
  return sheet;
}

function ensureHeaders_(sheet, headers, expectedColumns) {
  if (sheet.getMaxColumns() < expectedColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), expectedColumns - sheet.getMaxColumns());
  }

  if (sheet.getMaxColumns() > expectedColumns) {
    sheet.deleteColumns(expectedColumns + 1, sheet.getMaxColumns() - expectedColumns);
  }

  sheet.getRange(1, 1, 1, expectedColumns).setValues(headers);
}

function findVerificationSessionRow_(sessionId) {
  const sheet = getOrCreateVerificationSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0] || '') === sessionId) {
      return { sheet: sheet, row: index + 2 };
    }
  }

  return null;
}

function findSubmissionByAgreementId_(agreementId) {
  const sheet = getOrCreateSubmissionSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0] || '') === agreementId) {
      return { sheet: sheet, row: index + 2 };
    }
  }

  return null;
}

function nextAgreementId_() {
  const spreadsheet = getSpreadsheet_();
  let settings = spreadsheet.getSheetByName(SETTINGS_SHEET_NAME);

  if (!settings) {
    settings = spreadsheet.insertSheet(SETTINGS_SHEET_NAME);
    settings.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
    settings.getRange(2, 1, 1, 2).setValues([['agreementSequence', String(AGREEMENT_START_SEQUENCE - 1)]]);
  }

  const rows = Math.max(settings.getLastRow() - 1, 0);
  let rowIndex = 0;

  if (rows > 0) {
    const values = settings.getRange(2, 1, rows, 2).getValues();
    for (let index = 0; index < values.length; index += 1) {
      if (String(values[index][0]) === 'agreementSequence') {
        rowIndex = index + 2;
        break;
      }
    }
  }

  if (!rowIndex) {
    rowIndex = settings.getLastRow() + 1;
    settings.getRange(rowIndex, 1, 1, 2).setValues([['agreementSequence', String(AGREEMENT_START_SEQUENCE - 1)]]);
  }

  const current = Number(settings.getRange(rowIndex, 2).getValue() || AGREEMENT_START_SEQUENCE - 1);
  const next = current + 1;
  settings.getRange(rowIndex, 2).setValue(String(next));

  return AGREEMENT_PREFIX + padNumber_(next, 6);
}

function passesRateLimit_(ipAddress) {
  const ip = cleanText_(ipAddress);
  if (!ip) {
    return true;
  }

  const sheet = getOrCreateAuditSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return true;
  }

  const startRow = Math.max(2, lastRow - 200);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, 3).getValues();

  const cutoffMs = Date.now() - SUBMISSION_RATE_WINDOW_MS;
  let count = 0;

  values.forEach(function (row) {
    const timestamp = parseDate_(row[0]);
    if (!timestamp || timestamp.getTime() < cutoffMs) {
      return;
    }

    const details = safeJsonParse_(row[2]);
    if (details && cleanText_(details.ipAddress || details.ip) === ip) {
      count += 1;
    }
  });

  return count < SUBMISSION_RATE_LIMIT;
}

function buildAdminActionUrl_(action, agreementId, businessName) {
  const base = ScriptApp.getService().getUrl();
  return base +
    '?action=' + encodeURIComponent(action) +
    '&agreementId=' + encodeURIComponent(agreementId) +
    '&businessName=' + encodeURIComponent(cleanText_(businessName));
}

function buildAdminResultPage_(result, status) {
  const ok = !!(result && result.ok);
  const color = ok ? '#0f8a4b' : '#be2b2b';
  const title = ok ? 'PERX Admin Action Completed' : 'PERX Admin Action Failed';
  const message = escapeHtml_((result && result.message) || 'Unable to process request.');
  const agreementId = escapeHtml_((result && result.agreementId) || 'N/A');

  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font-family:Arial,sans-serif;background:linear-gradient(180deg,#f6f9ff,#eef3ff);color:#10233f;}' +
    '.card{max-width:620px;width:100%;background:#fff;border:1px solid rgba(16,35,63,.12);border-radius:16px;padding:24px;box-shadow:0 20px 50px rgba(16,35,63,.12);}' +
    '.badge{display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(15,111,255,.08);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d63d3;}' +
    'h1{margin:12px 0 10px;font-size:28px;line-height:1.1;}' +
    'p{margin:8px 0;line-height:1.55;color:#27446d;}' +
    '.status{font-weight:700;color:' + color + ';}' +
    '</style></head><body><main class="card"><span class="badge">PERX Admin</span>' +
    '<h1>' + title + '</h1>' +
    '<p><strong>Agreement ID:</strong> ' + agreementId + '</p>' +
    '<p><strong>Requested Status:</strong> ' + escapeHtml_(status) + '</p>' +
    '<p class="status">' + message + '</p>' +
    '</main></body></html>'
  );
}

function logAudit_(eventType, details) {
  const sheet = getOrCreateAuditSheet_();
  sheet.appendRow([
    formatIso_(new Date()),
    cleanText_(eventType),
    JSON.stringify(details || {})
  ]);
}

function simulateBusinessMatch_(submission) {
  const hasFields = !!(submission.businessName && submission.businessAddress && submission.businessPhone);
  if (!hasFields) {
    return 'Insufficient Data';
  }

  if (submission.website && submission.emailDomainStatus === 'MATCHED_DOMAIN') {
    return 'Likely Match';
  }

  return 'Manual Review Required';
}

function websiteLooksValid_(website) {
  if (!website) {
    return false;
  }

  try {
    const normalized = /^https?:\/\//i.test(website) ? website : 'https://' + website;
    const response = UrlFetchApp.fetch(normalized, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true
    });

    const code = Number(response.getResponseCode() || 0);
    return code >= 200 && code < 500;
  } catch (error) {
    return false;
  }
}

function likelyBusinessName_(name) {
  const value = cleanText_(name);
  if (!value) {
    return false;
  }

  return value.length >= 3 && /[a-zA-Z]/.test(value);
}

function isHighRiskLocation_(approxLocation) {
  const value = cleanText_(approxLocation).toLowerCase();
  if (!value) {
    return false;
  }

  const riskyWords = ['tor', 'anonymous', 'unknown', 'datacenter'];
  for (let index = 0; index < riskyWords.length; index += 1) {
    if (value.indexOf(riskyWords[index]) !== -1) {
      return true;
    }
  }

  return false;
}

function buildDevHint_() {
  return '[If SMS provider is not connected yet, use admin-managed fallback verification.]';
}

function createSessionId_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function generateSixDigitCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCode_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return digest
    .map(function (byte) {
      const v = (byte + 256) % 256;
      const hex = v.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    })
    .join('');
}

function safeEquals_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return diff === 0;
}

function maskCode_(code) {
  const value = String(code || '');
  if (value.length < 6) {
    return '***';
  }
  return value.slice(0, 2) + '****';
}

function getSpreadsheet_() {
  const id = extractSpreadsheetId_(SPREADSHEET_ID);
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function extractSpreadsheetId_(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }

  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) {
    return raw;
  }

  return '';
}

function cleanText_(value) {
  return String(value || '').trim();
}

function normalizeEmail_(email) {
  return cleanText_(email).toLowerCase();
}

function cleanPhone_(value) {
  return String(value || '').replace(/[^0-9+]/g, '').slice(0, 18);
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function parseDate_(value) {
  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatIso_(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return date.toISOString();
}

function padNumber_(value, size) {
  let output = String(Math.max(0, Number(value || 0)));
  while (output.length < size) {
    output = '0' + output;
  }
  return output;
}

function yesNo_(value) {
  return value ? 'Yes' : 'No';
}

function safeJsonParse_(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function jsonResponse_(payload) {
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function jsonpResponse_(callback, payload) {
  const safeCallback = String(callback || '').replace(/[^a-zA-Z0-9_$.]/g, '');
  const output = ContentService.createTextOutput(safeCallback + '(' + JSON.stringify(payload) + ');');
  output.setMimeType(ContentService.MimeType.JAVASCRIPT);
  return output;
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
