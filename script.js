const BACKEND_ENDPOINT = "https://script.google.com/macros/s/AKfycbwzakRd5psqLOgZPdgu9HoZj79bM6WbS5KQy1DY6UbYjj367KlvcDJehqSU9GOsK2IH/exec";
const AGREEMENT_VERSION = "2026.06.29-r4";

const state = {
  step: 1,
  totalSteps: 5,
  agreementReachedBottom: false,
  verificationSessionId: "",
  emailVerified: false,
  phoneVerified: false,
  signatureStrokes: [],
  telemetry: {
    ipAddress: "",
    city: "",
    region: "",
    country: "",
    postal: "",
    latitude: "",
    longitude: ""
  }
};

const landingPanel = document.getElementById("landingPanel");
const wizardPanel = document.getElementById("wizardPanel");
const successPanel = document.getElementById("successPanel");

const onboardingForm = document.getElementById("onboardingForm");
const startOnboardingBtn = document.getElementById("startOnboardingBtn");
const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");
const joinBtn = document.getElementById("joinBtn");
const formFeedback = document.getElementById("formFeedback");

const stepCounter = document.getElementById("stepCounter");
const progressFill = document.getElementById("progressFill");
const stepElements = Array.from(document.querySelectorAll(".step"));

const sendCodesBtn = document.getElementById("sendCodesBtn");
const verifyEmailBtn = document.getElementById("verifyEmailBtn");
const emailCodeInput = document.getElementById("emailCode");
const emailVerifyStatus = document.getElementById("emailVerifyStatus");
const phoneVerifyStatus = document.getElementById("phoneVerifyStatus");
const authoritySignerName = document.getElementById("authoritySignerName");
const authoritySignerTitle = document.getElementById("authoritySignerTitle");
const authorityBusinessName = document.getElementById("authorityBusinessName");
const authorityPhonePreview = document.getElementById("authorityPhonePreview");
const authorityEmailPreview = document.getElementById("authorityEmailPreview");

const agreementBox = document.getElementById("agreementBox");
const agreementScrollStatus = document.getElementById("agreementScrollStatus");
const zipLocationStatus = document.getElementById("zipLocationStatus");

const signaturePad = document.getElementById("signaturePad");
const clearSignatureBtn = document.getElementById("clearSignatureBtn");
const signatureNamePreview = document.getElementById("signatureNamePreview");
let resizeSignaturePad = () => {};
let zipLookupToken = 0;

const agreementNumberLabel = document.getElementById("agreementNumberLabel");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const returnHomeBtn = document.getElementById("returnHomeBtn");

if (onboardingForm && onboardingForm.formStartedAt) {
  onboardingForm.formStartedAt.value = String(Date.now());
}

if (onboardingForm && onboardingForm.signatureDate) {
  const today = new Date();
  onboardingForm.signatureDate.value = today.toISOString().slice(0, 10);
}

collectTelemetry();
setupSignaturePad();
setupEventListeners();
renderStep();

function setupEventListeners() {
  if (startOnboardingBtn) {
    startOnboardingBtn.addEventListener("click", () => {
      landingPanel.classList.add("is-hidden");
      landingPanel.setAttribute("aria-hidden", "true");
      wizardPanel.classList.remove("is-hidden");
      wizardPanel.setAttribute("aria-hidden", "false");
      setFeedback("", "");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", async () => {
      if (!(await validateCurrentStep())) {
        return;
      }
      state.step = Math.min(state.step + 1, state.totalSteps);
      renderStep();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      state.step = Math.max(state.step - 1, 1);
      renderStep();
      setFeedback("", "");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (agreementBox) {
    agreementBox.addEventListener("scroll", () => {
      const reachedBottom =
        agreementBox.scrollTop + agreementBox.clientHeight >= agreementBox.scrollHeight - 6;

      if (reachedBottom && !state.agreementReachedBottom) {
        state.agreementReachedBottom = true;
        setStatusPill(
          agreementScrollStatus,
          "Reached bottom. You can continue.",
          "success"
        );
      }
    });
  }

  if (clearSignatureBtn) {
    clearSignatureBtn.addEventListener("click", clearSignature);
  }

  if (sendCodesBtn) {
    sendCodesBtn.addEventListener("click", sendVerificationCodes);
  }

  if (verifyEmailBtn) {
    verifyEmailBtn.addEventListener("click", () => verifyCode("email"));
  }

  if (returnHomeBtn) {
    returnHomeBtn.addEventListener("click", () => {
      successPanel.classList.add("is-hidden");
      successPanel.setAttribute("aria-hidden", "true");
      landingPanel.classList.remove("is-hidden");
      landingPanel.setAttribute("aria-hidden", "false");
      resetFormFlow();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (onboardingForm) {
    onboardingForm.addEventListener("submit", submitAgreement);

    [onboardingForm.businessEmail, onboardingForm.businessPhone].forEach((input) => {
      if (!input) {
        return;
      }
      input.addEventListener("input", resetVerificationState);
    });

    if (onboardingForm.zipCode) {
      onboardingForm.zipCode.addEventListener("input", () => {
        const zip = String(onboardingForm.zipCode.value || "").replace(/\D/g, "").slice(0, 5);
        onboardingForm.zipCode.value = zip;
        onboardingForm.city.value = "";
        onboardingForm.state.value = "NY";
        onboardingForm.zipCode.dataset.resolvedZip = "";
        zipLookupToken += 1;

        if (zip.length === 5) {
          lookupNewYorkZip(zip);
        } else {
          setZipLocationStatus("Enter a 5-digit New York ZIP code", "neutral");
        }
      });

      onboardingForm.zipCode.addEventListener("blur", () => {
        const zip = String(onboardingForm.zipCode.value || "").trim();
        if (/^\d{5}$/.test(zip) && !String(onboardingForm.city.value || "").trim()) {
          lookupNewYorkZip(zip);
        }
      });
    }

    if (onboardingForm.ownerName) {
      onboardingForm.ownerName.addEventListener("input", updateSignatureNamePreview);
    }

    [
      onboardingForm.ownerName,
      onboardingForm.jobTitle,
      onboardingForm.businessName,
      onboardingForm.businessPhone,
      onboardingForm.businessEmail
    ].forEach((input) => {
      if (input) {
        input.addEventListener("input", updateAuthoritySummary);
      }
    });

    if (onboardingForm.signerRole && onboardingForm.authorityBasis) {
      onboardingForm.signerRole.addEventListener("change", () => {
        const role = String(onboardingForm.signerRole.value || "");
        const currentBasis = String(onboardingForm.authorityBasis.value || "");
        const automaticBases = [
          "Ownership of the business",
          "Authority inherent in officer or executive role"
        ];

        if (role === "Owner or Co-owner") {
          onboardingForm.authorityBasis.value = automaticBases[0];
        } else if (role === "Corporate Officer or Executive") {
          onboardingForm.authorityBasis.value = automaticBases[1];
        } else if (automaticBases.includes(currentBasis)) {
          onboardingForm.authorityBasis.value = "";
        }
      });
    }
  }
}

function setFeedback(message, type) {
  if (!formFeedback) {
    return;
  }

  formFeedback.textContent = message || "";
  formFeedback.classList.remove("error", "success");

  if (type) {
    formFeedback.classList.add(type);
  }
}

function setStatusPill(el, message, type) {
  if (!el) {
    return;
  }

  el.textContent = message;
  el.classList.remove("neutral", "success", "warning", "error");
  el.classList.add(type || "neutral");
}

function renderStep() {
  stepElements.forEach((el) => {
    const step = Number(el.dataset.step);
    const active = step === state.step;
    el.classList.toggle("is-hidden", !active);
    el.setAttribute("aria-hidden", active ? "false" : "true");
  });

  if (stepCounter) {
    stepCounter.textContent = `Step ${state.step} of ${state.totalSteps}`;
  }

  if (progressFill) {
    progressFill.style.width = `${(state.step / state.totalSteps) * 100}%`;
  }

  if (backBtn) {
    backBtn.disabled = state.step === 1;
  }

  if (nextBtn && joinBtn) {
    const lastStep = state.step === state.totalSteps;
    nextBtn.classList.toggle("is-hidden", lastStep);
    joinBtn.classList.toggle("is-hidden", !lastStep);
  }

  if (state.step === 3) {
    updateAuthoritySummary();
  }

  if (state.step === state.totalSteps) {
    updateSignatureNamePreview();
    scheduleSignaturePadResize();
  }
}

async function validateCurrentStep() {
  if (!onboardingForm) {
    return false;
  }

  if (state.step === 1) {
    const required = [
      onboardingForm.businessName,
      onboardingForm.businessAddress,
      onboardingForm.zipCode,
      onboardingForm.businessPhone,
      onboardingForm.businessEmail,
      onboardingForm.businessCategory,
      onboardingForm.ownerName,
      onboardingForm.jobTitle
    ];

    for (const field of required) {
      if (!field || !String(field.value || "").trim()) {
        setFeedback("Please complete all required business information fields.", "error");
        field && field.focus();
        return false;
      }
    }

    const zip = String(onboardingForm.zipCode.value || "").trim();
    if (!/^\d{5}$/.test(zip)) {
      setFeedback("Please enter a valid 5-digit New York ZIP code.", "error");
      onboardingForm.zipCode.focus();
      return false;
    }

    const resolvedZip = String(onboardingForm.zipCode.dataset.resolvedZip || "");
    if (
      resolvedZip !== zip ||
      !String(onboardingForm.city.value || "").trim() ||
      String(onboardingForm.state.value || "").toUpperCase() !== "NY"
    ) {
      const zipResolved = await lookupNewYorkZip(zip);
      if (!zipResolved) {
        setFeedback("Please enter a valid New York ZIP code.", "error");
        onboardingForm.zipCode.focus();
        return false;
      }
    }

    if (!isValidEmail(onboardingForm.businessEmail.value)) {
      setFeedback("Please enter a valid business email address.", "error");
      onboardingForm.businessEmail.focus();
      return false;
    }

    setFeedback("", "");
    return true;
  }

  if (state.step === 2) {
    if (!getMaxDiscountAmount()) {
      setFeedback("Please enter the maximum discount amount.", "error");
      onboardingForm.maxDiscount.focus();
      return false;
    }

    setFeedback("", "");
    return true;
  }

  if (state.step === 3) {
    if (!String(onboardingForm.signerRole.value || "").trim()) {
      setFeedback("Please select your role at the business.", "error");
      onboardingForm.signerRole.focus();
      return false;
    }

    if (!String(onboardingForm.authorityBasis.value || "").trim()) {
      setFeedback("Please select what gives you authority to sign for the business.", "error");
      onboardingForm.authorityBasis.focus();
      return false;
    }

    if (!state.verificationSessionId) {
      setFeedback("Please send and confirm the business email code before continuing.", "error");
      return false;
    }

    if (!state.emailVerified) {
      setFeedback("Business email confirmation is required before continuing.", "error");
      return false;
    }

    setFeedback("", "");
    return true;
  }

  if (state.step === 4) {
    if (!state.agreementReachedBottom) {
      setFeedback("Please scroll to the end of the agreement before continuing.", "error");
      return false;
    }

    const checkboxNames = [
      "certifyAuthority",
      "agreeTerms",
      "legalBinding",
      "eSignConsent",
      "penaltyPerjury",
      "signatureEffectConsent"
    ];

    for (const name of checkboxNames) {
      const input = onboardingForm[name];
      if (!input || !input.checked) {
        setFeedback("Please check every required agreement confirmation box.", "error");
        input && input.focus();
        return false;
      }
    }

    setFeedback("", "");
    return true;
  }

  if (state.step === 5) {
    if (!String(onboardingForm.ownerName.value || "").trim()) {
      setFeedback("Please return to Business Information and enter the authorized representative's name.", "error");
      return false;
    }

    if (!String(onboardingForm.signatureDate.value || "").trim()) {
      setFeedback("Please choose the signature date.", "error");
      onboardingForm.signatureDate.focus();
      return false;
    }

    setFeedback("", "");
    return true;
  }

  return true;
}

async function sendVerificationCodes() {
  if (!onboardingForm) {
    return;
  }

  const email = String(onboardingForm.businessEmail.value || "").trim().toLowerCase();
  const phone = String(onboardingForm.businessPhone.value || "").trim();
  const businessName = String(onboardingForm.businessName.value || "").trim();

  if (!businessName || !isValidEmail(email) || phone.length < 7) {
    setFeedback("Complete business name, valid email, and phone before requesting a code.", "error");
    return;
  }

  sendCodesBtn.disabled = true;
  setFeedback("Sending confirmation code...", "");

  try {
    const result = await jsonpRequest("startVerification", {
      businessName,
      businessEmail: email,
      businessPhone: phone,
      website: String(onboardingForm.website.value || "").trim(),
      ownerName: String(onboardingForm.ownerName.value || "").trim(),
      ipAddress: state.telemetry.ipAddress,
      userAgent: navigator.userAgent,
      deviceInfo: getDeviceInfo(),
      startedAt: onboardingForm.formStartedAt ? onboardingForm.formStartedAt.value : ""
    });

    if (!result.ok) {
      throw new Error(result.message || "Could not send confirmation code.");
    }

    state.verificationSessionId = String(result.sessionId || "");
    state.emailVerified = false;
    state.phoneVerified = false;

    setStatusPill(emailVerifyStatus, "Email code sent. Awaiting confirmation.", "warning");
    setStatusPill(phoneVerifyStatus, "Phone review pending", "neutral");

    setFeedback(result.message || "Confirmation code sent.", "success");
  } catch (error) {
    setFeedback(error.message || "Unable to send confirmation code.", "error");
  } finally {
    sendCodesBtn.disabled = false;
  }
}

async function verifyCode(channel) {
  if (!state.verificationSessionId) {
    setFeedback("Please send the confirmation code first.", "error");
    return;
  }

  const input = emailCodeInput;
  const code = String(input && input.value || "").trim();

  if (!/^\d{6}$/.test(code)) {
    setFeedback("Please enter a valid 6-digit confirmation code.", "error");
    input && input.focus();
    return;
  }

  setFeedback(`Confirming ${channel} code...`, "");

  try {
    const result = await jsonpRequest("verifyCode", {
      sessionId: state.verificationSessionId,
      channel,
      code,
      ipAddress: state.telemetry.ipAddress
    });

    if (!result.ok) {
      throw new Error(result.message || "Confirmation failed.");
    }

    state.emailVerified = true;
    setStatusPill(emailVerifyStatus, "Business email confirmed", "success");

    setFeedback(result.message || "Confirmation successful.", "success");
  } catch (error) {
    setFeedback(error.message || "Confirmation failed.", "error");
    setStatusPill(emailVerifyStatus, "Email confirmation failed", "error");
  }
}

function resetVerificationState() {
  state.verificationSessionId = "";
  state.emailVerified = false;
  state.phoneVerified = false;

  if (emailCodeInput) {
    emailCodeInput.value = "";
  }

  setStatusPill(emailVerifyStatus, "Not confirmed", "neutral");
  setStatusPill(phoneVerifyStatus, "Phone review pending", "neutral");
}

async function submitAgreement(event) {
  event.preventDefault();

  if (!(await validateCurrentStep())) {
    return;
  }

  if (!state.emailVerified) {
    setFeedback("Business email confirmation must be completed before submission.", "error");
    return;
  }

  const trapValue = String(onboardingForm.trapField.value || "").trim();
  if (trapValue) {
    setFeedback("Submission blocked.", "error");
    return;
  }

  const payload = buildSubmissionPayload();

  joinBtn.disabled = true;
  setFeedback("Submitting signed agreement...", "");

  try {
    const result = await jsonpRequest("submitAgreement", payload, 30000);

    if (!result.ok) {
      throw new Error(result.message || "Unable to submit agreement.");
    }

    setFeedback("", "");
    showSuccess(result);
  } catch (error) {
    setFeedback(error.message || "Unable to submit agreement at this time.", "error");
  } finally {
    joinBtn.disabled = false;
  }
}

function buildSubmissionPayload() {
  const email = String(onboardingForm.businessEmail.value || "").trim().toLowerCase();
  const website = String(onboardingForm.website.value || "").trim();
  const maxDiscount = getMaxDiscountAmount();

  return {
    sessionId: state.verificationSessionId,
    agreementVersion: AGREEMENT_VERSION,
    businessName: String(onboardingForm.businessName.value || "").trim(),
    businessAddress: String(onboardingForm.businessAddress.value || "").trim(),
    city: String(onboardingForm.city.value || "").trim(),
    state: String(onboardingForm.state.value || "").trim().toUpperCase(),
    zipCode: String(onboardingForm.zipCode.value || "").trim(),
    businessPhone: String(onboardingForm.businessPhone.value || "").trim(),
    businessEmail: email,
    website,
    businessCategory: String(onboardingForm.businessCategory.value || "").trim(),
    ownerName: String(onboardingForm.ownerName.value || "").trim(),
    jobTitle: String(onboardingForm.jobTitle.value || "").trim(),
    signerRole: String(onboardingForm.signerRole.value || "").trim(),
    authorityBasis: String(onboardingForm.authorityBasis.value || "").trim(),
    notes: String(onboardingForm.notes.value || "").trim(),
    maxDiscount,
    offerDetails: buildOfferDetails(maxDiscount),
    offerRestrictions: buildOfferRestrictions(maxDiscount),
    signatureName: String(onboardingForm.ownerName.value || "").trim(),
    signatureDate: String(onboardingForm.signatureDate.value || "").trim(),
    drawnSignature: serializeSignatureData(),
    drawnSignaturePresent: state.signatureStrokes.length > 0,
    consentAuthority: onboardingForm.certifyAuthority.checked,
    consentAgreement: onboardingForm.agreeTerms.checked,
    consentLegalBinding: onboardingForm.legalBinding.checked,
    consentESign: onboardingForm.eSignConsent.checked,
    consentPerjury: onboardingForm.penaltyPerjury.checked,
    consentSignatureEffect: onboardingForm.signatureEffectConsent.checked,
    consentCountersignature: onboardingForm.signatureEffectConsent.checked,
    formStartedAt: String(onboardingForm.formStartedAt ? onboardingForm.formStartedAt.value : ""),
    submittedAt: new Date().toISOString(),
    ipAddress: state.telemetry.ipAddress,
    userAgent: navigator.userAgent,
    browser: getBrowserName(),
    operatingSystem: getOperatingSystem(),
    deviceInfo: getDeviceInfo(),
    approxLocation: buildApproxLocation(),
    emailVerificationStatus: state.emailVerified,
    phoneVerificationStatus: state.phoneVerified,
    emailDomainStatus: "NOT_CHECKED"
  };
}

function showSuccess(result) {
  wizardPanel.classList.add("is-hidden");
  wizardPanel.setAttribute("aria-hidden", "true");

  successPanel.classList.remove("is-hidden");
  successPanel.setAttribute("aria-hidden", "false");

  const agreementId = String(result.agreementId || "");
  agreementNumberLabel.textContent = agreementId
    ? `Agreement Number: ${agreementId}`
    : "Agreement Number generated";

  if (result.pdfUrl) {
    downloadPdfBtn.href = result.pdfUrl;
    downloadPdfBtn.classList.remove("is-hidden");
  } else {
    downloadPdfBtn.classList.add("is-hidden");
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetFormFlow() {
  if (!onboardingForm) {
    return;
  }

  onboardingForm.reset();
  onboardingForm.formStartedAt.value = String(Date.now());
  onboardingForm.signatureDate.value = new Date().toISOString().slice(0, 10);
  onboardingForm.state.value = "NY";
  onboardingForm.zipCode.dataset.resolvedZip = "";

  state.step = 1;
  state.agreementReachedBottom = false;
  state.verificationSessionId = "";
  state.emailVerified = false;
  state.phoneVerified = false;

  clearSignature();
  if (emailCodeInput) {
    emailCodeInput.value = "";
  }
  setStatusPill(emailVerifyStatus, "Not confirmed", "neutral");
  setStatusPill(phoneVerifyStatus, "Phone review pending", "neutral");
  setStatusPill(agreementScrollStatus, "Scroll to the bottom to continue", "warning");
  setZipLocationStatus("Enter a 5-digit New York ZIP code", "neutral");
  updateSignatureNamePreview();

  renderStep();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function getMaxDiscountAmount() {
  const raw = String(onboardingForm.maxDiscount.value || "").trim();
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }
  return amount.toFixed(2);
}

function formatCurrency(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function buildOfferDetails(maxDiscount) {
  return `PERX may set discounts up to ${formatCurrency(maxDiscount)} for an eligible proximity-circle pass.`;
}

function buildOfferRestrictions(maxDiscount) {
  return `PERX determines the discount amount and required minimum purchase, subject to the business's ${formatCurrency(maxDiscount)} maximum. Customer claim eligibility resets 24 hours after each claim.`;
}

function setZipLocationStatus(message, type) {
  if (!zipLocationStatus) {
    return;
  }

  const label = zipLocationStatus.querySelector(".zip-location-label");
  const value = zipLocationStatus.querySelector("strong");
  zipLocationStatus.classList.remove("is-loading", "is-valid", "is-error");

  if (type === "loading") {
    zipLocationStatus.classList.add("is-loading");
  } else if (type === "valid") {
    zipLocationStatus.classList.add("is-valid");
  } else if (type === "error") {
    zipLocationStatus.classList.add("is-error");
  }

  if (label) {
    label.textContent = type === "valid" ? "Business location" : "City and state";
  }
  if (value) {
    value.textContent = message;
  }
}

async function lookupNewYorkZip(zipValue) {
  const zip = String(zipValue || "").replace(/\D/g, "").slice(0, 5);
  if (!/^\d{5}$/.test(zip)) {
    setZipLocationStatus("Enter a 5-digit New York ZIP code", "error");
    return false;
  }

  const token = ++zipLookupToken;
  setZipLocationStatus("Finding city...", "loading");

  try {
    const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("ZIP_NOT_FOUND");
    }

    const data = await response.json();
    const places = Array.isArray(data.places) ? data.places : [];
    const place = places.find(
      (entry) => String(entry["state abbreviation"] || "").toUpperCase() === "NY"
    );

    if (!place) {
      throw new Error("NOT_NEW_YORK");
    }

    if (token !== zipLookupToken || String(onboardingForm.zipCode.value || "") !== zip) {
      return false;
    }

    const city = String(place["place name"] || "").trim();
    if (!city) {
      throw new Error("ZIP_NOT_FOUND");
    }

    onboardingForm.city.value = city;
    onboardingForm.state.value = "NY";
    onboardingForm.zipCode.dataset.resolvedZip = zip;
    setZipLocationStatus(`${city}, New York`, "valid");
    return true;
  } catch (error) {
    if (token !== zipLookupToken) {
      return false;
    }

    onboardingForm.city.value = "";
    onboardingForm.state.value = "NY";
    onboardingForm.zipCode.dataset.resolvedZip = "";
    const message = error && error.message === "NOT_NEW_YORK"
      ? "That ZIP code is not in New York"
      : "ZIP code not found. Check it and try again.";
    setZipLocationStatus(message, "error");
    return false;
  }
}

function updateSignatureNamePreview() {
  if (!signatureNamePreview || !onboardingForm || !onboardingForm.ownerName) {
    return;
  }

  const name = String(onboardingForm.ownerName.value || "").trim();
  signatureNamePreview.textContent = name || "Authorized representative";
}

function updateAuthoritySummary() {
  if (!onboardingForm) {
    return;
  }

  const signerName = String(onboardingForm.ownerName.value || "").trim();
  const signerTitle = String(onboardingForm.jobTitle.value || "").trim();
  const businessName = String(onboardingForm.businessName.value || "").trim();
  const businessPhone = String(onboardingForm.businessPhone.value || "").trim();
  const businessEmail = String(onboardingForm.businessEmail.value || "").trim();

  if (authoritySignerName) {
    authoritySignerName.textContent = signerName || "Authorized representative";
  }
  if (authoritySignerTitle) {
    authoritySignerTitle.textContent = signerTitle || "Job title";
  }
  if (authorityBusinessName) {
    authorityBusinessName.textContent = businessName || "Business name";
  }
  if (authorityPhonePreview) {
    authorityPhonePreview.textContent = businessPhone || "Business phone";
  }
  if (authorityEmailPreview) {
    authorityEmailPreview.textContent = businessEmail || "Business email";
  }
}

function getBrowserName() {
  const ua = navigator.userAgent;

  if (ua.includes("Edg/")) {
    return "Edge";
  }
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) {
    return "Chrome";
  }
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) {
    return "Safari";
  }
  if (ua.includes("Firefox/")) {
    return "Firefox";
  }
  if (ua.includes("OPR/")) {
    return "Opera";
  }

  return "Unknown";
}

function getOperatingSystem() {
  const ua = navigator.userAgent;

  if (ua.includes("Windows")) {
    return "Windows";
  }
  if (ua.includes("Mac OS")) {
    return "macOS";
  }
  if (ua.includes("Android")) {
    return "Android";
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    return "iOS";
  }
  if (ua.includes("Linux")) {
    return "Linux";
  }

  return "Unknown";
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const screenInfo = `${window.screen.width}x${window.screen.height}`;
  return `${mobile ? "Mobile" : "Desktop"} | ${screenInfo}`;
}

function buildApproxLocation() {
  const t = state.telemetry;
  const parts = [t.city, t.region, t.country, t.postal].filter(Boolean);
  const locationLabel = parts.join(", ");
  const coordinates = t.latitude && t.longitude ? `${t.latitude},${t.longitude}` : "";
  return [locationLabel, coordinates].filter(Boolean).join(" | ");
}

async function collectTelemetry() {
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      state.telemetry.ipAddress = String(ipData.ip || "");
    }
  } catch (error) {
    // Keep best-effort telemetry collection silent.
  }

  try {
    const locRes = await fetch("https://ipapi.co/json/", { cache: "no-store" });
    if (locRes.ok) {
      const locData = await locRes.json();
      state.telemetry.city = String(locData.city || "");
      state.telemetry.region = String(locData.region || "");
      state.telemetry.country = String(locData.country_name || "");
      state.telemetry.postal = String(locData.postal || "");
      state.telemetry.latitude = String(locData.latitude || "");
      state.telemetry.longitude = String(locData.longitude || "");
      if (!state.telemetry.ipAddress) {
        state.telemetry.ipAddress = String(locData.ip || "");
      }
    }
  } catch (error) {
    // Keep best-effort telemetry collection silent.
  }
}

function setupSignaturePad() {
  if (!signaturePad) {
    return;
  }

  const ctx = signaturePad.getContext("2d");
  if (!ctx) {
    return;
  }

  function resizeCanvas() {
    const rect = signaturePad.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
    const nextHeight = Math.max(1, Math.floor(rect.height * dpr));

    if (signaturePad.width !== nextWidth) {
      signaturePad.width = nextWidth;
    }
    if (signaturePad.height !== nextHeight) {
      signaturePad.height = nextHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawSignature();
  }

  resizeSignaturePad = resizeCanvas;

  function getPointFromClient(clientX, clientY) {
    const rect = signaturePad.getBoundingClientRect();
    return {
      x: Number((clientX - rect.left).toFixed(2)),
      y: Number((clientY - rect.top).toFixed(2))
    };
  }

  let drawing = false;

  function startDrawing(clientX, clientY, event) {
    event && event.preventDefault();
    resizeCanvas();
    drawing = true;
    const point = getPointFromClient(clientX, clientY);
    state.signatureStrokes.push([point]);
  }

  function continueDrawing(clientX, clientY, event) {
    if (!drawing || !state.signatureStrokes.length) {
      return;
    }

    event && event.preventDefault();
    const point = getPointFromClient(clientX, clientY);
    const stroke = state.signatureStrokes[state.signatureStrokes.length - 1];
    stroke.push(point);

    drawStrokeSegment(stroke, ctx);
  }

  function stopDrawing() {
    drawing = false;
  }

  if (window.PointerEvent) {
    signaturePad.addEventListener("pointerdown", (event) => {
      if (signaturePad.setPointerCapture) {
        try {
          signaturePad.setPointerCapture(event.pointerId);
        } catch (error) {
          // Some browsers throw if capture is unavailable for this pointer.
        }
      }
      startDrawing(event.clientX, event.clientY, event);
    });

    signaturePad.addEventListener("pointermove", (event) => {
      continueDrawing(event.clientX, event.clientY, event);
    });

    signaturePad.addEventListener("pointerup", stopDrawing);
    signaturePad.addEventListener("pointerleave", stopDrawing);
    signaturePad.addEventListener("pointercancel", stopDrawing);
  } else {
    signaturePad.addEventListener("mousedown", (event) => {
      startDrawing(event.clientX, event.clientY, event);
    });

    window.addEventListener("mousemove", (event) => {
      continueDrawing(event.clientX, event.clientY, event);
    });

    window.addEventListener("mouseup", stopDrawing);

    signaturePad.addEventListener("touchstart", (event) => {
      const touch = event.touches && event.touches[0];
      if (touch) {
        startDrawing(touch.clientX, touch.clientY, event);
      }
    });

    signaturePad.addEventListener("touchmove", (event) => {
      const touch = event.touches && event.touches[0];
      if (touch) {
        continueDrawing(touch.clientX, touch.clientY, event);
      }
    });

    signaturePad.addEventListener("touchend", stopDrawing);
    signaturePad.addEventListener("touchcancel", stopDrawing);
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
}

function scheduleSignaturePadResize() {
  if (!signaturePad) {
    return;
  }

  window.requestAnimationFrame(() => {
    resizeSignaturePad();
    window.setTimeout(resizeSignaturePad, 80);
  });
}

function drawStrokeSegment(stroke, ctx) {
  if (!stroke || stroke.length < 2) {
    return;
  }

  const prev = stroke[stroke.length - 2];
  const curr = stroke[stroke.length - 1];

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0d3b76";
  ctx.lineWidth = 2.1;

  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(curr.x, curr.y);
  ctx.stroke();
}

function redrawSignature() {
  if (!signaturePad) {
    return;
  }

  const ctx = signaturePad.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, signaturePad.width, signaturePad.height);

  state.signatureStrokes.forEach((stroke) => {
    for (let index = 1; index < stroke.length; index += 1) {
      drawStrokeSegment([stroke[index - 1], stroke[index]], ctx);
    }
  });
}

function clearSignature() {
  state.signatureStrokes = [];
  redrawSignature();
}

function serializeSignatureData() {
  if (!state.signatureStrokes.length) {
    return "";
  }

  const compact = state.signatureStrokes
    .slice(0, 14)
    .map((stroke) => {
      const sampled = [];
      const stride = Math.max(Math.floor(stroke.length / 40), 1);
      for (let index = 0; index < stroke.length; index += stride) {
        sampled.push(stroke[index]);
      }
      if (stroke.length && sampled[sampled.length - 1] !== stroke[stroke.length - 1]) {
        sampled.push(stroke[stroke.length - 1]);
      }
      return sampled;
    })
    .filter((stroke) => stroke.length > 0);

  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(compact))));
  } catch (error) {
    return "";
  }
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
