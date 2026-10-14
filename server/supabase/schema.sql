CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE public.user_role AS ENUM ('tenant', 'manager', 'maintenance_staff');
CREATE TYPE public.request_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE public.request_status AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE public.booking_status AS ENUM ('confirmed', 'cancelled', 'completed');

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role public.user_role NOT NULL DEFAULT 'tenant',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.property_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  membership_role TEXT NOT NULL DEFAULT 'tenant',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, user_id)
);

CREATE TYPE public.assignment_status AS ENUM ('pending', 'active', 'ended');

CREATE TABLE IF NOT EXISTS public.tenant_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  lease_start DATE NOT NULL,
  lease_end DATE,
  status public.assignment_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lease_end IS NULL OR lease_end >= lease_start)
);

CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority public.request_priority NOT NULL DEFAULT 'medium',
  status public.request_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  opening_time TIME NOT NULL DEFAULT '09:00:00',
  closing_time TIME NOT NULL DEFAULT '21:00:00',
  slot_duration_minutes INTEGER DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (slot_duration_minutes > 0),
  CHECK (opening_time < closing_time)
);

CREATE TABLE IF NOT EXISTS public.amenity_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amenity_id UUID NOT NULL REFERENCES public.amenities(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  check_in_time TIME NOT NULL,
  check_out_time TIME NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (check_in_time < check_out_time),
  CHECK (status IN ('confirmed', 'cancelled', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON public.properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_property_members_property_id ON public.property_members(property_id);
CREATE INDEX IF NOT EXISTS idx_property_members_user_id ON public.property_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_assignments_tenant_id ON public.tenant_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_assignments_property_id ON public.tenant_assignments(property_id);
CREATE INDEX IF NOT EXISTS idx_tenant_assignments_status ON public.tenant_assignments(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_property_id ON public.maintenance_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_tenant_id ON public.maintenance_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_status ON public.maintenance_requests(status);
CREATE INDEX IF NOT EXISTS idx_amenities_property_id ON public.amenities(property_id);
CREATE INDEX IF NOT EXISTS idx_amenity_bookings_amenity_id_date ON public.amenity_bookings(amenity_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_amenity_bookings_user_id ON public.amenity_bookings(user_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amenity_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by self only"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Profiles can be updated by self"
  ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id AND role IN ('tenant','manager','maintenance_staff'));

CREATE POLICY "Managers can insert their own profile record"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Properties are viewable by owners or members"
  ON public.properties FOR SELECT
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.property_members pm
      WHERE pm.property_id = properties.id AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage their properties"
  ON public.properties FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Managers can update properties they own"
  ON public.properties FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Members can view property membership"
  ON public.property_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_members.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners or managers may add members"
  ON public.property_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_members.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Tenants can view their own assignments"
  ON public.tenant_assignments FOR SELECT
  USING (tenant_id = auth.uid());

CREATE POLICY "Managers can view assignments for their properties"
  ON public.tenant_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_assignments.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create assignments for their properties"
  ON public.tenant_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_assignments.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Managers can update assignments for their properties"
  ON public.tenant_assignments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_assignments.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Tenants can view their own maintenance requests"
  ON public.maintenance_requests FOR SELECT
  USING (
    tenant_id = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = maintenance_requests.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Tenants can create maintenance requests for their active rental"
  ON public.maintenance_requests FOR INSERT
  WITH CHECK (
    tenant_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_assignments ta
      WHERE ta.tenant_id = maintenance_requests.tenant_id
        AND ta.property_id = maintenance_requests.property_id
        AND ta.status IN ('pending', 'active')
        AND (ta.lease_end IS NULL OR ta.lease_end >= CURRENT_DATE)
    )
  );

CREATE POLICY "Request owners can update their own request"
  ON public.maintenance_requests FOR UPDATE
  USING (
    tenant_id = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = maintenance_requests.property_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Amenities are viewable to authorized users"
  ON public.amenities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = amenities.property_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.property_members pm
          WHERE pm.property_id = amenities.property_id AND pm.user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Managers can manage amenities under their properties"
  ON public.amenities FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = amenities.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Managers can update amenities"
  ON public.amenities FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = amenities.property_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Bookings are viewable by owner or related property members"
  ON public.amenity_bookings FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = amenity_bookings.property_id AND p.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.property_members pm
      WHERE pm.property_id = amenity_bookings.property_id AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Tenants can create bookings for themselves"
  ON public.amenity_bookings FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can cancel or update their own bookings"
  ON public.amenity_bookings FOR UPDATE
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = amenity_bookings.property_id AND p.owner_id = auth.uid()
  ));

ALTER TABLE public.amenity_bookings
  ADD CONSTRAINT amenity_bookings_no_overlap
  EXCLUDE USING GIST (
    amenity_id WITH =,
    booking_date WITH =,
    tsrange(
      (booking_date + check_in_time)::timestamp,
      (booking_date + check_out_time)::timestamp,
      '[)'
    ) WITH &&
  ) WHERE (status = 'confirmed');
