-- Tenant-to-property assignment workflow migration

CREATE TYPE IF NOT EXISTS public.assignment_status AS ENUM ('pending', 'active', 'ended');

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

CREATE INDEX IF NOT EXISTS idx_tenant_assignments_tenant_id
  ON public.tenant_assignments(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_assignments_property_id
  ON public.tenant_assignments(property_id);

CREATE INDEX IF NOT EXISTS idx_tenant_assignments_status
  ON public.tenant_assignments(status);

ALTER TABLE public.tenant_assignments ENABLE ROW LEVEL SECURITY;

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
    COALESCE((NEW.raw_user_meta_data ->> 'role')::public.user_role, 'tenant'::public.user_role)
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE PROCEDURE public.handle_new_user();

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
