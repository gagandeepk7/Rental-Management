import test from 'node:test';
import assert from 'node:assert/strict';
import { getBookingTimeState } from '../../client/src/lib/bookingTime.js';

const booking = {
  booking_date: '2026-10-15', check_in_time: '11:00:00', check_out_time: '12:00:00',
  status: 'confirmed', property: { timezone: 'Asia/Kolkata', booking_cancellation_hours: 24 },
};
test('tenant can cancel a future booking even within the old 24-hour cutoff', () => {
  assert.equal(getBookingTimeState(booking, 'tenant', new Date('2026-10-15T05:29:59Z')).canCancel, true);
});
test('cancellation closes at the start and staff cannot cancel', () => {
  assert.equal(getBookingTimeState(booking, 'tenant', new Date('2026-10-15T05:30:00Z')).canCancel, false);
  assert.equal(getBookingTimeState(booking, 'maintenance_staff', new Date('2026-10-15T05:00:00Z')).canCancel, false);
});
test('unused reservation expires exactly at the end in property time', () => {
  assert.equal(getBookingTimeState(booking, 'tenant', new Date('2026-10-15T06:29:59Z')).isExpired, false);
  const state = getBookingTimeState(booking, 'tenant', new Date('2026-10-15T06:30:00Z'));
  assert.equal(state.isExpired, true);
  assert.equal(state.canCancel, false);
  assert.equal(state.canCheckIn, false);
});
test('completed and cancelled bookings keep their final status', () => {
  for (const status of ['completed', 'cancelled']) {
    const state = getBookingTimeState({ ...booking, status }, 'tenant', new Date('2026-10-16T06:30:00Z'));
    assert.equal(state.isExpired, false);
    assert.equal(state.canCancel, false);
  }
});
test('checked-in reservations still allow checkout after their slot ends', () => {
  const state = getBookingTimeState({ ...booking, checked_in_at: '2026-10-15T05:30:00Z' }, 'tenant', new Date('2026-10-16T06:30:00Z'));
  assert.equal(state.isExpired, false);
  assert.equal(state.canCancel, false);
  assert.equal(state.canCheckOut, true);
});
