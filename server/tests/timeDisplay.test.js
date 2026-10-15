import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatDateTime, localDate, formatMessageTimes } from '../../shared/time.mjs';
import { getAvailableStartTimes } from '../../client/src/lib/amenitySlots.js';

test('clock labels consistently use AM/PM, including noon and midnight', () => {
  for (const [input, expected] of [['00:00', '12:00 AM'], ['09:05:00', '09:05 AM'], ['11:00', '11:00 AM'], ['12:00', '12:00 PM'], ['14:00', '02:00 PM'], ['23:59', '11:59 PM']]) {
    assert.equal(formatTime(input), expected);
  }
  for (const input of [null, '', '24:00', '10:70']) assert.equal(formatTime(input), '—');
});
test('timestamps use explicit AM/PM and the requested timezone', () => {
  assert.match(formatDateTime('2026-10-15T08:30:00Z', 'Asia/Kolkata'), /02:00 PM/);
  assert.equal(localDate('Asia/Kolkata', new Date('2026-10-14T20:00:00Z')), '2026-10-15');
});
const amenity = { is_active: true, opening_time: '09:00:00', closing_time: '13:00:00', slot_duration_minutes: 60 };
test('future dates start at configured opening time, rather than a fixed 11 AM', () => {
  assert.deepEqual(getAvailableStartTimes(amenity, '2026-10-16', [], { date: '2026-10-15', minutes: 620 }), ['09:00', '10:00', '11:00', '12:00']);
});
test('today skips started slots; occupied slots are also excluded', () => {
  assert.deepEqual(getAvailableStartTimes(amenity, '2026-10-15', [], { date: '2026-10-15', minutes: 620 }), ['11:00', '12:00']);
  assert.deepEqual(getAvailableStartTimes(amenity, '2026-10-15', [{ check_in_time: '11:00:00', check_out_time: '12:00:00' }], { date: '2026-10-15', minutes: 620 }), ['12:00']);
});

test('saved notification messages format raw clocks without duplicating AM/PM', () => {
  assert.equal(formatMessageTimes('Gym · 2026-10-15 14:00'), 'Gym · 2026-10-15 02:00 PM');
  assert.equal(formatMessageTimes('Gym · 02:00 PM'), 'Gym · 02:00 PM');
});
