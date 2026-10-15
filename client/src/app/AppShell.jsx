import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Bell, BellRing, Building2, CalendarRange, ClipboardList, House, LogOut, Menu, UserCircle2, Users, Wrench } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { isSupabaseConfigured, supabase, supabaseUrl } from '../lib/supabase.js';
const TenantManagementPage = lazy(() => import('../pages/manager/TenantManagementPage.jsx'));
const DashboardPage = lazy(() => import('../pages/DashboardPage.jsx'));
const MaintenancePage = lazy(() => import('../pages/maintenance/MaintenancePages.jsx').then((module) => ({ default: module.MaintenancePage })));
const CreateMaintenancePage = lazy(() => import('../pages/maintenance/MaintenancePages.jsx').then((module) => ({ default: module.CreateMaintenancePage })));
const AmenitiesPage = lazy(() => import('../pages/AmenitiesPage.jsx'));
const BookingsPage = lazy(() => import('../pages/BookingsPage.jsx'));
const ProfilePage = lazy(() => import('../pages/ProfilePage.jsx'));
const PropertyManagementPage = lazy(() => import('../pages/manager/PropertyManagementPage.jsx'));
const AmenityManagementPage = lazy(() => import('../pages/manager/AmenityManagementPage.jsx'));
const StaffManagementPage = lazy(() => import('../pages/manager/StaffManagementPage.jsx'));
const ActivityPage = lazy(() => import('../pages/manager/ActivityPage.jsx'));
const NotificationsPage = lazy(() => import('../pages/NotificationsPage.jsx'));
const MyPropertyPage = lazy(() => import('../pages/tenant/MyPropertyPage.jsx'));
const BookingDisputesPage = lazy(() => import('../pages/manager/BookingDisputesPage.jsx'));
const ReportsPage = lazy(() => import('../pages/manager/ReportsPage.jsx'));

const emptyDashboard = { totalMaintenance: 0, pending: 0, inProgress: 0, completed: 0, unitCount: 0, upcomingBookings: 0, availableAmenities: 0 };
const emptyProfile = { full_name: 'Resident', role: 'tenant' };

export default function AppShell({ session, onSignOut }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [profile, setProfile] = useState(null);
  const [maintenance, setMaintenance] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [properties, setProperties] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [staff, setStaff] = useState([]);
  const [staffCapabilities, setStaffCapabilities] = useState([]);

  const refreshDashboard = useCallback(async () => {
    const accessToken = session?.access_token;
    const [profileResponse, dashboardResponse, maintenanceResponse, amenitiesResponse, propertiesResponse, bookingsResponse, notificationResponse, staffResponse, capabilityResponse] = await Promise.all([
      apiFetch('/profile', { method: 'GET' }, accessToken).catch(() => ({ profile: emptyProfile })),
      apiFetch('/dashboard', { method: 'GET' }, accessToken).catch(() => emptyDashboard),
      apiFetch('/maintenance', { method: 'GET' }, accessToken).catch((error) => {
        console.error('Unable to refresh maintenance requests:', error);
        return null;
      }),
      apiFetch('/amenities', { method: 'GET' }, accessToken).catch(() => ({ amenities: [] })),
      apiFetch('/properties', { method: 'GET' }, accessToken).catch(() => ({ properties: [] })),
      apiFetch('/bookings', { method: 'GET' }, accessToken).catch(() => ({ bookings: [] })),
      apiFetch('/notifications', { method: 'GET' }, accessToken).catch(() => ({ notifications: [] })),
      apiFetch('/manager/staff', { method: 'GET' }, accessToken).catch(() => ({ staff: [] })),
      apiFetch('/staff/permissions', { method: 'GET' }, accessToken).catch(() => ({ check_in_property_ids: [] })),
    ]);
    setProfile(profileResponse.profile || emptyProfile);
    setDashboard(dashboardResponse || emptyDashboard);
    if (maintenanceResponse) {
      setMaintenance(maintenanceResponse.maintenanceRequests || []);
    }
    setAmenities(amenitiesResponse.amenities || []);
    setProperties(propertiesResponse.properties || []);
    setBookings(bookingsResponse.bookings || []);
    setNotifications(notificationResponse.notifications || []);
    setStaff(staffResponse.staff || []);
    setStaffCapabilities(capabilityResponse.check_in_property_ids || []);
  }, [session]);

  useEffect(() => {
    let isMounted = true;
    void Promise.resolve().then(() => isMounted && refreshDashboard());
    if (!isSupabaseConfigured || !supabaseUrl) return () => { isMounted = false; };
    const channel = supabase.channel('property-updates');
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_photos' }, () => void refreshDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'amenities' }, () => void refreshDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'property_members' }, () => void refreshDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_requests' }, () => void refreshDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'amenity_bookings' }, () => void refreshDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_comments' }, () => void refreshDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => void refreshDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_events' }, () => void refreshDashboard())
      .subscribe();
    return () => { isMounted = false; void supabase.removeChannel(channel); };
  }, [refreshDashboard]);

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
          <p>Loading your workspace...</p>
        </div>
      </div>
    );
  }

  const isManager = profile.role === 'manager';
  const isStaff = profile.role === 'maintenance_staff';
  const navigation = [
    { to: '/', label: 'Dashboard', icon: House },
    ...(profile.role === 'tenant' ? [{ to: '/my-property', label: 'My property', icon: Building2 }] : []),
    ...(isManager ? [
      { to: '/manager/properties', label: 'Properties and units', icon: Building2 },
      { to: '/tenant-management', label: 'Tenant management', icon: UserCircle2 },
      { to: '/manager/amenities', label: 'Manage amenities', icon: CalendarRange },
      { to: '/manager/staff', label: 'Staff', icon: Users },
      { to: '/manager/disputes', label: 'Booking disputes', icon: BellRing },
      { to: '/manager/reports', label: 'Reports', icon: ClipboardList },
      { to: '/manager/activity', label: 'Activity history', icon: ClipboardList },
    ] : []),
    { to: '/maintenance', label: isStaff ? 'Assigned tasks' : 'Maintenance', icon: Wrench },
    { to: '/amenities', label: 'Amenities', icon: CalendarRange },
    { to: '/bookings', label: isManager ? 'Property bookings' : isStaff ? 'Amenity operations' : 'My bookings', icon: BellRing },
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/profile', label: 'Profile', icon: UserCircle2 },
  ];

  return (
    <BrowserRouter>
      <div className="app-shell min-h-screen text-slate-100">
        <div className="app-frame mx-auto flex max-w-[1600px] gap-6 px-3 py-4 sm:px-6 sm:py-6">
          <aside className="app-sidebar hidden w-64 shrink-0 flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 lg:flex">
            <Link to="/" aria-label="PropertyFlow dashboard" className="app-brand mb-8 flex items-center gap-3">
              <span className="brand-mark"><Building2 className="h-5 w-5" /></span>
              <span><strong>PropertyFlow</strong><small>Residential operations</small></span>
            </Link>
            <p className="sidebar-caption">Your workspace</p>
            <nav className="app-nav space-y-2" aria-label="Workspace navigation">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} end={to === '/'} className="nav-link flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-sm text-slate-300" to={to}><Icon className="h-4 w-4" /> {label}</NavLink>)}</nav>
            <div className="current-user mt-auto rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="sidebar-caption">Signed in as</p><div className="mt-2 flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-white">{profile.full_name}</p><p className="text-xs capitalize text-slate-400">{profile.role.replaceAll('_', ' ')}</p></div><button type="button" aria-label="Sign out" onClick={onSignOut} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800"><LogOut className="h-4 w-4" /></button></div></div>
          </aside>
          <main className="workspace-main min-w-0 flex-1">
            <header className="app-header mb-4 flex flex-col gap-4 rounded-2xl sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between border border-slate-800 bg-slate-900/70 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Link to="/" aria-label="PropertyFlow dashboard" className="brand-mark app-header__brand lg:hidden"><Building2 aria-hidden="true" /></Link>
                <div><p className="text-xs uppercase tracking-[0.2em] text-sky-300">{isManager ? 'Manager workspace' : isStaff ? 'Staff workspace' : 'Resident workspace'}</p><h2 className="mt-1 text-xl font-semibold text-white">Welcome back, {profile.full_name?.split(' ')[0] || 'there'}</h2></div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3"><button type="button" aria-label="Toggle navigation" aria-expanded={mobileNavOpen} aria-controls="mobile-navigation" onClick={() => setMobileNavOpen((open) => !open)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm lg:hidden"><Menu className="h-4 w-4" />Menu</button><Link to="/notifications" aria-label="Notifications" className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-700 p-2 text-slate-200"><Bell className="h-4 w-4" />{notifications.some((item) => !item.read_at) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sky-400" />}</Link><button type="button" onClick={onSignOut} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button></div>
            </header>
            {mobileNavOpen && <nav id="mobile-navigation" aria-label="Mobile navigation" className="mb-4 grid gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:grid-cols-2 lg:hidden">
              {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} end={to === '/'} onClick={() => setMobileNavOpen(false)} className="nav-link flex min-h-11 items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-sm text-slate-300" to={to}><Icon className="h-4 w-4 shrink-0" />{label}</NavLink>)}
            </nav>}
            <Suspense fallback={<div className="card rounded-2xl p-5 text-sm text-slate-300">Loading your workspace…</div>}>
              <Routes>
                <Route path="/" element={<DashboardPage dashboard={dashboard} maintenance={maintenance} bookings={bookings} profile={profile} />} />
                {profile.role === 'tenant' && <Route path="/my-property" element={<MyPropertyPage session={session} />} />}
                {isManager && <Route path="/tenant-management" element={<TenantManagementPage session={session} />} />}
                {isManager && <Route path="/manager/properties" element={<PropertyManagementPage session={session} />} />}
                {isManager && <Route path="/manager/amenities" element={<AmenityManagementPage session={session} />} />}
                {isManager && <Route path="/manager/staff" element={<StaffManagementPage session={session} />} />}
                {isManager && <Route path="/manager/disputes" element={<BookingDisputesPage session={session} />} />}
                {isManager && <Route path="/manager/reports" element={<ReportsPage dashboard={dashboard} maintenance={maintenance} bookings={bookings} />} />}
                {isManager && <Route path="/manager/activity" element={<ActivityPage session={session} />} />}
                <Route path="/maintenance" element={<MaintenancePage maintenance={maintenance} profile={profile} session={session} staff={staff} onRefresh={refreshDashboard} />} />
                {profile.role === 'tenant' ? <Route path="/maintenance/new" element={<CreateMaintenancePage session={session} onRefresh={refreshDashboard} />} /> : <Route path="/maintenance/new" element={<Navigate to="/maintenance" replace />} />}
                <Route path="/amenities" element={<AmenitiesPage session={session} amenities={amenities} properties={properties} onRefresh={refreshDashboard} />} />
                <Route path="/bookings" element={<BookingsPage bookings={bookings} session={session} profile={profile} staffCapabilities={staffCapabilities} onRefresh={refreshDashboard} />} />
                <Route path="/notifications" element={<NotificationsPage session={session} notifications={notifications} onRefresh={refreshDashboard} />} />
                <Route path="/profile" element={<ProfilePage session={session} profile={profile} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
