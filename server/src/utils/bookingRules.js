import { formatTime } from "../../../shared/time.mjs";
export function isValidDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function isValidTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value);
}

export function toMinutes(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }

  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}

export function timesOverlap(startA, endA, startB, endB) {
  const startAMinutes = toMinutes(startA);
  const endAMinutes = toMinutes(endA);
  const startBMinutes = toMinutes(startB);
  const endBMinutes = toMinutes(endB);

  return startAMinutes < endBMinutes && startBMinutes < endAMinutes;
}

export function validateAmenityBookingRequest({
  bookingDate,
  checkInTime,
  checkOutTime,
  openingTime = "00:00",
  closingTime = "23:59",
  isActive = true,
  minBookingMinutes = 30,
  maxDurationMinutes,
  localNow = { date: new Date().toISOString().slice(0, 10), minutes: new Date().getUTCHours() * 60 + new Date().getUTCMinutes() },
}) {
  if (!bookingDate) {
    return { valid: false, message: "Booking date is required." };
  }

  if (!isValidDate(bookingDate)) {
    return { valid: false, message: "Booking date is invalid." };
  }

  const today = localNow.date;
  if (bookingDate < today) {
    return {
      valid: false,
      message: "Bookings must be made for today or a future date.",
    };
  }

  if (!isActive) {
    return { valid: false, message: "This amenity is currently inactive." };
  }

  if (!checkInTime || !checkOutTime) {
    return {
      valid: false,
      message: "Check-in and check-out times are required.",
    };
  }

  if (!isValidTime(checkInTime) || !isValidTime(checkOutTime)) {
    return { valid: false, message: "Booking times must use valid HH:MM values." };
  }

  if (bookingDate === today && toMinutes(checkInTime) <= localNow.minutes) {
    return { valid: false, message: "The selected slot has already started." };
  }

  if (toMinutes(checkInTime) >= toMinutes(checkOutTime)) {
    return {
      valid: false,
      message: "Check-out time must be after the check-in time.",
    };
  }

  const openMinutes = toMinutes(openingTime);
  const closeMinutes = toMinutes(closingTime);
  const checkInMinutes = toMinutes(checkInTime);
  const checkOutMinutes = toMinutes(checkOutTime);

  if (checkInMinutes < openMinutes || checkOutMinutes > closeMinutes) {
    return {
      valid: false,
      message: `Operating hours are ${formatTime(openingTime)} to ${formatTime(closingTime)}.`,
    };
  }

  const duration = checkOutMinutes - checkInMinutes;
  if (duration < minBookingMinutes) {
    return {
      valid: false,
      message: `Bookings must be at least ${minBookingMinutes} minutes long.`,
    };
  }

  if (maxDurationMinutes && duration > maxDurationMinutes) {
    return {
      valid: false,
      message: `Booking length cannot exceed ${maxDurationMinutes} minutes.`,
    };
  }

  return { valid: true, message: "Booking request is valid." };
}
