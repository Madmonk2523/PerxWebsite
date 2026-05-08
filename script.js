const WAITLIST_ENDPOINT = "https://script.google.com/macros/s/AKfycbyT7qa_vw9bkI_ULiEdAXqjJGHsBuxmciTn2f_keZ3caJfkDJkcpqjyYh0p54ZjzpgA/exec";

const form = document.getElementById("waitlistForm");
const feedback = document.getElementById("formFeedback");
const submitBtn = document.getElementById("submitBtn");

if (form && form.formStartedAt) {
  form.formStartedAt.value = String(Date.now());
}

function setFeedback(message, type) {
  feedback.textContent = message;
  feedback.classList.remove("success", "error");
  if (type) {
    feedback.classList.add(type);
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function submitViaJsonpOnce(payload) {
  return new Promise((resolve, reject) => {
    const callbackName = `perxWaitlist_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const timeoutMs = 20000;

    const query = new URLSearchParams({
      action: "signup",
      callback: callbackName,
      name: payload.name,
      email: payload.email,
      company: payload.company,
      formStartedAt: String(payload.formStartedAt),
      region: payload.region,
      source: payload.source,
      submittedAt: payload.submittedAt,
      userAgent: String(payload.userAgent || "").slice(0, 180),
      _ts: String(Date.now()),
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
      resolve(result || { ok: false, message: "No response from server." });
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not reach waitlist server. Check Apps Script deployment access."));
    };

    script.src = `${WAITLIST_ENDPOINT}?${query.toString()}`;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Waitlist server timed out. Try again."));
    }, timeoutMs);

    document.body.appendChild(script);
  });
}

async function submitViaJsonp(payload) {
  try {
    return await submitViaJsonpOnce(payload);
  } catch (firstError) {
    // Retry once because Apps Script can fail transiently on cold starts/network hiccups.
    await delay(700);
    return submitViaJsonpOnce(payload);
  }
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!window.navigator.onLine) {
      setFeedback("You appear to be offline. Reconnect and try again.", "error");
      return;
    }

    const name = form.name.value.trim();
    const email = form.email.value.trim().toLowerCase();
    const company = form.company.value.trim();
    const formStartedAt = Number(form.formStartedAt.value || 0);

    if (!name) {
      setFeedback("Please enter your name.", "error");
      return;
    }

    if (!isValidEmail(email)) {
      setFeedback("Please enter a valid email.", "error");
      return;
    }

    if (!WAITLIST_ENDPOINT) {
      setFeedback(
        "Set WAITLIST_ENDPOINT in script.js to your Google Apps Script Web App URL.",
        "error"
      );
      return;
    }

    const payload = {
      name,
      email,
      company,
      formStartedAt,
      updatesConsent: true,
      region: "Long Island",
      source: "perx-waitlist-site",
      submittedAt: new Date().toISOString(),
      userAgent: window.navigator.userAgent,
    };

    submitBtn.disabled = true;
    setFeedback("Submitting...", null);

    try {
      const result = await submitViaJsonp(payload);
      if (!result.ok) {
        throw new Error(result.message || "Could not submit right now. Please try again.");
      }

      setFeedback(
        result.message || "Check your inbox and verify your email to lock in your spot.",
        "success"
      );
      form.reset();
      form.formStartedAt.value = String(Date.now());
    } catch (error) {
      setFeedback(
        error.message || "Could not submit right now. Please try again in a moment.",
        "error"
      );
    } finally {
      submitBtn.disabled = false;
    }
  });
}
