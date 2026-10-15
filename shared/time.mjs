// Clock values stay in property-local HH:MM form for APIs and storage.
export function formatTime(value) {
  const match = typeof value === 'string' && /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '—';
  const hour = Number(match[1]);
  return `${String(hour % 12 || 12).padStart(2, '0')}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function formatDateTime(value, timeZone) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function localDate(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Older saved notification messages may still contain raw HH:MM clocks.
export function formatMessageTimes(value) {
  return String(value || '').replace(/\b([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s*(AM|PM))?\b/gi,
    (match, hour, minute, period) => period ? match : formatTime(`${hour}:${minute}`));
}
