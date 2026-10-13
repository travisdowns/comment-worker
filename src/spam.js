const turnstileVerifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies a Cloudflare Turnstile token. Returns null when the token is valid,
 * otherwise a short human readable reason it was rejected.
 */
const checkTurnstile = async (secret, token, remoteIp) => {
  if (!token) {
    return 'turnstile: no token submitted';
  }

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const response = await fetch(turnstileVerifyUrl, { method: 'POST', body });
    const outcome = await response.json();
    if (outcome.success) {
      return null;
    }
    return `turnstile: failed (${(outcome['error-codes'] || []).join(', ') || 'no error codes'})`;
  } catch (error) {
    return `turnstile: verification request failed (${error.message})`;
  }
};

/**
 * Collects the reasons a submission looks like spam. An empty list means nothing
 * looked suspicious. Suspect submissions are still delivered for moderation, just
 * flagged, so a false positive never silently drops a real comment.
 */
const findSpamReasons = async ({ env, honeypotValue, turnstileToken, remoteIp }) => {
  const reasons = [];

  if (honeypotValue) {
    reasons.push('honeypot field was filled in');
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileReason = await checkTurnstile(
      env.TURNSTILE_SECRET_KEY,
      turnstileToken,
      remoteIp
    );
    if (turnstileReason) reasons.push(turnstileReason);
  }

  return reasons;
};

export { findSpamReasons };
