-- Apply after schema.sql and role_workflows_migration.sql.
BEGIN;

-- Domain writes go through the authenticated Express API, which checks the
-- stored profile role and property ownership before using its service client.
-- Keep SELECT grants/RLS for private Realtime subscriptions and keep storage
-- uploads enabled through the existing request-participant storage policy.
REVOKE INSERT, UPDATE, DELETE ON public.properties, public.property_members,
  public.tenant_assignments, public.property_units, public.maintenance_requests,
  public.maintenance_comments, public.maintenance_photos, public.amenities,
  public.amenity_bookings, public.booking_disputes, public.activity_events,
  public.notifications FROM anon, authenticated;

-- Avoid properties -> property_members -> properties policy recursion.
-- These functions expose only whether the caller owns or belongs to a property.
CREATE OR REPLACE FUNCTION public.caller_owns_property(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.properties p JOIN public.profiles pr ON pr.id = p.owner_id
  WHERE p.id = target AND p.owner_id = auth.uid() AND pr.role = 'manager'
) $$;
CREATE OR REPLACE FUNCTION public.caller_is_property_member(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.property_members pm
  WHERE pm.property_id = target AND pm.user_id = auth.uid()
) $$;
REVOKE ALL ON FUNCTION public.caller_owns_property(UUID), public.caller_is_property_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_owns_property(UUID), public.caller_is_property_member(UUID) TO authenticated;

DROP POLICY IF EXISTS "Properties are viewable by owners or members" ON public.properties;
CREATE POLICY "Properties are viewable by owners or members" ON public.properties
FOR SELECT TO authenticated USING (
  public.caller_owns_property(id) OR public.caller_is_property_member(id)
);
DROP POLICY IF EXISTS "Members can view property membership" ON public.property_members;
CREATE POLICY "Members can view property membership" ON public.property_members
FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.caller_owns_property(property_id));

-- Cross-table relationships cannot be expressed with a single-column FK.
CREATE OR REPLACE FUNCTION public.validate_workflow_relationships()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.property_units u WHERE u.id = NEW.unit_id AND u.property_id = NEW.property_id
  ) THEN RAISE EXCEPTION 'Unit must belong to the selected property.' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = NEW.tenant_id AND pr.role = 'tenant') THEN
    RAISE EXCEPTION 'A tenant profile is required.' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'maintenance_requests' THEN
    IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles pr JOIN public.property_members pm ON pm.user_id = pr.id
      WHERE pr.id = NEW.assigned_to AND pr.role = 'maintenance_staff'
        AND pm.property_id = NEW.property_id AND pm.membership_role = 'maintenance_staff'
    ) AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.property_id IS DISTINCT FROM OLD.property_id) THEN
      RAISE EXCEPTION 'Assigned staff must belong to this property.' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'completed' AND NULLIF(btrim(NEW.resolution_notes), '') IS NULL THEN
      RAISE EXCEPTION 'Resolution notes are required.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_assignment_relationships ON public.tenant_assignments;
CREATE TRIGGER validate_assignment_relationships BEFORE INSERT OR UPDATE ON public.tenant_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_workflow_relationships();
DROP TRIGGER IF EXISTS validate_maintenance_relationships ON public.maintenance_requests;
CREATE TRIGGER validate_maintenance_relationships BEFORE INSERT OR UPDATE ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION public.validate_workflow_relationships();

CREATE OR REPLACE FUNCTION public.validate_booking_slot()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE a public.amenities; local_now TIMESTAMP; slot_seconds NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.amenity_id, NEW.property_id, NEW.user_id, NEW.booking_date, NEW.check_in_time, NEW.check_out_time)
      IS DISTINCT FROM (OLD.amenity_id, OLD.property_id, OLD.user_id, OLD.booking_date, OLD.check_in_time, OLD.check_out_time) THEN
      RAISE EXCEPTION 'Cancel and rebook to change a reservation.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO a FROM public.amenities WHERE id = NEW.amenity_id FOR SHARE;
  IF a.id IS NULL OR a.property_id <> NEW.property_id OR NOT a.is_active THEN
    RAISE EXCEPTION 'An active amenity at this property is required.' USING ERRCODE = '23514';
  END IF;
  SELECT NOW() AT TIME ZONE p.timezone INTO local_now FROM public.properties p WHERE p.id = NEW.property_id;
  slot_seconds := a.slot_duration_minutes * 60;
  IF slot_seconds IS NULL OR slot_seconds <= 0 OR NEW.status <> 'confirmed'
    OR NEW.checked_in_at IS NOT NULL OR NEW.checked_out_at IS NOT NULL
    OR NEW.booking_date + NEW.check_in_time <= local_now
    OR NEW.check_in_time < a.opening_time OR NEW.check_out_time > a.closing_time
    OR NEW.check_out_time <= NEW.check_in_time
    OR mod(extract(epoch FROM (NEW.check_in_time - a.opening_time)), slot_seconds) <> 0
    OR mod(extract(epoch FROM (NEW.check_out_time - NEW.check_in_time)), slot_seconds) <> 0 THEN
    RAISE EXCEPTION 'Booking must use future slots within amenity operating hours.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_booking_slot ON public.amenity_bookings;
CREATE TRIGGER validate_booking_slot BEFORE INSERT OR UPDATE ON public.amenity_bookings
FOR EACH ROW EXECUTE FUNCTION public.validate_booking_slot();

-- Extend the existing publication without recreating tables or channels.
DO $$ DECLARE t TEXT; BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['maintenance_photos', 'amenities', 'property_members'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- Serialize attachment registration for each request, including concurrent uploads.
CREATE OR REPLACE FUNCTION public.limit_maintenance_photos()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.maintenance_requests WHERE id = NEW.request_id FOR UPDATE;
  IF (SELECT count(*) FROM public.maintenance_photos WHERE request_id = NEW.request_id) >= 5 THEN
    RAISE EXCEPTION 'A request can include at most five photos.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS limit_maintenance_photos ON public.maintenance_photos;
CREATE TRIGGER limit_maintenance_photos BEFORE INSERT ON public.maintenance_photos
FOR EACH ROW EXECUTE FUNCTION public.limit_maintenance_photos();

COMMIT;
