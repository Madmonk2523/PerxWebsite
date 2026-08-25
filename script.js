const BACKEND_ENDPOINT = "https://script.google.com/macros/s/AKfycbyX1iojcTrGjTfD9Xp9xpwji25hzke3pv8fhR74UtBD-mGitop_XfO6VtTyInnPahwz/exec";

const state = {
  submitting: false,
  submissionId: "",
  submittedEmail: "",
  verifiedPayload: null
};

const pilotSignupForm = document.getElementById("pilotSignupForm");
const submitBtn = document.getElementById("submitBtn");
const formFeedback = document.getElementById("formFeedback");

const signupPanel = document.getElementById("signupPanel");
const checkEmailPanel = document.getElementById("checkEmailPanel");
const verifiedPanel = document.getElementById("verifiedPanel");

const checkEmailCopy = document.getElementById("checkEmailCopy");
const checkEmailFeedback = document.getElementById("checkEmailFeedback");
const resendEmailBtn = document.getElementById("resendEmailBtn");
const editEmailBtn = document.getElementById("editEmailBtn");
const cancelEditEmailBtn = document.getElementById("cancelEditEmailBtn");
const editEmailForm = document.getElementById("editEmailForm");
const newEmailInput = document.getElementById("newEmailInput");

const verifiedBusinessCopy = document.getElementById("verifiedBusinessCopy");
const verifiedOffer = document.getElementById("verifiedOffer");
const verifiedRestrictions = document.getElementById("verifiedRestrictions");

setupEventListeners();
handleVerificationFromUrl();

function setupEventListeners() {
  ["joinHeaderBtn", "joinHeroBtn"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.addEventListener("click", () => {
        const joinForm = document.getElementById("join-form");
        if (joinForm) {
          joinForm.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  });

  if (pilotSignupForm) {
    pilotSignupForm.addEventListener("submit", submitPilotSignup);
    Array.from(pilotSignupForm.elements).forEach((el) => {
      if (el && el.name) {
        el.addEventListener("input", () => clearFieldError(el.name));
      }
    });
  }

  if (resendEmailBtn) {
    resendEmailBtn.addEventListener("click", resendVerificationEmail);
  }

  if (editEmailBtn) {
    editEmailBtn.addEventListener("click", () => {
      editEmailForm.classList.remove("is-hidden");
      editEmailForm.setAttribute("aria-hidden", "false");
      if (newEmailInput) {
        newEmailInput.value = state.submittedEmail;
        newEmailInput.focus();
      }
    });
  }

  if (cancelEditEmailBtn) {
    cancelEditEmailBtn.addEventListener("click", () => {
      editEmailForm.classList.add("is-hidden");
      editEmailForm.setAttribute("aria-hidden", "true");
      setFeedback(checkEmailFeedback, "", "");
    });
  }

  if (editEmailForm) {
    editEmailForm.addEventListener("submit", updateEmailAndResend);
  }
}

async function submitPilotSignup(event) {
  event.preventDefault();
  if (!pilotSignupForm || state.submitting) {
    return;
  }

  clearAllFieldErrors();
  setFeedback(formFeedback, "", "");

  const validation = validateForm();
  if (!validation.ok) {
    setFeedback(formFeedback, "Please review the highlighted fields and try again.", "error");
    return;
  }

  const trapValue = String(pilotSignupForm.trapField.value || "").trim();
  if (trapValue) {
    setFeedback(formFeedback, "Submission blocked.", "error");
    return;
  }

  const payload = buildPayload();
  state.submitting = true;
  submitBtn.disabled = true;
  setFeedback(formFeedback, "Submitting your business and sending verification email...", "");

  try {
    const result = await jsonpRequest("submitPilotSignup", payload, 30000);
    if (!result.ok) {
      throw new Error(result.message || "Unable to submit signup.");
    }

    state.submissionId = String(result.submissionId || "");
    state.submittedEmail = String(payload.email || "");
    showCheckEmailPanel(state.submittedEmail);
    setFeedback(checkEmailFeedback, result.message || "Verification email sent.", "success");
  } catch (error) {
    setFeedback(
      formFeedback,
      error.message || "We couldn't send the verification email. Please try again.",
      "error"
    );
  } finally {
    state.submitting = false;
    submitBtn.disabled = false;
  }
}

function validateForm() {
  const values = getFormValues();
  let ok = true;

  const requiredTextFields = [
    ["businessName", "Business name is required."],
    ["businessAddress", "Business address is required."],
    ["contactName", "Your name is required."],
    ["perxOffer", "Your PERX offer is required."]
  ];

  requiredTextFields.forEach(([field, message]) => {
    if (!String(values[field] || "").trim()) {
      setFieldError(field, message);
      ok = false;
    }
  });

  if (!["Owner", "Manager", "Other Authorized Representative"].includes(values.contactRole)) {
    setFieldError("contactRole", "Please choose your role.");
    ok = false;
  }

  if (!isValidEmail(values.email)) {
    setFieldError("email", "Enter a valid email address.");
    ok = false;
  }

  const digits = String(values.phone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    setFieldError("phone", "Enter a valid phone number.");
    ok = false;
  }

  if (!values.authorizationConfirmed) {
    setFieldError("authorizationConfirmed", "You must confirm authorization before joining.");
    ok = false;
  }

  return { ok };
}

function buildPayload() {
  const values = getFormValues();
  return {
    businessName: values.businessName,
    businessAddress: values.businessAddress,
    contactName: values.contactName,
    contactRole: values.contactRole,
    phone: values.phone,
    email: values.email,
    perxOffer: values.perxOffer,
    restrictions: values.restrictions,
    authorizationConfirmed: values.authorizationConfirmed,
    ipAddress: "",
    userAgent: navigator.userAgent,
    source: "joinperx.com"
  };
}

function getFormValues() {
  return {
    businessName: cleanValue(pilotSignupForm.businessName.value),
    businessAddress: cleanValue(pilotSignupForm.businessAddress.value),
    contactName: cleanValue(pilotSignupForm.contactName.value),
    contactRole: cleanValue(pilotSignupForm.contactRole.value),
    phone: cleanValue(pilotSignupForm.phone.value),
    email: cleanValue(pilotSignupForm.email.value).toLowerCase(),
    perxOffer: cleanValue(pilotSignupForm.perxOffer.value),
    restrictions: cleanValue(pilotSignupForm.restrictions.value),
    authorizationConfirmed: !!pilotSignupForm.authorizationConfirmed.checked
  };
}

function showCheckEmailPanel(email) {
  signupPanel.classList.add("is-hidden");
  signupPanel.setAttribute("aria-hidden", "true");
  verifiedPanel.classList.add("is-hidden");
  verifiedPanel.setAttribute("aria-hidden", "true");

  checkEmailPanel.classList.remove("is-hidden");
  checkEmailPanel.setAttribute("aria-hidden", "false");
  checkEmailCopy.textContent = `We sent a verification link to ${email}. Click the link to confirm your business signup.`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function resendVerificationEmail() {
  if (!state.submissionId) {
    setFeedback(checkEmailFeedback, "We couldn't find this submission. Please submit again.", "error");
    return;
  }

  resendEmailBtn.disabled = true;
  setFeedback(checkEmailFeedback, "Sending a fresh verification email...", "");

  try {
    const result = await jsonpRequest("resendVerificationEmail", {
      submissionId: state.submissionId,
      email: state.submittedEmail
    });

    if (!result.ok) {
      throw new Error(result.message || "Unable to resend verification email.");
    }

    setFeedback(checkEmailFeedback, result.message || "Verification email resent.", "success");
  } catch (error) {
    setFeedback(
      checkEmailFeedback,
      error.message || "We couldn't send the verification email. Please try again.",
      "error"
    );
  } finally {
    resendEmailBtn.disabled = false;
  }
}

async function updateEmailAndResend(event) {
  event.preventDefault();
  const nextEmail = cleanValue(newEmailInput.value).toLowerCase();

  if (!isValidEmail(nextEmail)) {
    setFeedback(checkEmailFeedback, "Enter a valid email address.", "error");
    newEmailInput.focus();
    return;
  }

  setFeedback(checkEmailFeedback, "Updating email and resending verification...", "");

  try {
    const result = await jsonpRequest("updateSubmissionEmail", {
      submissionId: state.submissionId,
      oldEmail: state.submittedEmail,
      newEmail: nextEmail
    });

    if (!result.ok) {
      throw new Error(result.message || "Unable to update email.");
    }

    state.submittedEmail = nextEmail;
    checkEmailCopy.textContent = `We sent a verification link to ${nextEmail}. Click the link to confirm your business signup.`;
    setFeedback(checkEmailFeedback, result.message || "Email updated and verification sent.", "success");
    editEmailForm.classList.add("is-hidden");
    editEmailForm.setAttribute("aria-hidden", "true");
  } catch (error) {
    setFeedback(checkEmailFeedback, error.message || "Unable to update email right now.", "error");
  }
}

async function handleVerificationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = cleanValue(params.get("verify"));
  const submissionId = cleanValue(params.get("sid"));

  if (!token || !submissionId) {
    return;
  }

  setVerifiedPanelLoadingState();

  try {
    const result = await jsonpRequest("verifyEmailToken", {
      token,
      submissionId
    });

    if (!result.ok) {
      showVerificationError(result, submissionId);
      return;
    }

    state.verifiedPayload = result;
    showVerifiedPanel(result);
    window.history.replaceState({}, "", window.location.pathname);
  } catch (error) {
    showVerificationError({ message: error.message }, submissionId);
  }
}

function setVerifiedPanelLoadingState() {
  signupPanel.classList.add("is-hidden");
  signupPanel.setAttribute("aria-hidden", "true");
  checkEmailPanel.classList.add("is-hidden");
  checkEmailPanel.setAttribute("aria-hidden", "true");

  verifiedPanel.classList.remove("is-hidden");
  verifiedPanel.setAttribute("aria-hidden", "false");
  verifiedBusinessCopy.textContent = "Confirming your business signup...";
  verifiedOffer.textContent = "";
  verifiedRestrictions.classList.add("is-hidden");
}

function showVerifiedPanel(result) {
  const businessName = String(result.businessName || "Your business");
  const offer = String(result.perxOffer || "");
  const restrictions = String(result.restrictions || "");

  if (result.alreadyVerified) {
    verifiedBusinessCopy.textContent = `You're already verified. ${businessName} is pending review.`;
  } else {
    verifiedBusinessCopy.textContent = `${businessName} has been submitted to PERX.`;
  }
  verifiedOffer.textContent = offer;
  if (restrictions) {
    verifiedRestrictions.classList.remove("is-hidden");
    verifiedRestrictions.textContent = `Restrictions: ${restrictions}`;
  } else {
    verifiedRestrictions.classList.add("is-hidden");
    verifiedRestrictions.textContent = "";
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showVerificationError(result, submissionId) {
  const message = String(result.message || "This verification link is invalid.");
  verifiedBusinessCopy.textContent = message;
  verifiedOffer.textContent = "";
  verifiedRestrictions.classList.add("is-hidden");

  if (result.errorCode === "TOKEN_EXPIRED" && submissionId) {
    state.submissionId = submissionId;
    state.submittedEmail = String(result.email || "");
    showCheckEmailPanel(state.submittedEmail || "your email");
    setFeedback(checkEmailFeedback, "This verification link has expired. Send a new verification email.", "error");
  }
}

function setFeedback(element, message, type) {
  if (!element) {
    return;
  }

  element.textContent = message || "";
  element.classList.remove("error", "success");
  if (type) {
    element.classList.add(type);
  }
}

function setFieldError(fieldName, message) {
  const errorEl = document.querySelector(`[data-error-for="${fieldName}"]`);
  if (errorEl) {
    errorEl.textContent = message;
  }
}

function clearFieldError(fieldName) {
  const errorEl = document.querySelector(`[data-error-for="${fieldName}"]`);
  if (errorEl) {
    errorEl.textContent = "";
  }
}

function clearAllFieldErrors() {
  document.querySelectorAll(".field-error").forEach((el) => {
    el.textContent = "";
  });
}

function cleanValue(value) {
  return String(value || "").trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function jsonpRequest(action, params, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const callbackName = `perxPortal_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const query = new URLSearchParams({
      action,
      callback: callbackName,
      _ts: String(Date.now())
    });

    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value === undefined || value === null) {
        return;
      }
      query.set(key, String(value));
    });

    const script = document.createElement("script");

    const cleanup = () => {
      if (window[callbackName]) {
        delete window[callbackName];
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      clearTimeout(timeoutId);
    };

    window[callbackName] = (result) => {
      cleanup();
      resolve(result || { ok: false, message: "No server response." });
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Unable to reach onboarding server."));
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Request timed out. Please try again."));
    }, timeoutMs);

    script.src = `${BACKEND_ENDPOINT}?${query.toString()}`;
    document.body.appendChild(script);
  });
}
