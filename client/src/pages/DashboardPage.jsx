import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, CheckCircle2, ShieldCheck, Wrench } from 'lucide-react';

export default function DashboardPage({ dashboard, maintenance, bookings, profile }) {
  const firstName = profile.full_name?.trim().split(/\s+/)[0] || 'there';
  const isManager = profile.role === 'manager';
  const isStaff = profile.role === 'maintenance_staff';
  const stats = profile.role === 'manager' ? [
    { label: 'Managed properties', value: dashboard.propertyCount || 0, icon: ShieldCheck },
    { label: 'Active units', value: dashboard.unitCount || 0, icon: CheckCircle2 },
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
  const intro = isManager
    ? {
        eyebrow: 'Property management',
        title: 'Your portfolio, in focus.',
        description: 'A clearer view of the properties, requests, and reservations in your care.',
        action: 'Manage properties',
        to: '/manager/properties',
      }
    : isStaff
      ? {
          eyebrow: 'Maintenance operations',
          title: `Good to see you, ${firstName}.`,
          description: 'Your assigned work and its latest progress, all in one place.',
          action: 'View assigned tasks',
          to: '/maintenance',
        }
      : {
          eyebrow: 'Resident workspace',
          title: `Welcome home, ${firstName}.`,
          description: 'Everything you need to care for your home and make the most of your community.',
          action: 'Report an issue',
          to: '/maintenance/new',
        };

  return (
    <div className={`dashboard-page dashboard-page--${profile.role} space-y-6`}>
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">{intro.eyebrow}</p>
          <h1>{intro.title}</h1>
          <p className="dashboard-intro__description">{intro.description}</p>
        </div>
        <Link className="button-primary dashboard-intro__action" to={intro.to}>
          {intro.action}<ArrowRight aria-hidden="true" />
        </Link>
      </section>
      <div className={`grid gap-4 md:grid-cols-2 ${isManager ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="stat-card rounded-2xl p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between">
              <span className="text-sm text-slate-300">{label}</span>
              <div className="rounded-lg bg-slate-900/70 p-2 text-sky-300"><Icon className="h-4 w-4" /></div>
            </div>
            <p className="text-3xl font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="card rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{isStaff ? 'Your active tasks' : 'Recent maintenance'}</h3>
            <Link to="/maintenance" className="text-sm text-sky-300">View all</Link>
          </div>
          <div className="space-y-3">
            {maintenance.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No maintenance requests logged yet.</div>
            ) : maintenance.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium text-white">{item.title}</p>
                  <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-sky-200">{item.status}</span>
                </div>
                <p className="mt-2 text-sm text-slate-400">{item.description}</p>
                {isStaff && <p className="mt-2 text-xs text-sky-200">{item.property?.name || 'Property'} · {item.property?.address || 'Address unavailable'} · {item.unit?.unit_number ? `Unit ${item.unit.unit_number}` : 'Unit not specified'}</p>}
              </div>
            ))}
          </div>
        </section>
        <section className="card rounded-2xl p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">{isManager ? 'Portfolio activity' : isStaff ? 'Today at a glance' : 'Your community'}</h3>
          <div className="space-y-3">
            {!isStaff && <Summary label="Upcoming bookings" value={dashboard.upcomingBookings || 0} />}
            {profile.role === 'tenant' && <Summary label="Available amenities" value={dashboard.availableAmenities || 0} />}
            <Summary label={isManager ? 'Property bookings' : isStaff ? 'Bookings at assigned properties' : 'My bookings'} value={bookings.length || 0} />
            {isStaff && <Summary label="Tasks in progress" value={dashboard.inProgress || 0} />}
            {profile.role === 'tenant' && <Link className="dashboard-community-link" to="/my-property">Explore your property <ArrowRight aria-hidden="true" /></Link>}
            {isManager && <Link className="dashboard-community-link" to="/manager/reports">View operational reports <ArrowRight aria-hidden="true" /></Link>}
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
