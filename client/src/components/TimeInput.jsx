// Explicit 12-hour controls avoid browser/OS-dependent native time formatting.
export default function TimeInput({ label, value, onChange, disabled = false }) {
  const [hours, minutes] = value.split(':').map(Number);
  const hour = hours % 12 || 12;
  const period = hours >= 12 ? 'PM' : 'AM';
  const update = (nextHour, nextMinute, nextPeriod) => {
    onChange(`${String(nextHour % 12 + (nextPeriod === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`);
  };
  return <fieldset className="min-w-0 text-sm text-slate-300" disabled={disabled}>
    <legend>{label}</legend>
    <div className="mt-1 grid grid-cols-3 gap-2">
      <select aria-label={`${label} hour`} className="input" value={hour} onChange={(event) => update(Number(event.target.value), minutes, period)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <option key={item} value={item}>{String(item).padStart(2, '0')}</option>)}</select>
      <select aria-label={`${label} minute`} className="input" value={minutes} onChange={(event) => update(hour, Number(event.target.value), period)}>{Array.from({ length: 60 }, (_, index) => index).map((item) => <option key={item} value={item}>{String(item).padStart(2, '0')}</option>)}</select>
      <select aria-label={`${label} AM or PM`} className="input" value={period} onChange={(event) => update(hour, minutes, event.target.value)}><option>AM</option><option>PM</option></select>
    </div>
  </fieldset>;
}
