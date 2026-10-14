CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  CREATE TYPE public.assignment_status AS ENUM ('pending', 'active', 'ended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

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

CREATE TABLE IF NOT EXISTS public.property_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_number TEXT NOT NULL,
  bedrooms INTEGER NOT NULL DEFAULT 0 CHECK (bedrooms >= 0),
  bathrooms NUMERIC(3, 1) NOT NULL DEFAULT 1 CHECK (bathrooms >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, unit_number)
);

ALTER TABLE public.tenant_assignments
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.property_units(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_unit_assignment_no_overlap'
      AND conrelid = 'public.tenant_assignments'::regclass
  ) THEN
    ALTER TABLE public.tenant_assignments
      ADD CONSTRAINT tenant_unit_assignment_no_overlap
      EXCLUDE USING gist (
        unit_id WITH =,
        daterange(lease_start, lease_end, '[]') WITH &&
      ) WHERE (unit_id IS NOT NULL AND status IN ('pending', 'active'));
  END IF;
END
$$;

ALTER TABLE public.property_members
  ADD COLUMN IF NOT EXISTS can_manage_bookings BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS booking_cancellation_hours INTEGER NOT NULL DEFAULT 24
  CHECK (booking_cancellation_hours >= 0),
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.property_units(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.maintenance_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.maintenance_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  object_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.booking_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.amenity_bookings(id) ON DELETE CASCADE,
  raised_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  details TEXT NOT NULL CHECK (length(trim(details)) > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.amenity_bookings
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'amenity_bookings_no_overlap'
      AND conrelid = 'public.amenity_bookings'::regclass
  ) THEN
    ALTER TABLE public.amenity_bookings
      ADD CONSTRAINT amenity_bookings_no_overlap
      EXCLUDE USING gist (
        amenity_id WITH =,
        booking_date WITH =,
        tsrange(
          (booking_date + check_in_time)::timestamp,
          (booking_date + check_out_time)::timestamp,
          '[)'
        ) WITH &&
      ) WHERE (status = 'confirmed');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_property_units_property_id
  ON public.property_units(property_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_comments_request_id
  ON public.maintenance_comments(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_maintenance_photos_request_id
  ON public.maintenance_photos(request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_property_created
  ON public.activity_events(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_assigned_to
  ON public.maintenance_requests(assigned_to, status);

ALTER TABLE public.property_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Property members can view units" ON public.property_units;
CREATE POLICY "Property members can view units"
  ON public.property_units FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_units.property_id AND p.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.tenant_assignments ta
      WHERE ta.unit_id = property_units.id AND ta.tenant_id = auth.uid()
        AND ta.status IN ('pending', 'active')
    )
    OR EXISTS (
      SELECT 1 FROM public.property_members pm
      WHERE pm.property_id = property_units.property_id AND pm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers manage property units" ON public.property_units;
CREATE POLICY "Managers manage property units"
  ON public.property_units FOR ALL
  USING (EXISTS (SELECT 1 FROM public.properties p JOIN public.profiles pr ON pr.id = auth.uid() WHERE p.id = property_units.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.properties p JOIN public.profiles pr ON pr.id = auth.uid() WHERE p.id = property_units.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'));

DROP POLICY IF EXISTS "Related users can view maintenance comments" ON public.maintenance_comments;
CREATE POLICY "Related users can view maintenance comments"
  ON public.maintenance_comments FOR SELECT
  USING (
    (NOT is_internal AND EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      WHERE mr.id = maintenance_comments.request_id
        AND (mr.tenant_id = auth.uid() OR mr.assigned_to = auth.uid()
          OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id = mr.property_id AND p.owner_id = auth.uid()))
    ))
    OR EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE mr.id = maintenance_comments.request_id
        AND (mr.assigned_to = auth.uid() OR p.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Related users can add maintenance comments" ON public.maintenance_comments;
CREATE POLICY "Related users can add maintenance comments"
  ON public.maintenance_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE mr.id = maintenance_comments.request_id
        AND (mr.tenant_id = auth.uid() OR mr.assigned_to = auth.uid() OR p.owner_id = auth.uid())
        AND (NOT maintenance_comments.is_internal OR mr.assigned_to = auth.uid() OR p.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Related users can view maintenance photos" ON public.maintenance_photos;
CREATE POLICY "Related users can view maintenance photos"
  ON public.maintenance_photos FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.maintenance_requests mr
    JOIN public.properties p ON p.id = mr.property_id
    WHERE mr.id = maintenance_photos.request_id
      AND (mr.tenant_id = auth.uid() OR mr.assigned_to = auth.uid() OR p.owner_id = auth.uid())
  ));

DROP POLICY IF EXISTS "Request participants can attach photos" ON public.maintenance_photos;
CREATE POLICY "Request participants can attach photos"
  ON public.maintenance_photos FOR INSERT
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.maintenance_requests mr
    JOIN public.properties p ON p.id = mr.property_id
    WHERE mr.id = maintenance_photos.request_id
      AND (mr.tenant_id = auth.uid() OR mr.assigned_to = auth.uid() OR p.owner_id = auth.uid())
  ));

DROP POLICY IF EXISTS "Users can view their notifications" ON public.notifications;
CREATE POLICY "Users can view their notifications"
  ON public.notifications FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can mark their notifications read" ON public.notifications;
CREATE POLICY "Users can mark their notifications read"
  ON public.notifications FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Managers can view property activity" ON public.activity_events;
CREATE POLICY "Managers can view property activity"
  ON public.activity_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = activity_events.property_id AND p.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Booking participants can view disputes" ON public.booking_disputes;
CREATE POLICY "Booking participants can view disputes"
  ON public.booking_disputes FOR SELECT
  USING (
    raised_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.amenity_bookings b
      JOIN public.properties p ON p.id = b.property_id
      WHERE b.id = booking_disputes.booking_id
        AND (b.user_id = auth.uid() OR p.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tenants can open disputes for own bookings" ON public.booking_disputes;
CREATE POLICY "Tenants can open disputes for own bookings"
  ON public.booking_disputes FOR INSERT
  WITH CHECK (raised_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.amenity_bookings b
    WHERE b.id = booking_disputes.booking_id AND b.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Managers can view assignments for their properties" ON public.tenant_assignments;
CREATE POLICY "Managers can view assignments for their properties"
  ON public.tenant_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = tenant_assignments.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ));

DROP POLICY IF EXISTS "Bookings are viewable by owner or related property members" ON public.amenity_bookings;
DROP POLICY IF EXISTS "Bookings are viewable by booking users, managers, or authorized staff" ON public.amenity_bookings;
CREATE POLICY "Bookings are viewable by booking users, managers, or authorized staff"
  ON public.amenity_bookings FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE p.id = amenity_bookings.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
    )
    OR EXISTS (
      SELECT 1 FROM public.property_members pm
      JOIN public.profiles pr ON pr.id = pm.user_id
      WHERE pm.property_id = amenity_bookings.property_id AND pm.user_id = auth.uid()
        AND pm.membership_role = 'maintenance_staff' AND pm.can_manage_bookings = TRUE
        AND pr.role = 'maintenance_staff'
    )
  );

DROP POLICY IF EXISTS "Managers can insert their own profile record" ON public.profiles;

DROP POLICY IF EXISTS "Managers can manage their properties" ON public.properties;
CREATE POLICY "Managers can manage their properties"
  ON public.properties FOR INSERT
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'manager')
  );

DROP POLICY IF EXISTS "Owners or managers may add members" ON public.property_members;
CREATE POLICY "Owners or managers may add members"
  ON public.property_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = property_members.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ));

CREATE INDEX IF NOT EXISTS idx_booking_disputes_booking_status
  ON public.booking_disputes(booking_id, status);

CREATE OR REPLACE FUNCTION public.prevent_untrusted_profile_role_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.role := 'tenant'::public.user_role;
    ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Role changes require a trusted administrator.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_role_changes ON public.profiles;
CREATE TRIGGER prevent_profile_role_changes
BEFORE INSERT OR UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_untrusted_profile_role_changes();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    'tenant'::public.user_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.profiles (id, full_name, role)
SELECT
  users.id,
  COALESCE(users.raw_user_meta_data ->> 'full_name', split_part(users.email, '@', 1)),
  'tenant'::public.user_role
FROM auth.users AS users
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Managers can manage their properties" ON public.properties;
CREATE POLICY "Managers can manage their properties"
  ON public.properties FOR INSERT
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'manager')
  );

DROP POLICY IF EXISTS "Managers can update properties they own" ON public.properties;
CREATE POLICY "Managers can update properties they own"
  ON public.properties FOR UPDATE
  USING (owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'manager'))
  WITH CHECK (owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'manager'));

DROP POLICY IF EXISTS "Owners or managers may add members" ON public.property_members;
CREATE POLICY "Owners or managers may add members"
  ON public.property_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE p.id = property_members.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
    )
  );

DROP POLICY IF EXISTS "Managers can create assignments for their properties" ON public.tenant_assignments;
CREATE POLICY "Managers can create assignments for their properties"
  ON public.tenant_assignments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = tenant_assignments.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ));

DROP POLICY IF EXISTS "Managers can update assignments for their properties" ON public.tenant_assignments;
CREATE POLICY "Managers can update assignments for their properties"
  ON public.tenant_assignments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = tenant_assignments.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = tenant_assignments.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ));

DROP POLICY IF EXISTS "Tenants can create maintenance requests for their active rental" ON public.maintenance_requests;
CREATE POLICY "Tenants can create maintenance requests for their active rental"
  ON public.maintenance_requests FOR INSERT
  WITH CHECK (
    tenant_id = auth.uid()
    AND status = 'pending'
    AND assigned_to IS NULL
    AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'tenant')
    AND EXISTS (
      SELECT 1 FROM public.tenant_assignments ta
      WHERE ta.tenant_id = auth.uid()
        AND ta.property_id = maintenance_requests.property_id
        AND ta.status = 'active'
        AND ta.lease_start <= CURRENT_DATE
        AND (ta.lease_end IS NULL OR ta.lease_end >= CURRENT_DATE)
    )
  );

DROP POLICY IF EXISTS "Request owners can update their own request" ON public.maintenance_requests;
DROP POLICY IF EXISTS "Managers and assigned staff can update maintenance requests" ON public.maintenance_requests;
CREATE POLICY "Managers and assigned staff can update maintenance requests"
  ON public.maintenance_requests FOR UPDATE
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE p.id = maintenance_requests.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
    )
  )
  WITH CHECK (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE p.id = maintenance_requests.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
    )
  );

DROP POLICY IF EXISTS "Managers can manage amenities under their properties" ON public.amenities;
CREATE POLICY "Managers can manage amenities under their properties"
  ON public.amenities FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = amenities.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ));

DROP POLICY IF EXISTS "Managers can update amenities" ON public.amenities;
CREATE POLICY "Managers can update amenities"
  ON public.amenities FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = amenities.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.profiles pr ON pr.id = auth.uid()
    WHERE p.id = amenities.property_id AND p.owner_id = auth.uid() AND pr.role = 'manager'
  ));

DROP POLICY IF EXISTS "Tenants can create bookings for themselves" ON public.amenity_bookings;
DROP POLICY IF EXISTS "Authorized users can create property bookings" ON public.amenity_bookings;
CREATE POLICY "Authorized users can create property bookings"
  ON public.amenity_bookings FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.amenities a
      WHERE a.id = amenity_bookings.amenity_id
        AND a.property_id = amenity_bookings.property_id AND a.is_active
    )
    AND status = 'confirmed'
    AND checked_in_at IS NULL
    AND checked_out_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles pr
        JOIN public.tenant_assignments ta ON ta.tenant_id = pr.id
        WHERE pr.id = auth.uid() AND pr.role = 'tenant'
          AND ta.property_id = amenity_bookings.property_id AND ta.status = 'active'
          AND ta.lease_start <= CURRENT_DATE
          AND (ta.lease_end IS NULL OR ta.lease_end >= CURRENT_DATE)
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles pr
        JOIN public.properties p ON p.owner_id = pr.id
        WHERE pr.id = auth.uid() AND pr.role = 'manager' AND p.id = amenity_bookings.property_id
      )
    )
  );

DROP POLICY IF EXISTS "Users can cancel or update their own bookings" ON public.amenity_bookings;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('maintenance-photos', 'maintenance-photos', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = 10485760;

DROP POLICY IF EXISTS "Related users can read maintenance photo files" ON storage.objects;
CREATE POLICY "Related users can read maintenance photo files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'maintenance-photos' AND EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE mr.id::text = (storage.foldername(name))[1]
        AND (mr.tenant_id = auth.uid() OR mr.assigned_to = auth.uid() OR p.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Request participants can upload maintenance photo files" ON storage.objects;
CREATE POLICY "Request participants can upload maintenance photo files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'maintenance-photos' AND EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE mr.id::text = (storage.foldername(name))[1]
        AND (mr.tenant_id = auth.uid() OR mr.assigned_to = auth.uid() OR p.owner_id = auth.uid())
    )
  );

DO $$
DECLARE
  table_to_add TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_to_add IN ARRAY ARRAY['maintenance_requests', 'maintenance_comments', 'amenity_bookings', 'notifications', 'activity_events'] LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables AS publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = table_to_add
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_to_add);
      END IF;
    END LOOP;
  END IF;
END
$$;
