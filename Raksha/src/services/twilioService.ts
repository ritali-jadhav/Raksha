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

  try {
    const msg = await client.messages.create({
      body,
      from: getFromNumber(),
      to,
    });
    console.log(`[TWILIO] SMS sent to ${to}: ${msg.sid}`);
    return true;
  } catch (err: any) {
    console.error(`[TWILIO] SMS to ${to} failed (attempt ${attempt + 1}):`, err.message);
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return sendSMSWithRetry(to, body, attempt + 1);
    }
    return false;
  }
}

/**
 * Send SOS alert SMS to a single guardian
 */
export async function sendSOSAlert(
  guardianPhone: string,
  userName: string,
  lat: number,
  lng: number,
  evidence?: string[] | string
): Promise<boolean> {
  const timestamp = new Date().toISOString();
  const hasLocation = typeof lat === "number" && typeof lng === "number" && lat !== 0 && lng !== 0;
  const locationLink = hasLocation ? `https://www.google.com/maps?q=${lat},${lng}` : null;

  let body = `🚨 SOS Alert! ${userName} is in danger.\nTime: ${timestamp}`;
  if (locationLink) {
    body += `\nTrack my location: ${locationLink}`;
  } else {
    body += `\nTrack my location: (unavailable)`;
  }

  const evidenceUrls = Array.isArray(evidence)
    ? evidence.filter((u) => typeof u === "string" && u.length > 0)
    : typeof evidence === "string" && evidence.length > 0
      ? [evidence]
      : [];

  if (evidenceUrls.length > 0) {
    body += `\nEvidence: ${evidenceUrls.join(" ")}`;
  }
  body += `\n\n— Raksha Safety App`;

  return sendSMSWithRetry(guardianPhone, body);
}

/**
 * Send SOS cancellation SMS to a guardian
 */
export async function sendSafeSMS(
  guardianPhone: string,
  userName: string
): Promise<boolean> {
  const body = `✅ ${userName} is safe. The SOS alert has been cancelled.\n\n— Raksha Safety App`;
  return sendSMSWithRetry(guardianPhone, body);
}

/**
 * Send SOS evidence update SMS (second stage).
 * Sent after at least one evidence URL is uploaded.
 */
export async function sendEvidenceUpdateSMS(
  guardianPhone: string,
  evidenceUrls: string[]
): Promise<boolean> {
  const urls = (evidenceUrls || []).filter((u) => typeof u === "string" && u.length > 0);
  const body = urls.length > 0
    ? `📎 Evidence captured: ${urls.join(" ")}\n\n— Raksha Safety App`
    : `📎 Evidence captured.\n\n— Raksha Safety App`;
  return sendSMSWithRetry(guardianPhone, body);
}

/**
 * Make a voice call to a guardian with TwiML message
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

  try {
    const call = await client.calls.create({
      twiml,
      from: getFromNumber(),
      to,
      timeout: CALL_RING_TIMEOUT_SECONDS,
    });
    console.log(`[TWILIO] Call initiated to ${to}: ${call.sid}`);
    return call.sid;
  } catch (err: any) {
    console.error(`[TWILIO] Call to ${to} failed (attempt ${attempt + 1}):`, err.message);
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return makeCallWithRetry(to, twiml, attempt + 1);
    }
    return null;
  }
}

/**
 * Sequential calling of guardian phone numbers.
 * Calls each guardian in order. Continues to next if call fails.
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

  // Build spoken coordinates (e.g. "19 point 07 North, 72 point 87 East")
  const latSpoken = lat ? lat.toFixed(4).replace('.', ' point ') : 'unknown';
  const lngSpoken = lng ? lng.toFixed(4).replace('.', ' point ') : 'unknown';
  const hasLocation = lat !== 0 && lng !== 0;

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
    <Say voice="alice">Emergency alert. ${userName} needs help. Check your SMS for the location link and any captured evidence. Please respond immediately.</Say>
  </Response>`;

  const answered: string[] = [];
  let called = 0;

  for (const phone of guardianPhones) {
    called++;
    const callSid = await makeCallWithRetry(phone, twiml);

    if (callSid) {
      answered.push(phone);
      console.log(`[TWILIO] Call placed to ${phone} (SID: ${callSid})`);
    } else {
      console.log(`[TWILIO] Call to ${phone} failed, moving to next guardian`);
    }

    // Buffer between calls: 5–7 seconds
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
 * Send SOS SMS to ALL guardian phone numbers
 */
export async function sendSOSToAllGuardians(
  guardianPhones: string[],
  userName: string,
  lat: number,
  lng: number,
  evidence?: string[] | string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const phone of guardianPhones) {
    const success = await sendSOSAlert(phone, userName, lat, lng, evidence);
    if (success) sent++;
    else failed++;
  }

  console.log(`[TWILIO] SMS batch: ${sent} sent, ${failed} failed out of ${guardianPhones.length}`);
  return { sent, failed };
}

/**
 * Send follow-up SMS with media/evidence link to a guardian.
 * Sent after Cloudinary upload completes (separate from initial SOS SMS).
 */
export async function sendMediaFollowUpSMS(
  guardianPhone: string,
  userName: string,
  mediaUrl: string,
  lat?: number | null,
  lng?: number | null
): Promise<boolean> {
  const hasLocation = lat && lng && (lat !== 0 || lng !== 0);
  const locationLine = hasLocation
    ? `\nLocation: https://www.google.com/maps?q=${lat},${lng}`
    : '';
  const body = `📎 Evidence captured for ${userName}'s SOS alert.${locationLine}\nEvidence: ${mediaUrl}\n\n— Raksha Safety App`;
  return sendSMSWithRetry(guardianPhone, body);
}
