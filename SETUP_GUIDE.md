# PERX Waitlist Setup Guide

## Step 1: Create a Google Sheet
1. Go to [sheet.new](https://sheet.new)
2. Name it "PERX Waitlist"

## Step 2: Add Apps Script Backend
1. In your new Sheet, go to **Extensions > Apps Script**
2. Delete any default code
3. Copy the entire contents of `waitlist-backend.gs` from this folder
4. Paste it into the Apps Script editor
5. At the top, change `ADMIN_EMAIL` to your real email address
   ```javascript
   const ADMIN_EMAIL = 'your-real-email@gmail.com';
   ```

## Step 3: Deploy as Web App
1. In Apps Script, click **Deploy > New deployment**
2. Choose type: **Web app**
3. Set:
   - Execute as: `Me` (your account)
   - Who has access: `Anyone`
4. Click **Deploy**
5. Copy the URL it gives you (looks like `https://script.google.com/...`)

## Step 4: Connect Your Website
1. Open `script.js` in your website folder
2. Find this line at the top:
   ```javascript
   const WAITLIST_ENDPOINT = "";
   ```
3. Replace it with:
   ```javascript
   const WAITLIST_ENDPOINT = "https://script.google.com/..."; // Paste your URL here
   ```
4. Commit and push your changes

## Testing
1. Go to your website
2. Fill out the form
3. You should see: "Check your email to confirm your spot on the waitlist."
4. Check your email for a confirmation link
5. Click it
6. Go back to your Google Sheet—you should see the entry with status `verified`

## How to Send Updates to Everyone
1. Go back to Apps Script
2. Click the play button (▶) at the top
3. In the dropdown, select `sendWaitlistBroadcast`
4. Click run

Before running, edit this function to include your message:
```javascript
sendWaitlistBroadcast(
  "PERX is live!",
  "<p>We're excited to announce PERX is now available...</p>",
  "We're excited to announce PERX is now available..."
);
```

## What's Included
✅ Double opt-in email verification (prevents fake emails)
✅ Automatic duplicate blocking
✅ Bot honeypot (hidden spam field)
✅ Form timing checks
✅ Email normalization (Test@Email.com = test@email.com)
✅ Broadcast function for updates
✅ Free forever (Google quota)

## Limits
- Google MailApp: ~100 emails/day from a Gmail account (free)
- For larger campaigns, use Brevo or Resend later
- Apps Script execution time: 6 min/run (plenty for this)

## Next Steps (Optional)
1. Add Cloudflare Turnstile for bot protection: Deploy a simple check in Apps Script
2. Switch to Brevo/Mailchimp for broadcasts if you get 1000+ subscribers
3. Add analytics to track signups over time

That's it. You're live.
