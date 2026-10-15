BEGIN;

ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS completion_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_review_notes TEXT;

ALTER TABLE public.maintenance_photos
  ADD COLUMN IF NOT EXISTS is_completion_proof BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
