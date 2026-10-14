import { Link } from 'react-router-dom';
import { BellRing, CheckCircle2, ShieldCheck, Wrench } from 'lucide-react';

export default function DashboardPage({ dashboard, maintenance, bookings, profile }) {
  const stats = profile.role === 'manager' ? [
    { label: 'Managed properties', value: dashboard.propertyCount || 0, icon: ShieldCheck },
    { label: 'Open requests', value: (dashboard.pending || 0) + (dashboard.inProgress || 0), icon: Wrench },
    { label: 'Overdue requests', value: dashboard.overdueMaintenance || 0, icon: BellRing },
    { label: 'Upcoming bookings', value: dashboard.upcomingBookings || 0, icon: CheckCircle2 },
  ] : profile.role === 'maintenance_staff' ? [
    { label: 'Assigned tasks', value: dashboard.totalMaintenance || 0, icon: Wrench },
    { label: 'Pending', value: dashboard.pending || 0, icon: BellRing },
    { label: 'In progress', value: dashboard.inProgress || 0, icon: CheckCircle2 },
    { label: 'Completed', value: dashboard.completed || 0, icon: ShieldCheck },
  ] : [
    { label: 'My requests', value: dashboard.totalMaintenance || 0, icon: Wrench },
    { label: 'Pending', value: dashboard.pending || 0, icon: BellRing },
    { label: 'In progress', value: dashboard.inProgress || 0, icon: CheckCircle2 },
    { label: 'Completed', value: dashboard.completed || 0, icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="stat-card rounded-2xl p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-slate-300">{label}</span>
              <div className="rounded-lg bg-slate-900/70 p-2 text-sky-300"><Icon className="h-4 w-4" /></div>
            </div>
            <p className="text-3xl font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="card rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Recent maintenance</h3>
            <Link to="/maintenance" className="text-sm text-sky-300">View all</Link>
          </div>
          <div className="space-y-3">
            {maintenance.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No maintenance requests logged yet.</div>
            ) : maintenance.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-white">{item.title}</p>
                  <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-sky-200">{item.status}</span>
                </div>
                <p className="mt-2 text-sm text-slate-400">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="card rounded-2xl p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Booking summary</h3>
          <div className="space-y-3">
            <Summary label="Upcoming bookings" value={dashboard.upcomingBookings || 0} />
            <Summary label="Available amenities" value={dashboard.availableAmenities || 0} />
            <Summary label={profile.role === 'manager' ? 'Property bookings' : profile.role === 'maintenance_staff' ? 'Bookings at assigned properties' : 'My bookings'} value={bookings.length || 0} />
          </div>
        </section>
      </div>
      {profile.role === 'manager' && dashboard.activity?.length > 0 && <section className="card rounded-2xl p-5"><h3 className="text-lg font-semibold text-white">Recent activity</h3><div className="mt-3 divide-y divide-slate-800">{dashboard.activity.map((event) => <div key={event.id} className="py-3"><p className="font-medium text-white">{event.action.replaceAll('_', ' ')}</p><p className="text-sm text-slate-400">{event.entity_type} · {new Date(event.created_at).toLocaleString()}</p></div>)}</div></section>}
    </div>
  );
}

function Summary({ label, value }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></div>;
}
