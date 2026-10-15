function getLocalDateAndMinutes(timeZone, instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function getBookingTimeState(booking, role, now = new Date()) {
  const localNow = getLocalDateAndMinutes(booking.property?.timezone, now);
  const checkIn = Number(booking.check_in_time?.slice(0, 5).replace(':', ''));
  const checkOut = Number(booking.check_out_time?.slice(0, 5).replace(':', ''));
  const startMinutes = Math.floor(checkIn / 100) * 60 + checkIn % 100;
  const endMinutes = Math.floor(checkOut / 100) * 60 + checkOut % 100;
  const isToday = booking.booking_date === localNow.date;
  const isBeforeToday = booking.booking_date < localNow.date;
  const hasStarted =
    isBeforeToday || (isToday && localNow.minutes >= startMinutes);
  const hasEnded =
    isBeforeToday || (isToday && localNow.minutes >= endMinutes);
  const isConfirmed = booking.status === 'confirmed';
  const isExpired = isConfirmed && hasEnded && !booking.checked_in_at;

  return {
    hasStarted,
    hasEnded,
    isExpired,
    canCheckIn:
      isConfirmed &&
      !booking.checked_in_at &&
      isToday &&
      localNow.minutes >= startMinutes &&
      localNow.minutes < endMinutes,
    canCheckOut:
      isConfirmed && Boolean(booking.checked_in_at) && !booking.checked_out_at,
    canCancel:
      isConfirmed &&
      !booking.checked_in_at &&
      !hasStarted &&
      (role === 'manager' || role === 'tenant'),
  };
}
