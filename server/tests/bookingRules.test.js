import test from "node:test";
import assert from "node:assert/strict";

import {
  timesOverlap,
  validateAmenityBookingRequest,
} from "../src/utils/bookingRules.js";

test("detects overlapping booking intervals", () => {
  assert.equal(timesOverlap("09:00", "10:00", "09:30", "10:30"), true);
  assert.equal(timesOverlap("09:00", "10:00", "10:00", "11:00"), false);
});

test("rejects bookings outside operating hours", () => {
  const result = validateAmenityBookingRequest({
    bookingDate: "2026-10-15",
    checkInTime: "08:00",
    checkOutTime: "09:00",
    openingTime: "09:00",
    closingTime: "21:00",
    isActive: true,
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /Operating hours/i);
});

test("rejects bookings in the past", () => {
  const result = validateAmenityBookingRequest({
    bookingDate: "2020-01-01",
    checkInTime: "10:00",
    checkOutTime: "11:00",
    openingTime: "09:00",
    closingTime: "21:00",
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /future date/i);
});

const futureBooking = {
  bookingDate: "2099-01-01", checkInTime: "10:00", checkOutTime: "11:00",
  openingTime: "09:00:00", closingTime: "21:00:00",
};
for (const bookingDate of ["2099-02-30", "2099-13-01", "2099-1-1", {}, 123]) {
  test(`rejects malformed booking date ${JSON.stringify(bookingDate)}`, () => {
    assert.equal(validateAmenityBookingRequest({ ...futureBooking, bookingDate }).valid, false);
  });
}
for (const checkInTime of ["10:75", "24:00", "-1:00", "10:00:30", {}, "abc"]) {
  test(`rejects malformed booking time ${JSON.stringify(checkInTime)}`, () => {
    assert.equal(validateAmenityBookingRequest({ ...futureBooking, checkInTime }).valid, false);
  });
}
test("uses property-local date and rejects slots that already started", () => {
  const localNow = { date: "2099-01-01", minutes: 610 };
  assert.equal(validateAmenityBookingRequest({ ...futureBooking, localNow }).valid, false);
  assert.equal(validateAmenityBookingRequest({ ...futureBooking, checkInTime: "11:00", checkOutTime: "12:00", localNow }).valid, true);
});
test("honors configured short slots", () => {
  assert.equal(validateAmenityBookingRequest({ ...futureBooking, checkOutTime: "10:15", minBookingMinutes: 15 }).valid, true);
});
