export function minutes(time) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

export function timeValue(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function getAvailableStartTimes(amenity, date, bookings = [], localNow = null) {
  if (!amenity?.is_active || !date) return [];
  const duration = Number(amenity.slot_duration_minutes) || 60;
  if (duration <= 0) return [];
  const available = [];
  for (let start = minutes(amenity.opening_time); start + duration <= minutes(amenity.closing_time); start += duration) {
    const occupied = bookings.some((booking) => start < minutes(booking.check_out_time) && minutes(booking.check_in_time) < start + duration);
    const started = localNow && (date < localNow.date || (date === localNow.date && start <= localNow.minutes));
    if (!occupied && !started) available.push(timeValue(start));
  }
  return available;
}
