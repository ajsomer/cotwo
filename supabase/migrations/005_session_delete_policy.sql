-- Add missing DELETE policy for sessions.
-- Staff can delete sessions at locations within their organisation.
CREATE POLICY "Staff can delete sessions at their locations"
  ON sessions FOR DELETE
  USING (location_id IN (
    SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Also add DELETE for session_participants (cascades from session delete,
-- but explicit policy needed if deleting participants directly).
CREATE POLICY "Staff can delete session participants"
  ON session_participants FOR DELETE
  USING (session_id IN (
    SELECT id FROM sessions WHERE location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    )
  ));

-- Add DELETE for appointments (session deletion may need to clean up the appointment).
CREATE POLICY "Staff can delete appointments at their locations"
  ON appointments FOR DELETE
  USING (location_id IN (
    SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
  ));
