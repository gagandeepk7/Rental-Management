BEGIN;
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key_hash TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS api_rate_limits_expiry ON public.api_rate_limits(reset_at);
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.api_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(bucket_key TEXT, window_seconds INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE counter public.api_rate_limits; now_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF bucket_key !~ '^[a-f0-9]{64}$' OR window_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters.';
  END IF;
  INSERT INTO public.api_rate_limits(key_hash, hits, reset_at)
    VALUES (bucket_key, 1, now_at + make_interval(secs => window_seconds))
  ON CONFLICT (key_hash) DO UPDATE SET
    hits = CASE WHEN api_rate_limits.reset_at <= now_at THEN 1 ELSE api_rate_limits.hits + 1 END,
    reset_at = CASE WHEN api_rate_limits.reset_at <= now_at THEN now_at + make_interval(secs => window_seconds) ELSE api_rate_limits.reset_at END
  RETURNING * INTO counter;
  -- Bound stale rows without running a full cleanup on every request.
  IF random() < 0.01 THEN DELETE FROM public.api_rate_limits WHERE reset_at < now_at - INTERVAL '1 hour'; END IF;
  RETURN jsonb_build_object('total_hits', counter.hits, 'reset_at', counter.reset_at);
END $$;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(TEXT, INTEGER) TO service_role;

-- Participant reads must also work for Realtime and private storage without
-- depending on a chain of table policies that can hide related properties.
CREATE OR REPLACE FUNCTION public.caller_can_access_maintenance(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.maintenance_requests mr
   JOIN public.properties p ON p.id = mr.property_id
   JOIN public.profiles pr ON pr.id = auth.uid()
   WHERE mr.id = target AND (
     (pr.role = 'tenant' AND mr.tenant_id = auth.uid()) OR
     (pr.role = 'maintenance_staff' AND mr.assigned_to = auth.uid()) OR
     (pr.role = 'manager' AND p.owner_id = auth.uid())
   )
 )
$$;
REVOKE ALL ON FUNCTION public.caller_can_access_maintenance(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_can_access_maintenance(UUID) TO authenticated;
DROP POLICY IF EXISTS "Tenants can view their own maintenance requests" ON public.maintenance_requests;
CREATE POLICY "Tenants can view their own maintenance requests" ON public.maintenance_requests
 FOR SELECT TO authenticated USING (public.caller_can_access_maintenance(id));
DROP POLICY IF EXISTS "Related users can view maintenance photos" ON public.maintenance_photos;
CREATE POLICY "Related users can view maintenance photos" ON public.maintenance_photos
 FOR SELECT TO authenticated USING (public.caller_can_access_maintenance(request_id));
DROP POLICY IF EXISTS "Related users can read maintenance photo files" ON storage.objects;
CREATE POLICY "Related users can read maintenance photo files" ON storage.objects
 FOR SELECT TO authenticated USING (
   bucket_id = 'maintenance-photos' AND EXISTS (
     SELECT 1 FROM public.maintenance_requests mr
     WHERE mr.id::text = (storage.foldername(name))[1]
       AND public.caller_can_access_maintenance(mr.id)
   )
 );
GRANT SELECT ON public.maintenance_requests, public.maintenance_photos, public.maintenance_comments,
 public.amenity_bookings, public.notifications, public.activity_events, public.amenities, public.property_members TO authenticated;
DO $$ DECLARE target_table TEXT; BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname='supabase_realtime') THEN
   CREATE PUBLICATION supabase_realtime;
 END IF;
 FOREACH target_table IN ARRAY ARRAY['maintenance_requests','maintenance_comments','maintenance_photos','amenity_bookings','notifications','activity_events','amenities','property_members'] LOOP
   IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=target_table) THEN
     EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target_table);
   END IF;
 END LOOP;
END $$;

-- A service-only read-only diagnostic for schema features inaccessible via REST.
CREATE OR REPLACE FUNCTION public.deployment_security_audit()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT jsonb_build_object(
 'rls', (SELECT jsonb_object_agg(c.relname, c.relrowsecurity) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname = ANY(ARRAY['profiles','properties','property_members','property_units','tenant_assignments','maintenance_requests','maintenance_comments','maintenance_photos','amenities','amenity_bookings','notifications','activity_events','booking_disputes','api_rate_limits'])),
 'constraints', (SELECT COALESCE(jsonb_agg(conname), '[]'::jsonb) FROM pg_catalog.pg_constraint WHERE conname IN ('amenity_bookings_no_overlap','tenant_unit_assignment_no_overlap')),
 'triggers', (SELECT COALESCE(jsonb_agg(t.tgname), '[]'::jsonb) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled <> 'D'),
 'policies', (SELECT COALESCE(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'command',cmd)), '[]'::jsonb) FROM pg_catalog.pg_policies WHERE schemaname='public'),
 'realtime', (SELECT COALESCE(jsonb_agg(tablename), '[]'::jsonb) FROM pg_catalog.pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'),
 'comments_insert_allowed', has_table_privilege('authenticated','public.maintenance_comments','INSERT'),
 'direct_bookings_insert_allowed', has_table_privilege('authenticated','public.amenity_bookings','INSERT'),
 'direct_maintenance_update_allowed', has_table_privilege('authenticated','public.maintenance_requests','UPDATE')
);
$$;
REVOKE ALL ON FUNCTION public.deployment_security_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deployment_security_audit() TO service_role;
COMMIT;
