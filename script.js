const WAITLIST_ENDPOINT = "";

const form = document.getElementById("waitlistForm");
const feedback = document.getElementById("formFeedback");
const submitBtn = document.getElementById("submitBtn");

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
    const email = form.email.value.trim();
    const town = form.town.value.trim();
    const updatesConsent = form.updatesConsent.checked;

    if (!name) {
      setFeedback("Please enter your name.", "error");
      return;
    }

    if (!isValidEmail(email)) {
      setFeedback("Please enter a valid email.", "error");
      return;
    }

    if (!updatesConsent) {
      setFeedback("Please confirm you want PERX email updates.", "error");
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
      updatesConsent,
      region: "Long Island",
      source: "perx-waitlist-site",
      submittedAt: new Date().toISOString(),
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

      if (!response.ok) {
        throw new Error("Request failed");
      }

      setFeedback("You are on the waitlist. We will email you updates.", "success");
      form.reset();
    } catch (error) {
      setFeedback(
        "Could not submit right now. Please try again in a moment.",
        "error"
      );
    } finally {
      submitBtn.disabled = false;
    }
  });
}
