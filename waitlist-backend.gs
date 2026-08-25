const SPREADSHEET_ID = '19M0jKEKPFIeIeI5NIVIryoYY-cfuCF0CgqXEAfgrlrs';
const SUBMISSIONS_SHEET_NAME = 'PERX Submissions';
const SIMPLE_RESULTS_SHEET_NAME = 'PERX';
const LEGACY_SIMPLE_RESULTS_SHEET_NAME = 'PERX Simple Results';
const AUDIT_SHEET_NAME = 'PERX Audit Log';
const SETTINGS_SHEET_NAME = 'PERX Settings';
const PILOT_ADMIN_SHEET_NAME = 'PERX Pilot Admin';

const ADMIN_EMAIL = 'chasemallor@gmail.com';
const SUPPORT_EMAIL = 'support@joinperx.com';
const EMAIL_FROM_NAME = 'PERX';
const JOIN_BASE_URL = 'https://joinperx.com/';

const PILOT_ID_PREFIX = 'PERX-PILOT-';
const PILOT_SEQUENCE_START = 1;
const PILOT_STORE_KEY = 'PERX_PILOT_STORE_V1';
const PILOT_SEQUENCE_KEY = 'PERX_PILOT_SEQUENCE';
const PILOT_RATE_KEY = 'PERX_PILOT_RATE_V1';

const VERIFICATION_TTL_MINUTES = 60 * 24;
const RESEND_TTL_SECONDS = 60;
const MAX_RESENDS_PER_DAY = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 8;

const ACTIONS = {
  SUBMIT_PILOT_SIGNUP: 'submitPilotSignup',
  RESEND_VERIFICATION_EMAIL: 'resendVerificationEmail',
  UPDATE_SUBMISSION_EMAIL: 'updateSubmissionEmail',
  VERIFY_EMAIL_TOKEN: 'verifyEmailToken',
  GET_ADMIN_COUNTS: 'getPilotAdminCounts',
  ADMIN_APPROVE_LIVE: 'adminApproveLive',
  ADMIN_PAUSE: 'adminPause',
  ADMIN_ARCHIVE: 'adminArchive',

  // Legacy actions retained for compatibility with historical frontend URLs.
  START_VERIFICATION: 'startVerification',
  VERIFY_CODE: 'verifyCode',
  SUBMIT_AGREEMENT: 'submitAgreement',
  ADMIN_APPROVE: 'adminApprove',
  ADMIN_REJECT: 'adminReject',
  ADMIN_REQUEST_INFO: 'adminRequestInfo'
};

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = cleanText_(params.action);
  const callback = cleanText_(params.callback);

  try {
    const result = routeAction_(action, params, true);
    if (callback) {
      return jsonpResponse_(callback, result);
    }
    return jsonResponse_(result);
  } catch (error) {
    tryLogAudit_('SERVER_ERROR', {
      action: action || 'GET',
      message: getErrorMessage_(error)
    });

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
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = cleanText_(payload.action);
    return jsonResponse_(routeAction_(action, payload, false));
  } catch (error) {
    tryLogAudit_('SERVER_ERROR', {
      action: 'POST',
      message: getErrorMessage_(error)
    });

    return jsonResponse_({
      ok: false,
      message: 'Invalid request payload.',
      errorCode: 'BAD_REQUEST'
    });
  }
}

function routeAction_(action, payload, isGet) {
  switch (action) {
    case ACTIONS.SUBMIT_PILOT_SIGNUP:
      return submitPilotSignup_(payload);
    case ACTIONS.RESEND_VERIFICATION_EMAIL:
      return resendVerificationEmail_(payload);
    case ACTIONS.UPDATE_SUBMISSION_EMAIL:
      return updateSubmissionEmail_(payload);
    case ACTIONS.VERIFY_EMAIL_TOKEN:
      return verifyEmailToken_(payload);
    case ACTIONS.GET_ADMIN_COUNTS:
      return getPilotAdminCounts_();
    case ACTIONS.ADMIN_APPROVE_LIVE:
      return adminStatusUpdate_(payload, 'LIVE', isGet);
    case ACTIONS.ADMIN_PAUSE:
      return adminStatusUpdate_(payload, 'PAUSED', isGet);
    case ACTIONS.ADMIN_ARCHIVE:
      return adminStatusUpdate_(payload, 'ARCHIVED', isGet);

    // Legacy behavior: redirect to simple pilot messaging instead of hard failure.
    case ACTIONS.START_VERIFICATION:
    case ACTIONS.VERIFY_CODE:
    case ACTIONS.SUBMIT_AGREEMENT:
    case ACTIONS.ADMIN_APPROVE:
    case ACTIONS.ADMIN_REJECT:
    case ACTIONS.ADMIN_REQUEST_INFO:
      return {
        ok: false,
        message: 'This onboarding endpoint is retired. Please use the Join PERX pilot form.',
        errorCode: 'LEGACY_FLOW_RETIRED'
      };

    default:
      return { ok: false, message: 'Unsupported action.', errorCode: 'UNSUPPORTED_ACTION' };
  }
}

function submitPilotSignup_(payload) {
  const submission = normalizePilotSubmission_(payload);
  const validationMessage = validatePilotSubmission_(submission);
  if (validationMessage) {
    return { ok: false, message: validationMessage, errorCode: 'VALIDATION_ERROR' };
  }

  if (!passesRateLimit_(submission.ipAddress, submission.email)) {
    return {
      ok: false,
      message: 'Too many attempts. Please wait a few minutes and try again.',
      errorCode: 'RATE_LIMITED'
    };
  }

  const duplicateCheck = detectDuplicatePilotSubmission_(submission);
  if (duplicateCheck.duplicate) {
    return {
      ok: false,
      message: duplicateCheck.message,
      errorCode: 'DUPLICATE_SUBMISSION'
    };
  }

  const now = new Date();
  const submissionId = nextPilotSubmissionId_();
  const tokenData = buildVerificationToken_();

  const row = buildPilotSubmissionRow_(submission, {
    submissionId: submissionId,
    now: now,
    tokenHash: tokenData.hash,
    tokenExpiresAt: tokenData.expiresAt,
    resendCount: 0,
    lastResendAt: '',
    verifiedAt: '',
    status: 'UNVERIFIED'
  });

  appendSubmissionObject_(row);

  let emailSent = true;
  let message = 'Check your email to confirm your business signup.';
  try {
    sendPilotVerificationEmail_(row, tokenData.rawToken);
  } catch (error) {
    emailSent = false;
    message = "We couldn't send the verification email. Please try again.";
    tryLogAudit_('VERIFICATION_EMAIL_SEND_FAILED', {
      submissionId: submissionId,
      message: getErrorMessage_(error)
    });
  }

  appendSimpleResultRow_(row);
  refreshPilotAdminSheet_();

  tryLogAudit_('PILOT_SIGNUP_SUBMITTED', {
    submissionId: submissionId,
    businessName: submission.businessName,
    email: submission.email,
    emailSent: emailSent
  });

  return {
    ok: true,
    message: message,
    submissionId: submissionId,
    emailSent: emailSent,
    status: 'UNVERIFIED'
  };
}

function resendVerificationEmail_(payload) {
  const submissionId = cleanText_(payload.submissionId);
  const email = normalizeEmail_(payload.email);
  if (!submissionId) {
    return { ok: false, message: 'Submission ID is required.', errorCode: 'VALIDATION_ERROR' };
  }

  const found = findPilotSubmissionRow_(submissionId);
  if (!found) {
    return { ok: false, message: 'Submission not found.', errorCode: 'NOT_FOUND' };
  }

  const row = found.object;
  if (email && normalizeEmail_(row.email) !== email) {
    return { ok: false, message: 'Submission not found for this email.', errorCode: 'NOT_FOUND' };
  }

  if (asBoolean_(row.emailVerified)) {
    return {
      ok: true,
      message: "You're already verified. Your business is pending review.",
      submissionId: submissionId,
      alreadyVerified: true
    };
  }

  const resendCount = Number(row.resendCount || 0);
  const lastResendAt = parseDate_(row.lastResendAt);
  const now = new Date();

  if (resendCount >= MAX_RESENDS_PER_DAY) {
    return {
      ok: false,
      message: 'Too many resend requests. Please try again later.',
      errorCode: 'RESEND_RATE_LIMITED'
    };
  }

  if (lastResendAt && now.getTime() - lastResendAt.getTime() < RESEND_TTL_SECONDS * 1000) {
    return {
      ok: false,
      message: 'Please wait a moment before resending.',
      errorCode: 'RESEND_RATE_LIMITED'
    };
  }

  const tokenData = buildVerificationToken_();
  updateSubmissionFields_(found, {
    verificationTokenHash: tokenData.hash,
    verificationTokenExpiresAt: formatIso_(tokenData.expiresAt),
    verificationTokenUsedAt: '',
    resendCount: String(resendCount + 1),
    lastResendAt: formatIso_(now),
    latestVerificationRequestAt: formatIso_(now),
    updatedAtPilot: formatIso_(now)
  });

  try {
    sendPilotVerificationEmail_(found.object, tokenData.rawToken);
  } catch (error) {
    tryLogAudit_('VERIFICATION_EMAIL_RESEND_FAILED', {
      submissionId: submissionId,
      message: getErrorMessage_(error)
    });
    return { ok: false, message: "We couldn't send the verification email. Please try again.", errorCode: 'EMAIL_FAILED' };
  }

  tryLogAudit_('PILOT_VERIFICATION_RESENT', {
    submissionId: submissionId,
    email: row.email
  });

  return {
    ok: true,
    message: 'Verification email sent.',
    submissionId: submissionId
  };
}

function updateSubmissionEmail_(payload) {
  const submissionId = cleanText_(payload.submissionId);
  const oldEmail = normalizeEmail_(payload.oldEmail);
  const newEmail = normalizeEmail_(payload.newEmail);

  if (!submissionId || !oldEmail || !newEmail || !isValidEmail_(newEmail)) {
    return { ok: false, message: 'A valid updated email is required.', errorCode: 'VALIDATION_ERROR' };
  }

  const found = findPilotSubmissionRow_(submissionId);
  if (!found) {
    return { ok: false, message: 'Submission not found.', errorCode: 'NOT_FOUND' };
  }

  const row = found.object;
  if (normalizeEmail_(row.email) !== oldEmail) {
    return { ok: false, message: 'Submission not found for this email.', errorCode: 'NOT_FOUND' };
  }

  if (asBoolean_(row.emailVerified)) {
    return {
      ok: false,
      message: 'This submission is already verified and cannot change email here.',
      errorCode: 'ALREADY_VERIFIED'
    };
  }

  const tokenData = buildVerificationToken_();
  const now = new Date();

  updateSubmissionFields_(found, {
    email: newEmail,
    businessEmail: newEmail,
    verificationTokenHash: tokenData.hash,
    verificationTokenExpiresAt: formatIso_(tokenData.expiresAt),
    verificationTokenUsedAt: '',
    latestVerificationRequestAt: formatIso_(now),
    updatedAtPilot: formatIso_(now)
  });

  const refreshed = findPilotSubmissionRow_(submissionId);
  try {
    sendPilotVerificationEmail_(refreshed.object, tokenData.rawToken);
  } catch (error) {
    tryLogAudit_('VERIFICATION_EMAIL_SEND_FAILED_AFTER_EMAIL_UPDATE', {
      submissionId: submissionId,
      message: getErrorMessage_(error)
    });
    return { ok: false, message: "We couldn't send the verification email. Please try again.", errorCode: 'EMAIL_FAILED' };
  }

  appendSimpleResultRow_(refreshed.object);
  refreshPilotAdminSheet_();

  tryLogAudit_('PILOT_EMAIL_UPDATED', {
    submissionId: submissionId,
    oldEmail: oldEmail,
    newEmail: newEmail
  });

  return {
    ok: true,
    message: 'Email updated and verification sent.',
    submissionId: submissionId
  };
}

function verifyEmailToken_(payload) {
  const submissionId = cleanText_(payload.submissionId);
  const token = cleanText_(payload.token);

  if (!submissionId || !token) {
    return { ok: false, message: 'Invalid verification link.', errorCode: 'INVALID_LINK' };
  }

  const found = findPilotSubmissionRow_(submissionId);
  if (!found) {
    return { ok: false, message: 'Submission not found.', errorCode: 'NOT_FOUND' };
  }

  const row = found.object;
  const now = new Date();

  if (asBoolean_(row.emailVerified)) {
    return {
      ok: true,
      message: 'Your email has already been verified.',
      alreadyVerified: true,
      businessName: row.businessName,
      perxOffer: row.perxOffer || row.offerDetails,
      restrictions: row.restrictions || row.offerRestrictions,
      status: row.pilotStatus || 'PENDING'
    };
  }

  const expiresAt = parseDate_(row.verificationTokenExpiresAt);
  if (!expiresAt || expiresAt.getTime() < now.getTime()) {
    return {
      ok: false,
      message: 'This verification link has expired.',
      errorCode: 'TOKEN_EXPIRED',
      submissionId: submissionId,
      email: normalizeEmail_(row.email || row.businessEmail)
    };
  }

  const usedAt = parseDate_(row.verificationTokenUsedAt);
  if (usedAt) {
    return {
      ok: true,
      message: 'Your email has already been verified.',
      alreadyVerified: true,
      businessName: row.businessName,
      perxOffer: row.perxOffer || row.offerDetails,
      restrictions: row.restrictions || row.offerRestrictions,
      status: row.pilotStatus || 'PENDING'
    };
  }

  const tokenHash = hashText_(token);
  if (!safeEquals_(tokenHash, cleanText_(row.verificationTokenHash))) {
    return {
      ok: false,
      message: 'This verification link is invalid.',
      errorCode: 'INVALID_TOKEN'
    };
  }

  updateSubmissionFields_(found, {
    emailVerified: 'true',
    emailVerificationStatus: 'Confirmed',
    emailVerifiedAt: formatIso_(now),
    verificationTokenUsedAt: formatIso_(now),
    pilotStatus: 'PENDING',
    pendingStatus: 'Pending Review',
    approvalStatus: 'Pending Review',
    updatedAtPilot: formatIso_(now),
    submittedAtPilot: cleanText_(row.submittedAtPilot) || formatIso_(now)
  });

  const refreshed = findPilotSubmissionRow_(submissionId).object;

  try {
    sendAdminPilotReviewEmail_(refreshed);
  } catch (error) {
    tryLogAudit_('ADMIN_REVIEW_NOTIFICATION_FAILED', {
      submissionId: submissionId,
      message: getErrorMessage_(error)
    });
  }

  appendSimpleResultRow_(refreshed);
  refreshPilotAdminSheet_();

  tryLogAudit_('PILOT_EMAIL_VERIFIED', {
    submissionId: submissionId,
    businessName: refreshed.businessName,
    email: refreshed.email
  });

  return {
    ok: true,
    message: 'Verification successful.',
    businessName: refreshed.businessName,
    perxOffer: refreshed.perxOffer || refreshed.offerDetails,
    restrictions: refreshed.restrictions || refreshed.offerRestrictions,
    status: 'PENDING'
  };
}

function adminStatusUpdate_(payload, targetStatus, isGet) {
  const submissionId = cleanText_(payload.submissionId || payload.sid);
  if (!submissionId) {
    return buildAdminResult_(false, 'Submission ID is required.', targetStatus, submissionId, isGet);
  }

  if (!validateAdminSignature_(payload, targetStatus)) {
    return buildAdminResult_(false, 'Unauthorized admin action.', targetStatus, submissionId, isGet);
  }

  const found = findPilotSubmissionRow_(submissionId);
  if (!found) {
    return buildAdminResult_(false, 'Submission not found.', targetStatus, submissionId, isGet);
  }

  const row = found.object;
  if (!asBoolean_(row.emailVerified)) {
    return buildAdminResult_(false, 'Cannot change status before email verification.', targetStatus, submissionId, isGet);
  }

  const now = new Date();
  const updatePayload = {
    pilotStatus: targetStatus,
    status: targetStatus,
    approvalStatus: targetStatus,
    updatedAtPilot: formatIso_(now)
  };

  if (targetStatus === 'LIVE') {
    updatePayload.approvedAt = formatIso_(now);
    updatePayload.pausedAt = '';
  }
  if (targetStatus === 'PAUSED') {
    updatePayload.pausedAt = formatIso_(now);
  }
  if (targetStatus === 'ARCHIVED') {
    updatePayload.archivedAt = formatIso_(now);
  }

  updateSubmissionFields_(found, updatePayload);
  const refreshed = findPilotSubmissionRow_(submissionId).object;

  appendSimpleResultRow_(refreshed);
  refreshPilotAdminSheet_();

  tryLogAudit_('PILOT_ADMIN_STATUS_UPDATED', {
    submissionId: submissionId,
    targetStatus: targetStatus
  });

  try {
    sendAdminDecisionEmail_(refreshed, targetStatus);
  } catch (error) {
    tryLogAudit_('PILOT_ADMIN_DECISION_EMAIL_FAILED', {
      submissionId: submissionId,
      message: getErrorMessage_(error)
    });
  }

  return buildAdminResult_(true, 'Status updated successfully.', targetStatus, submissionId, isGet);
}

function buildAdminResult_(ok, message, targetStatus, submissionId, isGet) {
  const payload = {
    ok: ok,
    message: message,
    status: targetStatus,
    submissionId: submissionId
  };

  if (!isGet) {
    return payload;
  }

  return {
    ok: ok,
    message:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>PERX Admin Result</title><style>' +
      'body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;padding:20px;color:#0f2540;}'+
      '.card{max-width:620px;margin:40px auto;background:#fff;border:1px solid #d7e2f0;border-radius:14px;padding:20px;}'+
      'h1{margin:0 0 10px;} p{line-height:1.5;} .ok{color:#17784a;} .err{color:#b63030;}' +
      '</style></head><body><main class="card"><h1>PERX Admin</h1>' +
      '<p><strong>Submission ID:</strong> ' + escapeHtml_(submissionId) + '</p>' +
      '<p><strong>Requested Status:</strong> ' + escapeHtml_(targetStatus) + '</p>' +
      '<p class="' + (ok ? 'ok' : 'err') + '">' + escapeHtml_(message) + '</p>' +
      '</main></body></html>',
    html: true
  };
}

function getPilotAdminCounts_() {
  const rows = listPilotRows_();
  const counts = summarizePilotCounts_(rows);
  return {
    ok: true,
    signedOn: counts.signedOn,
    live: counts.live,
    pending: counts.pending,
    unverified: counts.unverified
  };
}

function normalizePilotSubmission_(payload) {
  return {
    submissionId: '',
    businessName: cleanText_(payload.businessName),
    businessAddress: cleanText_(payload.businessAddress),
    contactName: cleanText_(payload.contactName),
    contactRole: cleanText_(payload.contactRole),
    phone: cleanPhone_(payload.phone),
    email: normalizeEmail_(payload.email),
    perxOffer: cleanText_(payload.perxOffer),
    restrictions: cleanText_(payload.restrictions),
    authorizationConfirmed: asBoolean_(payload.authorizationConfirmed),
    ipAddress: cleanText_(payload.ipAddress),
    userAgent: cleanText_(payload.userAgent),
    source: cleanText_(payload.source) || 'joinperx.com'
  };
}

function validatePilotSubmission_(submission) {
  if (!submission.businessName || !submission.businessAddress || !submission.contactName) {
    return 'Business name, address, and your name are required.';
  }

  if (!submission.contactRole) {
    return 'Your role is required.';
  }

  if (!submission.phone || submission.phone.replace(/\D/g, '').length < 10) {
    return 'A valid phone number is required.';
  }

  if (!isValidEmail_(submission.email)) {
    return 'A valid email is required.';
  }

  if (!submission.perxOffer) {
    return 'Please enter your PERX offer.';
  }

  if (!submission.authorizationConfirmed) {
    return 'Authorization confirmation is required.';
  }

  return '';
}

function detectDuplicatePilotSubmission_(submission) {
  const rows = listPilotRows_();
  const nowMs = Date.now();

  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    var sameBusiness = cleanText_(row.businessName).toLowerCase() === submission.businessName.toLowerCase();
    var sameEmail = normalizeEmail_(row.email || row.businessEmail) === submission.email;

    if (!sameBusiness && !sameEmail) {
      continue;
    }

    var status = cleanText_(row.pilotStatus || row.status || row.approvalStatus);
    var isVerified = asBoolean_(row.emailVerified) || cleanText_(row.emailVerificationStatus).toLowerCase() === 'confirmed';

    if (isVerified && (status === 'PENDING' || status === 'LIVE' || status === 'PAUSED')) {
      return {
        duplicate: true,
        message: 'A submission for this business/email already exists. Contact PERX if you need help.'
      };
    }

    var created = parseDate_(row.submittedAtPilot || row.createdAt);
    if (created && nowMs - created.getTime() < 2 * 60 * 60 * 1000) {
      return {
        duplicate: true,
        message: 'A recent submission already exists. Check your email or resend verification.'
      };
    }
  }

  return { duplicate: false, message: '' };
}

function buildPilotSubmissionRow_(submission, context) {
  const nowIso = formatIso_(context.now);
  return {
    agreementId: context.submissionId,
    createdAt: nowIso,
    businessName: submission.businessName,
    businessAddress: submission.businessAddress,
    businessPhone: submission.phone,
    businessEmail: submission.email,
    ownerName: submission.contactName,
    signerRole: submission.contactRole,
    offerDetails: submission.perxOffer,
    offerRestrictions: submission.restrictions,
    notes: '',
    pendingStatus: 'Email Verification Pending',
    approvalStatus: 'Email Verification Pending',
    emailVerificationStatus: 'Pending',

    submissionId: context.submissionId,
    contactName: submission.contactName,
    contactRole: submission.contactRole,
    phone: submission.phone,
    email: submission.email,
    perxOffer: submission.perxOffer,
    restrictions: submission.restrictions,
    emailVerified: 'false',
    emailVerifiedAt: context.verifiedAt,
    submittedAtPilot: nowIso,
    pilotStatus: context.status,
    approvedAt: '',
    pausedAt: '',
    archivedAt: '',
    internalNotes: '',
    verificationTokenHash: context.tokenHash,
    verificationTokenExpiresAt: formatIso_(context.tokenExpiresAt),
    verificationTokenUsedAt: '',
    resendCount: String(context.resendCount || 0),
    lastResendAt: context.lastResendAt,
    latestVerificationRequestAt: nowIso,
    source: submission.source,
    updatedAtPilot: nowIso,
    status: context.status,
    signupType: 'PILOT_2026_SIMPLE',
    userAgent: submission.userAgent,
    ipAddress: submission.ipAddress
  };
}

function sendPilotVerificationEmail_(row, rawToken) {
  const toEmail = normalizeEmail_(row.email || row.businessEmail);
  const submissionId = cleanText_(row.submissionId || row.agreementId);
  const businessName = cleanText_(row.businessName);
  const verificationUrl = buildVerificationUrl_(submissionId, rawToken);

  const subject = 'Confirm your PERX business signup';
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10233f;">' +
    '<h2 style="margin:0 0 10px;">Confirm your business</h2>' +
    '<p>Thanks for joining the PERX pilot.</p>' +
    '<p>Confirm your email to submit <strong>' + escapeHtml_(businessName) + '</strong> for review.</p>' +
    '<p><a style="display:inline-block;padding:10px 16px;border-radius:999px;background:#0d5bd6;color:#fff;text-decoration:none;font-weight:700;" href="' +
    escapeHtml_(verificationUrl) +
    '">Confirm Business</a></p>' +
    '<p style="font-size:12px;color:#5b718a;">You did not create a PERX business submission? You can ignore this email.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody,
    body:
      'Confirm your business\n\n' +
      'Thanks for joining the PERX pilot.\n\n' +
      'Confirm your email to submit ' + businessName + ' for review:\n' + verificationUrl + '\n\n' +
      'You did not create a PERX business submission? You can ignore this email.',
    name: EMAIL_FROM_NAME
  });
}

function sendAdminPilotReviewEmail_(row) {
  if (!ADMIN_EMAIL) {
    return;
  }

  const submissionId = cleanText_(row.submissionId || row.agreementId);
  const approveUrl = buildAdminActionUrl_(ACTIONS.ADMIN_APPROVE_LIVE, submissionId);
  const pauseUrl = buildAdminActionUrl_(ACTIONS.ADMIN_PAUSE, submissionId);
  const archiveUrl = buildAdminActionUrl_(ACTIONS.ADMIN_ARCHIVE, submissionId);

  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10233f;">' +
    '<h2 style="margin:0 0 12px;">PERX business pending review</h2>' +
    '<p><strong>Business:</strong> ' + escapeHtml_(row.businessName) + '</p>' +
    '<p><strong>Address:</strong> ' + escapeHtml_(row.businessAddress) + '</p>' +
    '<p><strong>Contact:</strong> ' + escapeHtml_(row.contactName || row.ownerName) + ' (' + escapeHtml_(row.contactRole || row.signerRole) + ')</p>' +
    '<p><strong>Phone:</strong> ' + escapeHtml_(row.phone || row.businessPhone) + '</p>' +
    '<p><strong>Email:</strong> ' + escapeHtml_(row.email || row.businessEmail) + '</p>' +
    '<p><strong>Email verified:</strong> Yes</p>' +
    '<p><strong>Submitted PERX:</strong> ' + escapeHtml_(row.perxOffer || row.offerDetails) + '</p>' +
    '<p><strong>Restrictions:</strong> ' + escapeHtml_(row.restrictions || row.offerRestrictions || 'None') + '</p>' +
    '<p><strong>Submission date:</strong> ' + escapeHtml_(cleanText_(row.submittedAtPilot || row.createdAt)) + '</p>' +
    '<p><strong>Verification date:</strong> ' + escapeHtml_(cleanText_(row.emailVerifiedAt)) + '</p>' +
    '<p><strong>Status:</strong> Pending Review</p>' +
    '<p><a href="' + escapeHtml_(approveUrl) + '">Approve & Make Live</a> | ' +
    '<a href="' + escapeHtml_(pauseUrl) + '">Pause</a> | ' +
    '<a href="' + escapeHtml_(archiveUrl) + '">Reject/Archive</a></p>' +
    '</div>';

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: 'PERX Pending Review: ' + row.businessName,
    htmlBody: htmlBody,
    body:
      'PERX business pending review\n\n' +
      'Business: ' + row.businessName + '\n' +
      'Address: ' + row.businessAddress + '\n' +
      'Contact: ' + (row.contactName || row.ownerName) + ' (' + (row.contactRole || row.signerRole) + ')\n' +
      'Phone: ' + (row.phone || row.businessPhone) + '\n' +
      'Email: ' + (row.email || row.businessEmail) + '\n' +
      'Email verified: Yes\n' +
      'Offer: ' + (row.perxOffer || row.offerDetails) + '\n' +
      'Restrictions: ' + (row.restrictions || row.offerRestrictions || 'None') + '\n' +
      'Submitted: ' + (row.submittedAtPilot || row.createdAt) + '\n' +
      'Verified: ' + row.emailVerifiedAt + '\n\n' +
      'Approve & Make Live: ' + approveUrl + '\n' +
      'Pause: ' + pauseUrl + '\n' +
      'Reject/Archive: ' + archiveUrl,
    name: EMAIL_FROM_NAME
  });
}

function sendAdminDecisionEmail_(row, status) {
  const toEmail = normalizeEmail_(row.email || row.businessEmail);
  if (!toEmail) {
    return;
  }

  const subject = 'PERX status update: ' + status;
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10233f;">' +
    '<h2 style="margin:0 0 12px;">PERX status update</h2>' +
    '<p><strong>' + escapeHtml_(row.businessName) + '</strong> is now: <strong>' + escapeHtml_(status) + '</strong></p>' +
    '<p>For questions, contact ' + escapeHtml_(SUPPORT_EMAIL) + '.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody,
    body:
      'PERX status update\n\n' +
      row.businessName + ' is now: ' + status + '\n\n' +
      'For questions, contact ' + SUPPORT_EMAIL + '.',
    name: EMAIL_FROM_NAME
  });
}

function buildVerificationUrl_(submissionId, rawToken) {
  return JOIN_BASE_URL + '?sid=' + encodeURIComponent(submissionId) + '&verify=' + encodeURIComponent(rawToken);
}

function buildAdminActionUrl_(action, submissionId) {
  const now = Date.now();
  const expiresAt = now + 3 * 24 * 60 * 60 * 1000;
  const sig = buildAdminSignature_(submissionId, actionToStatus_(action), expiresAt);
  const base = ScriptApp.getService().getUrl();

  return base +
    '?action=' + encodeURIComponent(action) +
    '&submissionId=' + encodeURIComponent(submissionId) +
    '&exp=' + encodeURIComponent(String(expiresAt)) +
    '&sig=' + encodeURIComponent(sig);
}

function actionToStatus_(action) {
  if (action === ACTIONS.ADMIN_APPROVE_LIVE) return 'LIVE';
  if (action === ACTIONS.ADMIN_PAUSE) return 'PAUSED';
  if (action === ACTIONS.ADMIN_ARCHIVE) return 'ARCHIVED';
  return '';
}

function buildVerificationToken_() {
  const rawToken = generateSecureToken_();
  const hash = hashText_(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MINUTES * 60 * 1000);
  return {
    rawToken: rawToken,
    hash: hash,
    expiresAt: expiresAt
  };
}

function generateSecureToken_() {
  const entropy =
    Utilities.getUuid() +
    Utilities.getUuid() +
    String(Date.now()) +
    String(Math.random()) +
    ScriptApp.getScriptId();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, entropy, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function validateAdminSignature_(payload, status) {
  const submissionId = cleanText_(payload.submissionId || payload.sid);
  const exp = Number(payload.exp || 0);
  const sig = cleanText_(payload.sig);
  if (!submissionId || !exp || !sig) {
    return false;
  }
  if (exp < Date.now()) {
    return false;
  }

  const expected = buildAdminSignature_(submissionId, status, exp);
  return safeEquals_(sig, expected);
}

function buildAdminSignature_(submissionId, status, exp) {
  const secret = getAdminSecret_();
  const base = submissionId + '|' + status + '|' + String(exp);
  const bytes = Utilities.computeHmacSha256Signature(base, secret, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function getAdminSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = cleanText_(props.getProperty('PERX_ADMIN_SECRET'));
  if (secret) {
    return secret;
  }

  // Bootstraps a per-script secret automatically if one has not been set.
  secret = generateSecureToken_() + generateSecureToken_();
  props.setProperty('PERX_ADMIN_SECRET', secret);
  return secret;
}

function appendSubmissionObject_(sheet, rowObject) {
function appendSubmissionObject_(rowObject) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const store = loadPilotStore_();
    const submissionId = cleanText_(rowObject.submissionId || rowObject.agreementId);
    store[submissionId] = Object.assign({}, rowObject);
    savePilotStore_(store);
  } finally {
    lock.releaseLock();
  }
}


function findPilotSubmissionRow_(submissionId) {
function findPilotSubmissionRow_(submissionId) {
  const store = loadPilotStore_();
  const key = cleanText_(submissionId);
  const row = store[key];
  if (!row) {
    return null;
  }

  return {
    submissionId: key,
    object: Object.assign({}, row)
  };
}


function updateSubmissionFields_(found, updates) {
function updateSubmissionFields_(found, updates) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const store = loadPilotStore_();
    const current = store[found.submissionId] || {};
    const next = Object.assign({}, current, updates || {});
    store[found.submissionId] = next;
    savePilotStore_(store);
  } finally {
    lock.releaseLock();
  }
}


function listPilotRows_() {
function listPilotRows_() {
  const store = loadPilotStore_();
  const rows = [];
  Object.keys(store).forEach(function (key) {
    const row = store[key] || {};
    const signupType = cleanText_(row.signupType);
    const submissionId = cleanText_(row.submissionId || row.agreementId || key);
    if (signupType === 'PILOT_2026_SIMPLE' || submissionId.indexOf(PILOT_ID_PREFIX) === 0) {
      rows.push(Object.assign({}, row));
    }
  });
  return rows;
}


function summarizePilotCounts_(rows) {
  var counts = {
    signedOn: 0,
    live: 0,
    pending: 0,
    unverified: 0
  };

  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    var verified = asBoolean_(row.emailVerified) || cleanText_(row.emailVerificationStatus).toLowerCase() === 'confirmed';
    var status = cleanText_(row.pilotStatus || row.status || row.approvalStatus || 'UNVERIFIED');

    if (!verified) {
      counts.unverified += 1;
      continue;
    }

    counts.signedOn += 1;
    if (status === 'LIVE') {
      counts.live += 1;
    } else if (status === 'PENDING') {
      counts.pending += 1;
    }
  }

  return counts;
}

function refreshPilotAdminSheet_() {
  return;
}

function appendSimpleResultRow_(row) {
  return;
}

function nextPilotSubmissionId_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const current = Number(props.getProperty(PILOT_SEQUENCE_KEY) || String(PILOT_SEQUENCE_START - 1));
    const next = current + 1;
    props.setProperty(PILOT_SEQUENCE_KEY, String(next));
    return PILOT_ID_PREFIX + padNumber_(next, 6);
  } finally {
    lock.releaseLock();
  }
}

function passesRateLimit_(ipAddress, email) {
  const ip = cleanText_(ipAddress);
  const normalizedEmail = normalizeEmail_(email);

  const key = [ip, normalizedEmail].join('|');
  if (!key.replace(/\|/g, '')) {
    return true;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const rateData = safeJsonParse_(props.getProperty(PILOT_RATE_KEY)) || {};
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;
    const arr = Array.isArray(rateData[key]) ? rateData[key] : [];
    const trimmed = arr.filter(function (ms) {
      return Number(ms) >= cutoff;
    });
    const allowed = trimmed.length < RATE_LIMIT;
    if (allowed) {
      trimmed.push(now);
    }
    rateData[key] = trimmed.slice(-RATE_LIMIT * 2);
    props.setProperty(PILOT_RATE_KEY, JSON.stringify(rateData));
    return allowed;
  } finally {
    lock.releaseLock();
  }
}

function logAudit_(eventType, details) {
  Logger.log(JSON.stringify({
    timestamp: formatIso_(new Date()),
    eventType: cleanText_(eventType),
    details: details || {}
  }));
}

function tryLogAudit_(eventType, details) {
  try {
    logAudit_(eventType, details);
  } catch (error) {
    // Keep responses stable even if audit logging fails.
  }
}

function loadPilotStore_() {
  const props = PropertiesService.getScriptProperties();
  const parsed = safeJsonParse_(props.getProperty(PILOT_STORE_KEY));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function savePilotStore_(store) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PILOT_STORE_KEY, JSON.stringify(store || {}));
}

function hashText_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );

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

  var diff = 0;
  for (var i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
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

function asBoolean_(value) {
  if (value === true || value === false) {
    return value;
  }
  const lowered = cleanText_(value).toLowerCase();
  return lowered === 'true' || lowered === 'yes' || lowered === '1';
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

function safeJsonParse_(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function getErrorMessage_(error) {
  if (error && error.message) {
    return cleanText_(error.message);
  }
  return cleanText_(error) || 'Unknown error';
}

function jsonResponse_(payload) {
  if (payload && payload.html) {
    return HtmlService.createHtmlOutput(String(payload.message || ''));
  }

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
