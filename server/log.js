// Dev logging in English. Never pass request bodies, passwords, tokens or credentials here.
const SECRET_KEYS = /pass|token|secret|otp|code|credential|card6|userCode|nationalID|^id$|^num$/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v)]));
  }
  if (typeof value === 'string') return maskDigits(value);
  return value;
}

// Long digit runs (account / card numbers) -> keep the last 4
export function maskDigits(s) {
  return s.replace(/\d[\d -]{5,}\d/g, m => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 6 ? `****${digits.slice(-4)}` : m;
  });
}

export function log(level, message, meta) {
  if (process.env.BALANCER_QUIET) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${maskDigits(message)}`;
  const out = level === 'error' ? console.error : console.log;
  meta === undefined ? out(line) : out(line, JSON.stringify(redact(meta)));
}
