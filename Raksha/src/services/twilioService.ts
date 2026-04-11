import twilio from "twilio";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";

let client: twilio.Twilio | null = null;

if (ACCOUNT_SID && AUTH_TOKEN) {
  client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  console.log("[TWILIO] Client initialized");
} else {
  console.warn("[TWILIO] Credentials not configured — SMS/calls disabled");
}

const MAX_RETRIES = 2;

/**
 * Send SMS to a phone number with retry
 */
async function sendSMSWithRetry(
  to: string,
  body: string,
  attempt = 0
): Promise<boolean> {
  if (!client) {
    console.warn("[TWILIO] Client not initialized, skipping SMS");
    return false;
  }

  try {
    const msg = await client.messages.create({
      body,
      from: FROM_NUMBER,
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
  mediaUrl?: string
): Promise<boolean> {
  const locationLink = `https://www.google.com/maps?q=${lat},${lng}`;
  let body = `🚨 SOS Alert! ${userName} is in danger.\nLocation: ${locationLink}`;
  if (mediaUrl) {
    body += `\nEvidence: ${mediaUrl}`;
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
 * Make a voice call to a guardian with TwiML message
 */
async function makeCallWithRetry(
  to: string,
  twiml: string,
  attempt = 0
): Promise<string | null> {
  if (!client) {
    console.warn("[TWILIO] Client not initialized, skipping call");
    return null;
  }

  try {
    const call = await client.calls.create({
      twiml,
      from: FROM_NUMBER,
      to,
      timeout: 30, // ring for 30 seconds
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

  const locationLink = `https://www.google.com/maps?q=${lat},${lng}`;
  const twiml = `<Response><Say voice="alice">Emergency SOS alert. ${userName} is in danger and needs help. Their location has been sent to your phone. Please check your messages immediately.</Say><Pause length="2"/><Say voice="alice">Repeating. ${userName} has triggered an emergency alert. Location link: ${locationLink}</Say></Response>`;

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

    // Small delay between calls to avoid overwhelming
    if (guardianPhones.indexOf(phone) < guardianPhones.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
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
  mediaUrl?: string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const phone of guardianPhones) {
    const success = await sendSOSAlert(phone, userName, lat, lng, mediaUrl);
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
  mediaUrl: string
): Promise<boolean> {
  const body = `📎 Evidence captured for ${userName}'s SOS alert.\nView: ${mediaUrl}\n\n— Raksha Safety App`;
  return sendSMSWithRetry(guardianPhone, body);
}

