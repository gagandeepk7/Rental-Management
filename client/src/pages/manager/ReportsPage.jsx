
function downloadCsv(fileName, headers, rows) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(quote).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage({ dashboard, maintenance = [], bookings = [] }) {
  const downloadMaintenance = () => downloadCsv('propertyflow-maintenance.csv', ['Title', 'Property', 'Unit', 'Tenant', 'Priority', 'Status', 'Created', 'Due', 'Resolved'], maintenance.map((item) => [item.title, item.property?.name, item.unit?.unit_number, item.tenant?.full_name, item.priority, item.status, item.created_at, item.due_at, item.resolved_at]));
  const downloadBookings = () => downloadCsv('propertyflow-bookings.csv', ['Amenity', 'Property', 'Tenant', 'Date', 'Check in', 'Check out', 'Status', 'Checked in at', 'Checked out at'], bookings.map((item) => [item.amenity?.name, item.property?.name, item.user?.full_name, item.booking_date, item.check_in_time, item.check_out_time, item.status, item.checked_in_at, item.checked_out_at]));

  const openTasks = maintenance.filter((item) => item.status !== 'completed');
  const overdueTasks = openTasks.filter((item) => item.due_at && new Date(item.due_at) < new Date());

  return <div className="space-y-6"><section className="card rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Portfolio reporting</p><h3 className="mt-1 text-xl font-semibold text-white">Operations reports</h3><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Properties" value={dashboard.propertyCount || 0} /><Metric label="Active units" value={dashboard.unitCount || 0} /><Metric label="Open maintenance" value={openTasks.length} /><Metric label="Overdue maintenance" value={overdueTasks.length} /><Metric label="Confirmed bookings" value={bookings.filter((item) => item.status === 'confirmed').length} /></div></section><section className="card rounded-2xl p-5"><h3 className="text-lg font-semibold text-white">Export</h3><p className="mt-1 text-sm text-slate-400">CSV exports include records for your managed properties only.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={downloadMaintenance} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-50">Export maintenance</button><button type="button" onClick={downloadBookings} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-50">Export bookings</button></div></section></div>;
}

function Metric({ label, value }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></div>;
}
