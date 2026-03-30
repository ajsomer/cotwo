-- ============================================================================
-- Seed data for development
-- Uses relative timestamps so data is always "today" and fresh.
-- ============================================================================

-- Organisation
INSERT INTO organisations (id, name, slug, tier, timezone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Sunrise Allied Health', 'sunrise-allied', 'complete', 'Australia/Sydney');

-- Location
INSERT INTO locations (id, org_id, name, address, timezone, qr_token, stripe_account_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Bondi Junction Clinic', '123 Oxford St, Bondi Junction NSW 2022', 'Australia/Sydney', 'qr-bondi-junction', 'acct_test_bondi');

-- Rooms (4 rooms at the location)
INSERT INTO rooms (id, location_id, name, room_type, link_token, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'Dr Smith''s Room', 'clinical', 'link-dr-smith', 0),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', 'Dr Nguyen''s Room', 'clinical', 'link-dr-nguyen', 1),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', 'Nurse Room', 'shared', 'link-nurse-room', 2),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000010', 'On-Demand Room', 'triage', 'link-on-demand', 3);

-- Users (create auth users first, then app users)
-- NOTE: In development, create auth users via Supabase dashboard or Auth API.
-- These seed users assume auth.users already exist with these IDs.
-- For the prototype, we'll insert directly and handle auth separately.

-- We skip auth.users insertion (requires Supabase Auth API).
-- Instead, insert into public.users directly. The FK to auth.users is relaxed for seeding.
-- In dev, create matching auth users via the Supabase dashboard.

-- Staff: Receptionist (Sarah) and two Clinicians (Dr Smith, Dr Nguyen)
-- Practice Manager doubles as receptionist for seed purposes.

-- For prototype: disable the FK constraint temporarily for seeding
ALTER TABLE users DISABLE TRIGGER ALL;

INSERT INTO users (id, email, full_name) VALUES
  ('00000000-0000-0000-0000-000000001001', 'sarah@sunrise.com.au', 'Sarah Mitchell'),
  ('00000000-0000-0000-0000-000000001002', 'drsmith@sunrise.com.au', 'Dr James Smith'),
  ('00000000-0000-0000-0000-000000001003', 'drnguyen@sunrise.com.au', 'Dr Lily Nguyen');

ALTER TABLE users ENABLE TRIGGER ALL;

-- Staff assignments
INSERT INTO staff_assignments (id, user_id, location_id, role, employment_type) VALUES
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000010', 'receptionist', 'full_time'),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000010', 'clinician', 'full_time'),
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000010', 'clinician', 'part_time');

-- Clinician room assignments
INSERT INTO clinician_room_assignments (staff_assignment_id, room_id) VALUES
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000100'),  -- Dr Smith -> Dr Smith's Room
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000000101'),  -- Dr Nguyen -> Dr Nguyen's Room
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000000102');  -- Dr Nguyen -> Nurse Room (shared)

-- Appointment types
INSERT INTO appointment_types (id, org_id, name, modality, duration_minutes, default_fee_cents) VALUES
  ('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000000001', 'Initial Consultation', 'telehealth', 45, 15000),
  ('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000001', 'Follow-up', 'telehealth', 20, 8500),
  ('00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000000001', 'Physio Assessment', 'in_person', 60, 12000),
  ('00000000-0000-0000-0000-000000003004', '00000000-0000-0000-0000-000000000001', 'Mental Health Review', 'telehealth', 50, 22000);

-- Patients (6 patients)
INSERT INTO patients (id, org_id, first_name, last_name, date_of_birth) VALUES
  ('00000000-0000-0000-0000-000000004001', '00000000-0000-0000-0000-000000000001', 'Emily', 'Chen', '1992-03-15'),
  ('00000000-0000-0000-0000-000000004002', '00000000-0000-0000-0000-000000000001', 'Marcus', 'Williams', '1985-07-22'),
  ('00000000-0000-0000-0000-000000004003', '00000000-0000-0000-0000-000000000001', 'Sophie', 'Taylor', '1998-11-08'),
  ('00000000-0000-0000-0000-000000004004', '00000000-0000-0000-0000-000000000001', 'David', 'Park', '1976-01-30'),
  ('00000000-0000-0000-0000-000000004005', '00000000-0000-0000-0000-000000000001', 'Olivia', 'Brown', '2001-06-14'),
  ('00000000-0000-0000-0000-000000004006', '00000000-0000-0000-0000-000000000001', 'James', 'Morrison', '1990-09-25');

-- Patient phone numbers
INSERT INTO patient_phone_numbers (patient_id, phone_number, is_primary) VALUES
  ('00000000-0000-0000-0000-000000004001', '+61412345001', true),
  ('00000000-0000-0000-0000-000000004002', '+61412345002', true),
  ('00000000-0000-0000-0000-000000004003', '+61412345003', true),
  ('00000000-0000-0000-0000-000000004004', '+61412345004', true),
  ('00000000-0000-0000-0000-000000004005', '+61412345005', true),
  ('00000000-0000-0000-0000-000000004006', '+61412345006', true);

-- Payment methods (some patients have cards on file)
INSERT INTO payment_methods (patient_id, stripe_payment_method_id, card_last_four, card_brand, card_expiry, is_default) VALUES
  ('00000000-0000-0000-0000-000000004001', 'pm_test_001', '4242', 'Visa', '12/27', true),
  ('00000000-0000-0000-0000-000000004002', 'pm_test_002', '5555', 'Mastercard', '08/26', true),
  ('00000000-0000-0000-0000-000000004004', 'pm_test_004', '1234', 'Visa', '03/28', true);

-- ============================================================================
-- Appointments & Sessions
-- Uses relative time offsets from now() to create realistic "today" data.
-- ============================================================================

-- Dr Smith's Room: 4 sessions
-- 1. LATE: scheduled 45 min ago, queued, notification sent, patient hasn't arrived
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004001', '00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', now() - interval '45 minutes', '+61412345001');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, notification_sent_at, patient_arrived) VALUES
  ('00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'queued', true, now() - interval '3 hours', false);

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000004001');

-- 2. IN SESSION: started 15 min ago, 20-min follow-up (will become running_over soon)
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004002', '00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', now() - interval '15 minutes', '+61412345002');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at, session_started_at) VALUES
  ('00000000-0000-0000-0000-000000006002', '00000000-0000-0000-0000-000000005002', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'in_session', true, true, now() - interval '20 minutes', now() - interval '15 minutes');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006002', '00000000-0000-0000-0000-000000004002');

-- 3. QUEUED: upcoming session in 1 hour, notification sent
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004003', '00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', now() + interval '1 hour', '+61412345003');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, notification_sent_at, patient_arrived) VALUES
  ('00000000-0000-0000-0000-000000006003', '00000000-0000-0000-0000-000000005003', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'queued', true, now() - interval '2 hours', false);

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006003', '00000000-0000-0000-0000-000000004003');

-- 4. DONE: processed earlier today
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004006', '00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', now() - interval '3 hours', '+61412345006');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at, session_started_at, session_ended_at) VALUES
  ('00000000-0000-0000-0000-000000006004', '00000000-0000-0000-0000-000000005004', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'done', true, true, now() - interval '3 hours 10 minutes', now() - interval '3 hours', now() - interval '2 hours 40 minutes');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006004', '00000000-0000-0000-0000-000000004006');

-- Dr Nguyen's Room: 3 sessions
-- 5. WAITING: patient arrived for telehealth, waiting for clinician to admit
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004004', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000003004', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', now() - interval '5 minutes', '+61412345004');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at) VALUES
  ('00000000-0000-0000-0000-000000006005', '00000000-0000-0000-0000-000000005005', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', 'waiting', true, true, now() - interval '2 minutes');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006005', '00000000-0000-0000-0000-000000004004');

-- 6. COMPLETE: finished, needs processing (payment + outcome)
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005006', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004005', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', now() - interval '1 hour 30 minutes', '+61412345005');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at, session_started_at, session_ended_at) VALUES
  ('00000000-0000-0000-0000-000000006006', '00000000-0000-0000-0000-000000005006', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', 'complete', true, true, now() - interval '1 hour 35 minutes', now() - interval '1 hour 30 minutes', now() - interval '45 minutes');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006006', '00000000-0000-0000-0000-000000004005');

-- 7. QUEUED: later today, notification NOT sent yet (pure queued state)
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005007', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004003', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', now() + interval '3 hours', '+61412345003');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived) VALUES
  ('00000000-0000-0000-0000-000000006007', '00000000-0000-0000-0000-000000005007', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', 'queued', false, false);

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006007', '00000000-0000-0000-0000-000000004003');

-- Nurse Room: 3 sessions
-- 8. CHECKED_IN: in-person patient, checked in via QR
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005008', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004006', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', now() - interval '10 minutes', '+61412345006');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at) VALUES
  ('00000000-0000-0000-0000-000000006008', '00000000-0000-0000-0000-000000005008', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', 'checked_in', true, true, now() - interval '5 minutes');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006008', '00000000-0000-0000-0000-000000004006');

-- 9. IN SESSION: running over (60-min physio started 70 min ago)
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005009', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004001', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', now() - interval '70 minutes', '+61412345001');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at, session_started_at) VALUES
  ('00000000-0000-0000-0000-000000006009', '00000000-0000-0000-0000-000000005009', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', 'in_session', true, true, now() - interval '75 minutes', now() - interval '70 minutes');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006009', '00000000-0000-0000-0000-000000004001');

-- 10. COMPLETE: in-person physio done, needs processing
INSERT INTO appointments (id, org_id, patient_id, clinician_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005010', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004002', '00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', now() - interval '2 hours', '+61412345002');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at, session_started_at, session_ended_at) VALUES
  ('00000000-0000-0000-0000-000000006010', '00000000-0000-0000-0000-000000005010', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', 'complete', true, true, now() - interval '2 hours 10 minutes', now() - interval '2 hours', now() - interval '1 hour');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006010', '00000000-0000-0000-0000-000000004002');

-- On-Demand Room: 2 sessions
-- 11. WAITING: on-demand walk-in, no appointment, telehealth
INSERT INTO sessions (id, room_id, location_id, status, notification_sent, patient_arrived, patient_arrived_at) VALUES
  ('00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000010', 'waiting', false, true, now() - interval '8 minutes');

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000004005');

-- 12. QUEUED: upcoming on-demand, notification sent (upcoming state)
INSERT INTO appointments (id, org_id, patient_id, appointment_type_id, room_id, location_id, scheduled_at, phone_number) VALUES
  ('00000000-0000-0000-0000-000000005012', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000004004', '00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000010', now() + interval '20 minutes', '+61412345004');

INSERT INTO sessions (id, appointment_id, room_id, location_id, status, notification_sent, notification_sent_at, patient_arrived) VALUES
  ('00000000-0000-0000-0000-000000006012', '00000000-0000-0000-0000-000000005012', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000010', 'queued', true, now() - interval '1 hour', false);

INSERT INTO session_participants (session_id, patient_id) VALUES
  ('00000000-0000-0000-0000-000000006012', '00000000-0000-0000-0000-000000004004');

-- Outcome pathways (for Complete tier Process flow)
INSERT INTO outcome_pathways (id, org_id, name, description) VALUES
  ('00000000-0000-0000-0000-000000007001', '00000000-0000-0000-0000-000000000001', 'Standard Follow-up', 'Send follow-up resources and rebooking link in 7 days'),
  ('00000000-0000-0000-0000-000000007002', '00000000-0000-0000-0000-000000000001', 'PROMs Collection', 'Send outcome measures at 2 weeks and 6 weeks post-appointment'),
  ('00000000-0000-0000-0000-000000007003', '00000000-0000-0000-0000-000000000001', 'Discharge', 'No follow-up required. Send discharge summary.');
