BEGIN;

GRANT INSERT ON public.maintenance_comments TO authenticated;

DROP POLICY IF EXISTS "Related users can add maintenance comments"
  ON public.maintenance_comments;

CREATE POLICY "Related users can add maintenance comments"
  ON public.maintenance_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE mr.id = maintenance_comments.request_id
        AND (
          mr.tenant_id = auth.uid()
          OR mr.assigned_to = auth.uid()
          OR p.owner_id = auth.uid()
        )
        AND (
          NOT maintenance_comments.is_internal
          OR mr.assigned_to = auth.uid()
          OR p.owner_id = auth.uid()
        )
    )
  );

COMMIT;
