BEGIN;
-- Existing projects can have older permissive policies under different names.
-- A restrictive policy intersects their results instead of relying on names.
CREATE OR REPLACE FUNCTION public.caller_can_operate_bookings(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.profiles pr WHERE pr.id=auth.uid() AND (
     (pr.role='manager' AND EXISTS (SELECT 1 FROM public.properties p WHERE p.id=target AND p.owner_id=auth.uid())) OR
     (pr.role='maintenance_staff' AND EXISTS (SELECT 1 FROM public.property_members pm WHERE pm.property_id=target AND pm.user_id=auth.uid() AND pm.membership_role='maintenance_staff' AND pm.can_manage_bookings))
   )
 )
$$;
REVOKE ALL ON FUNCTION public.caller_can_operate_bookings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_can_operate_bookings(UUID) TO authenticated;
DROP POLICY IF EXISTS "Booking participant privacy boundary" ON public.amenity_bookings;
CREATE POLICY "Booking participant privacy boundary" ON public.amenity_bookings
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (user_id=auth.uid() OR public.caller_can_operate_bookings(property_id));
DROP POLICY IF EXISTS "Maintenance participant privacy boundary" ON public.maintenance_requests;
CREATE POLICY "Maintenance participant privacy boundary" ON public.maintenance_requests
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.caller_can_access_maintenance(id));
COMMIT;
