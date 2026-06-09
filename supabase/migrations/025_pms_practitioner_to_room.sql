-- 025_pms_practitioner_to_room.sql
-- Practitioner mapping now targets a ROOM, not a staff member.
--
-- Cliniko's appointment book has a column per practitioner. What matters for the
-- patient is landing in the right Coviu room (a room already has its clinician).
-- So a synced appointment resolves its room from the practitioner→room mapping,
-- not from the appointment type and not via a staff_assignment.
--
-- Appointment types move fully into Workflows; their PMS link keeps
-- confirmed_modality + sync_enabled (room is no longer on the type).

ALTER TABLE pms_practitioner_links
  DROP CONSTRAINT IF EXISTS pms_practitioner_links_connection_id_staff_assignment_id_key;
ALTER TABLE pms_practitioner_links DROP COLUMN IF EXISTS staff_assignment_id;
ALTER TABLE pms_practitioner_links
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;

-- pms_appointment_type_links.room_id is retained for back-compat but is no
-- longer used to gate sync (room comes from the practitioner). Left in place.
