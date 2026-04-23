import twilio from "twilio";

const MAX_RETRIES = 2;
const CALL_RING_TIMEOUT_SECONDS = 20;
const CALL_ROTATION_BUFFER_MIN_MS = 5000;
const CALL_ROTATION_BUFFER_MAX_MS = 7000;

// Lazy client — initialized on first use so dotenv has time to load
let _client: twilio.Twilio | null | undefined = undefined;

function getClient(): twilio.Twilio | null {
  if (_client !== undefined) return _client;

  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_PHONE_NUMBER || "";

  if (!sid || !token) {
    console.warn("[TWILIO] Credentials not configured — SMS/calls disabled");
    _client = null;
    return null;
  }

  _client = twilio(sid, token);
  console.log(`[TWILIO] Client initialized (SID ****${sid.slice(-6)}, from ${from || "unset"})`);
  return _client;
}

function getFromNumber(): string {
  return process.env.TWILIO_PHONE_NUMBER || "";
}

/**
 * Send SMS to a phone number with retry
 */
async function sendSMSWithRetry(
  to: string,
  body: string,
  attempt = 0
): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn("[TWILIO] Client not initialized, skipping SMS");
    return false;
  }

  const from = getFromNumber();
  if (!from) {
    console.error("[TWILIO] TWILIO_PHONE_NUMBER not set — cannot send SMS");
    return false;
  }

  try {
    const msg = await client.messages.create({ body, from, to });
    console.log(`[TWILIO] ✅ SMS sent to ${to} | SID: ${msg.sid} | Status: ${msg.status}`);
    return true;
  } catch (err: any) {
    // Twilio error codes: https://www.twilio.com/docs/api/errors
    const code = err.code || err.status;
    const detail = err.message || String(err);
    console.error(`[TWILIO] ❌ SMS to ${to} failed (attempt ${attempt + 1}) | Code: ${code} | ${detail}`);

    if (code === 21610) {
      console.error(`[TWILIO] ⛔ ${to} has opted out of messages (unsubscribed)`);
      return false; // Don't retry opted-out numbers
    }
    if (code === 21614) {
      console.error(`[TWILIO] ⛔ ${to} is not a valid mobile number`);
      return false;
    }
    if (code === 21608) {
      console.error(`[TWILIO] ⚠️  Trial account: ${to} is not a verified number. Verify it at https://www.twilio.com/console/phone-numbers/verified`);
      return false; // Don't retry — Trial limitation
    }
    if (code === 21266) {
      console.error(`[TWILIO] ⛔ Error 21266 — From/To pair violates a blacklist rule for ${to}`);
      console.error(`[TWILIO]    Likely cause 1: Guardian phone = your Twilio FROM number (can't SMS yourself)`);
      console.error(`[TWILIO]    Likely cause 2: Geo-permissions not enabled for this country`);
      console.error(`[TWILIO]    Fix: https://console.twilio.com/us1/develop/sms/settings/geo-permissions`);
      return false; // Don't retry — geo/blacklist issue
    }
    if (code === 30044) {
      console.error(`[TWILIO] ⛔ Error 30044 — Trial message length exceeded for ${to}`);
      console.error(`[TWILIO]    Message body (${body.length} chars) is too long for trial account.`);
      console.error(`[TWILIO]    Fix: shorten SMS or upgrade Twilio account.`);
      return false; // Don't retry — body too long
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return sendSMSWithRetry(to, body, attempt + 1);
    }
    return false;
  }
}

/**
 * Send SOS alert SMS to a single guardian.
 * IMPORTANT: Keep body SHORT — Twilio trial prepends ~53 chars and
 * emojis trigger UCS-2 encoding (70 chars/segment instead of 160).
 * Avoid all Unicode/emoji to stay in GSM-7 encoding.
 */
export async function sendSOSAlert(
  guardianPhone: string,
  userName: string,
  lat: number,
  lng: number,
  evidence?: string[] | string
): Promise<boolean> {
  const hasLocation = typeof lat === "number" && typeof lng === "number" && lat !== 0 && lng !== 0;
  const locationLink = hasLocation ? `https://www.google.com/maps?q=${lat},${lng}` : null;

  // GSM-7 only (no emojis) — keeps each segment at 160 chars
  let body = `EMERGENCY SOS! ${userName} needs help!`;

  if (locationLink) {
    body += `\nLocation: ${locationLink}`;
  }

  // Skip evidence in initial SOS to keep it short; evidence comes in follow-up SMS
  body += `\n-Raksha`;

  console.log(`[TWILIO] Sending SOS SMS to ${guardianPhone} | location=${hasLocation} | len=${body.length}`);
  return sendSMSWithRetry(guardianPhone, body);
}

/**
 * Send SOS cancellation SMS to a guardian (GSM-7 safe, no emojis)
 */
export async function sendSafeSMS(
  guardianPhone: string,
  userName: string
): Promise<boolean> {
  const body = `${userName} is safe. SOS cancelled. -Raksha`;
  return sendSMSWithRetry(guardianPhone, body);
}

/**
 * Send evidence update SMS (GSM-7 safe, no emojis).
 * Keep URL short — Cloudinary URLs can be 80+ chars.
 */
export async function sendEvidenceUpdateSMS(
  guardianPhone: string,
  evidenceUrls: string[]
): Promise<boolean> {
  const urls = (evidenceUrls || []).filter((u) => typeof u === "string" && u.length > 0);
  const body = urls.length > 0
    ? `SOS Evidence:\n${urls[0]}\n-Raksha`
    : `SOS evidence captured. -Raksha`;
  return sendSMSWithRetry(guardianPhone, body);
}

/**
 * Send media follow-up SMS with evidence URL (GSM-7, no emojis).
 * Called after each media upload during an active SOS.
 * IMPORTANT: Twilio trial has segment limits — keep body compact.
 */
export async function sendMediaFollowUpSMS(
  guardianPhone: string,
  userName: string,
  mediaUrl: string,
  lat?: number | null,
  lng?: number | null
): Promise<boolean> {
  const hasLocation = typeof lat === "number" && typeof lng === "number" && lat !== 0 && lng !== 0;

  // Compact body: evidence URL is the priority; location was already in the SOS SMS
  let body = `SOS evidence for ${userName}:`;

  if (mediaUrl) {
    body += `\n${mediaUrl}`;
  }

  if (hasLocation) {
    body += `\nLoc: https://www.google.com/maps?q=${lat},${lng}`;
  }

  body += `\n-Raksha`;

  console.log(`[TWILIO] Sending media follow-up SMS to ${guardianPhone} | len=${body.length}`);
  return sendSMSWithRetry(guardianPhone, body);
}

/**
 * 📞 Make a voice call to a guardian with retry
 */
async function makeCallWithRetry(
  to: string,
  twiml: string,
  attempt = 0
): Promise<string | null> {
  const client = getClient();
  if (!client) {
    console.warn("[TWILIO] Client not initialized, skipping call");
    return null;
  }

  const from = getFromNumber();
  if (!from) {
    console.error("[TWILIO] TWILIO_PHONE_NUMBER not set — cannot make calls");
    return null;
  }

  try {
    const call = await client.calls.create({
      twiml,
      from,
      to,
      timeout: CALL_RING_TIMEOUT_SECONDS,
    });
    console.log(`[TWILIO] ✅ Call initiated to ${to} | SID: ${call.sid} | Status: ${call.status}`);
    return call.sid;
  } catch (err: any) {
    const code = err.code || err.status;
    const detail = err.message || String(err);
    console.error(`[TWILIO] ❌ Call to ${to} failed (attempt ${attempt + 1}) | Code: ${code} | ${detail}`);

    if (code === 21215 || code === 13227) {
      console.error(`[TWILIO] ⚠️  Trial account: ${to} is not a verified number for calls. Verify at https://www.twilio.com/console/phone-numbers/verified`);
      return null; // Don't retry trial limitation
    }
    if (code === 21211) {
      console.error(`[TWILIO] ⛔ Invalid phone number format for calls: ${to}`);
      return null;
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return makeCallWithRetry(to, twiml, attempt + 1);
    }
    return null;
  }
}

/**
 * 📞 Sequential calling of guardian phone numbers.
 * Calls each guardian in order with a buffer between calls.
 */
export async function callGuardiansSequentially(
  guardianPhones: string[],
  userName: string,
  lat: number,
  lng: number
): Promise<{ called: number; answered: string[] }> {
  if (guardianPhones.length === 0) {
    return { called: 0, answered: [] };
  }

  const hasLocation = lat !== 0 && lng !== 0;
  const latSpoken = hasLocation ? lat.toFixed(4).replace(".", " point ") : "unknown";
  const lngSpoken = hasLocation ? lng.toFixed(4).replace(".", " point ") : "unknown";
  const mapsLink = hasLocation ? `https://www.google.com/maps?q=${lat},${lng}` : null;

  const locationText = hasLocation
    ? `Their GPS coordinates are: latitude ${latSpoken}, longitude ${lngSpoken}. A Google Maps link has been sent to your phone via SMS.`
    : `Their exact location is unavailable right now. Please check your SMS for updates.`;

  const twiml = `<Response>
    <Say voice="alice">Emergency S O S alert from Raksha Safety App. ${userName} is in danger and needs help immediately.</Say>
    <Pause length="1"/>
    <Say voice="alice">${locationText}</Say>
    <Pause length="1"/>
    <Say voice="alice">Please respond now. This message will repeat.</Say>
    <Pause length="2"/>
    <Say voice="alice">Emergency alert. ${userName} needs help. Check your S M S for the location link and any captured evidence. Please respond immediately.</Say>
  </Response>`;

  const answered: string[] = [];
  let called = 0;

  for (const phone of guardianPhones) {
    called++;
    console.log(`[TWILIO] Calling ${phone} (${called}/${guardianPhones.length})...`);
    const callSid = await makeCallWithRetry(phone, twiml);

    if (callSid) {
      answered.push(phone);
    } else {
      console.log(`[TWILIO] Call to ${phone} failed — moving to next guardian`);
    }

    // Buffer between calls: 5–7 seconds with jitter
    if (guardianPhones.indexOf(phone) < guardianPhones.length - 1) {
      const jitter =
        CALL_ROTATION_BUFFER_MIN_MS +
        Math.floor(Math.random() * (CALL_ROTATION_BUFFER_MAX_MS - CALL_ROTATION_BUFFER_MIN_MS + 1));
      await new Promise((r) => setTimeout(r, jitter));
    }
  }

  console.log(`[TWILIO] Sequential calling done: ${called} attempted, ${answered.length} placed`);
  return { called, answered };
}

/**
 * 📨 Send SOS SMS to ALL guardian phone numbers (parallel)
 */
export async function sendSOSToAllGuardians(
  guardianPhones: string[],
  userName: string,
  lat: number,
  lng: number,
  evidence?: string[] | string
): Promise<{ sent: number; failed: number }> {
  // Send ALL SMS in parallel — in an emergency every second counts.
  const results = await Promise.allSettled(
    guardianPhones.map(phone => sendSOSAlert(phone, userName, lat, lng, evidence))
  );

  let sent = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) sent++;
    else failed++;
  }

  console.log(`[TWILIO] SMS batch complete: ${sent} sent, ${failed} failed out of ${guardianPhones.length}`);
  return { sent, failed };
}
