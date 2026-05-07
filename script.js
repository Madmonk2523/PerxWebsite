const WAITLIST_ENDPOINT = "https://script.google.com/macros/s/AKfycbxaypmeNsW1ZTtdIrDorM1czpk2OB1Ifpc3jsyDm8YN1e0ccznOONyQ2Bjq07dQcZkS/exec";

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

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = form.name.value.trim();
    const email = form.email.value.trim().toLowerCase();
    const town = form.town.value.trim();
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
      town,
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
      const response = await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Request failed");
      }

      setFeedback(
        result.message || "Check your inbox to confirm your spot on the waitlist.",
        "success"
      );
      form.reset();
      form.formStartedAt.value = String(Date.now());
    } catch (error) {
      setFeedback(error.message || "Could not submit right now. Please try again in a moment.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}
