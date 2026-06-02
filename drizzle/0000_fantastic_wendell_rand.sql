-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."action_status" AS ENUM('pending', 'sent', 'completed', 'failed', 'skipped', 'scheduled', 'opened', 'captured', 'verified', 'cancelled', 'firing', 'transcribed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('send_sms', 'deliver_form', 'capture_card', 'send_reminder', 'send_nudge', 'send_session_link', 'send_resource', 'send_proms', 'send_rebooking_nudge', 'verify_contact', 'send_file', 'intake_package', 'intake_reminder', 'add_to_runsheet', 'task');--> statement-breakpoint
CREATE TYPE "public"."appointment_modality" AS ENUM('telehealth', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."appointment_type_source" AS ENUM('coviu', 'pms');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time');--> statement-breakpoint
CREATE TYPE "public"."onboarding_stage" AS ENUM('not_started', 'test_session_sent', 'call_active', 'call_completed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."pms_connection_status" AS ENUM('connected', 'skipped', 'pending');--> statement-breakpoint
CREATE TYPE "public"."pms_provider" AS ENUM('cliniko', 'halaxy', 'nookal', 'power_diary', 'gentu');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('clinical', 'reception', 'shared', 'triage');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('queued', 'waiting', 'checked_in', 'in_session', 'complete', 'done');--> statement-breakpoint
CREATE TYPE "public"."stripe_connection_status" AS ENUM('connected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."stripe_routing" AS ENUM('location', 'clinician');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('practice_manager', 'receptionist', 'clinician', 'clinic_owner');--> statement-breakpoint
CREATE TYPE "public"."workflow_direction" AS ENUM('pre_appointment', 'post_appointment');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('active', 'complete', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_template_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."workflow_terminal_type" AS ENUM('run_sheet', 'collection_only');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid,
	"clinician_id" uuid,
	"appointment_type_id" uuid,
	"room_id" uuid,
	"location_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"phone_number" text,
	"pms_external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tier" text DEFAULT 'core' NOT NULL,
	"logo_url" text,
	"stripe_routing" "stripe_routing" DEFAULT 'location' NOT NULL,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_key" UNIQUE("slug"),
	CONSTRAINT "organisations_tier_check" CHECK (tier = ANY (ARRAY['core'::text, 'complete'::text]))
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"qr_token" text DEFAULT (gen_random_uuid()),
	"stripe_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_qr_token_key" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"room_type" "room_type" DEFAULT 'clinical' NOT NULL,
	"link_token" text DEFAULT (gen_random_uuid()),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"payments_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_link_token_key" UNIQUE("link_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"avatar_url" text,
	"onboarding_stage" "onboarding_stage" DEFAULT 'not_started' NOT NULL,
	"has_seen_patient_journey" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"stripe_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_assignments_user_id_location_id_key" UNIQUE("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "clinician_room_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_assignment_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinician_room_assignments_staff_assignment_id_room_id_key" UNIQUE("staff_assignment_id","room_id")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_phone_numbers_patient_id_phone_number_key" UNIQUE("patient_id","phone_number")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"card_last_four" text NOT NULL,
	"card_brand" text NOT NULL,
	"card_expiry" text,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"modality" "appointment_modality" DEFAULT 'telehealth' NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"default_fee_cents" integer DEFAULT 0 NOT NULL,
	"pms_external_id" text,
	"source" "appointment_type_source" DEFAULT 'coviu' NOT NULL,
	"pms_provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid,
	"room_id" uuid,
	"location_id" uuid NOT NULL,
	"status" "session_status" DEFAULT 'queued' NOT NULL,
	"entry_token" text DEFAULT (gen_random_uuid()),
	"video_call_id" text,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"notification_sent_at" timestamp with time zone,
	"patient_arrived" boolean DEFAULT false NOT NULL,
	"patient_arrived_at" timestamp with time zone,
	"session_started_at" timestamp with time zone,
	"session_ended_at" timestamp with time zone,
	"invite_sent" boolean DEFAULT false NOT NULL,
	"invite_sent_at" timestamp with time zone,
	"prep_completed" boolean DEFAULT false NOT NULL,
	"card_captured" boolean DEFAULT false NOT NULL,
	"device_tested" boolean DEFAULT false NOT NULL,
	"outcome_pathway_id" uuid,
	"is_onboarding_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_entry_token_key" UNIQUE("entry_token")
);
--> statement-breakpoint
CREATE TABLE "phone_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"role" text DEFAULT 'patient' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_participants_session_id_patient_id_key" UNIQUE("session_id","patient_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid,
	"session_id" uuid,
	"patient_id" uuid,
	"amount_cents" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_platform_demo" boolean DEFAULT false NOT NULL,
	"public_token" text DEFAULT (gen_random_uuid()) NOT NULL,
	"public_token_rotated_at" timestamp with time zone,
	"public_token_rotated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forms_public_token_key" UNIQUE("public_token"),
	CONSTRAINT "forms_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"field_type" text NOT NULL,
	"label" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submission_source" text DEFAULT 'entry_flow' NOT NULL,
	"review_status" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_submissions_submission_source_check" CHECK (submission_source = ANY (ARRAY['entry_flow'::text, 'standalone_public'::text, 'standalone_sms'::text, 'standalone_qr'::text])),
	CONSTRAINT "form_submissions_source_review_consistency" CHECK (((submission_source = 'entry_flow'::text) AND (review_status IS NULL)) OR ((submission_source <> 'entry_flow'::text) AND (review_status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'archived'::text])))),
	CONSTRAINT "form_submissions_standalone_no_appointment" CHECK ((submission_source = 'entry_flow'::text) OR (appointment_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "form_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"appointment_id" uuid,
	"patient_id" uuid NOT NULL,
	"token" text DEFAULT (gen_random_uuid()) NOT NULL,
	"schema_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_assignments_token_key" UNIQUE("token"),
	CONSTRAINT "form_assignments_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'opened'::text, 'completed'::text]))
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"direction" "workflow_direction" NOT NULL,
	"status" "workflow_template_status" DEFAULT 'draft' NOT NULL,
	"terminal_type" "workflow_terminal_type" DEFAULT 'run_sheet' NOT NULL,
	"at_risk_after_days" integer,
	"overdue_after_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_action_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"action_type" "action_type" NOT NULL,
	"offset_minutes" integer DEFAULT 0 NOT NULL,
	"offset_direction" text DEFAULT 'before' NOT NULL,
	"modality_filter" "appointment_modality",
	"form_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"precondition" jsonb,
	"parent_action_block_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_action_blocks_offset_direction_check" CHECK (offset_direction = ANY (ARRAY['before'::text, 'after'::text]))
);
--> statement-breakpoint
CREATE TABLE "type_workflow_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"direction" "workflow_direction" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "type_workflow_links_appointment_type_id_template_id_direction_k" UNIQUE("appointment_type_id","workflow_template_id","direction")
);
--> statement-breakpoint
CREATE TABLE "outcome_pathways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"workflow_template_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"direction" "workflow_direction" NOT NULL,
	"status" "workflow_run_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"action_block_id" uuid NOT NULL,
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"workflow_run_id" uuid,
	"fired_at" timestamp with time zone,
	"error_message" text,
	"session_id" uuid,
	"config" jsonb,
	"form_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_package_journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid,
	"journey_token" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"includes_card_capture" boolean DEFAULT false NOT NULL,
	"includes_consent" boolean DEFAULT false NOT NULL,
	"form_ids" uuid[] DEFAULT '{""}' NOT NULL,
	"card_captured_at" timestamp with time zone,
	"consent_completed_at" timestamp with time zone,
	"forms_completed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "intake_package_journeys_journey_token_key" UNIQUE("journey_token")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"storage_path" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"uploaded_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"session_id" uuid,
	"token" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_deliveries_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "pms_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "pms_provider" NOT NULL,
	"status" "pms_connection_status" NOT NULL,
	"imported_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_connections_org_id_key" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" "stripe_connection_status" NOT NULL,
	"stripe_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_connections_org_id_key" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_appointment_type_id_fkey" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinician_room_assignments" ADD CONSTRAINT "clinician_room_assignments_staff_assignment_id_fkey" FOREIGN KEY ("staff_assignment_id") REFERENCES "public"."staff_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinician_room_assignments" ADD CONSTRAINT "clinician_room_assignments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_phone_numbers" ADD CONSTRAINT "patient_phone_numbers_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_outcome_pathway_id_fkey" FOREIGN KEY ("outcome_pathway_id") REFERENCES "public"."outcome_pathways"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_public_token_rotated_by_fkey" FOREIGN KEY ("public_token_rotated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_blocks" ADD CONSTRAINT "workflow_action_blocks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_blocks" ADD CONSTRAINT "workflow_action_blocks_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_blocks" ADD CONSTRAINT "workflow_action_blocks_parent_action_block_id_fkey" FOREIGN KEY ("parent_action_block_id") REFERENCES "public"."workflow_action_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_workflow_links" ADD CONSTRAINT "type_workflow_links_appointment_type_id_fkey" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_workflow_links" ADD CONSTRAINT "type_workflow_links_workflow_template_id_fkey" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_pathways" ADD CONSTRAINT "outcome_pathways_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_pathways" ADD CONSTRAINT "outcome_pathways_workflow_template_id_fkey" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_workflow_runs" ADD CONSTRAINT "appointment_workflow_runs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_workflow_runs" ADD CONSTRAINT "appointment_workflow_runs_workflow_template_id_fkey" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_actions" ADD CONSTRAINT "appointment_actions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_actions" ADD CONSTRAINT "appointment_actions_action_block_id_fkey" FOREIGN KEY ("action_block_id") REFERENCES "public"."workflow_action_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_actions" ADD CONSTRAINT "appointment_actions_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."appointment_workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_actions" ADD CONSTRAINT "appointment_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_actions" ADD CONSTRAINT "appointment_actions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_actions" ADD CONSTRAINT "appointment_actions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_package_journeys" ADD CONSTRAINT "intake_package_journeys_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_package_journeys" ADD CONSTRAINT "intake_package_journeys_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_deliveries" ADD CONSTRAINT "file_deliveries_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_deliveries" ADD CONSTRAINT "file_deliveries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_deliveries" ADD CONSTRAINT "file_deliveries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_connections" ADD CONSTRAINT "pms_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connections" ADD CONSTRAINT "stripe_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointments_clinician_id" ON "appointments" USING btree ("clinician_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointments_created_at" ON "appointments" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_appointments_location_id" ON "appointments" USING btree ("location_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointments_location_scheduled" ON "appointments" USING btree ("location_id" timestamptz_ops,"scheduled_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointments_org_id" ON "appointments" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointments_patient_awaiting" ON "appointments" USING btree ("patient_id" uuid_ops,"created_at" uuid_ops) WHERE ((scheduled_at IS NULL) AND (status <> 'cancelled'::appointment_status));--> statement-breakpoint
CREATE INDEX "idx_appointments_patient_id" ON "appointments" USING btree ("patient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointments_patient_scheduled_active" ON "appointments" USING btree ("patient_id" timestamptz_ops,"scheduled_at" timestamptz_ops) WHERE (status <> 'cancelled'::appointment_status);--> statement-breakpoint
CREATE INDEX "idx_appointments_scheduled_at" ON "appointments" USING btree ("scheduled_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_locations_org_id" ON "locations" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_locations_qr_token" ON "locations" USING btree ("qr_token" text_ops);--> statement-breakpoint
CREATE INDEX "idx_rooms_link_token" ON "rooms" USING btree ("link_token" text_ops);--> statement-breakpoint
CREATE INDEX "idx_rooms_location_id" ON "rooms" USING btree ("location_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_assignments_location_id" ON "staff_assignments" USING btree ("location_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_assignments_user_id" ON "staff_assignments" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_clinician_room_assignments_room" ON "clinician_room_assignments" USING btree ("room_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_clinician_room_assignments_staff" ON "clinician_room_assignments" USING btree ("staff_assignment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_patients_org_id" ON "patients" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_patient_phone_numbers_patient_id" ON "patient_phone_numbers" USING btree ("patient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_patient_phone_numbers_phone" ON "patient_phone_numbers" USING btree ("phone_number" text_ops);--> statement-breakpoint
CREATE INDEX "idx_payment_methods_patient_id" ON "payment_methods" USING btree ("patient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointment_types_org_id" ON "appointment_types" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_appointment_created" ON "sessions" USING btree ("appointment_id" timestamptz_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_appointment_id" ON "sessions" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_entry_token" ON "sessions" USING btree ("entry_token" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_location_created" ON "sessions" USING btree ("location_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_location_id" ON "sessions" USING btree ("location_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_onboarding_demo" ON "sessions" USING btree ("is_onboarding_demo" bool_ops) WHERE (is_onboarding_demo = true);--> statement-breakpoint
CREATE INDEX "idx_sessions_room_id" ON "sessions" USING btree ("room_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_phone_verifications_phone" ON "phone_verifications" USING btree ("phone_number" text_ops);--> statement-breakpoint
CREATE INDEX "idx_phone_verifications_session" ON "phone_verifications" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_participants_patient_id" ON "session_participants" USING btree ("patient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_participants_session_id" ON "session_participants" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_payments_appointment_id" ON "payments" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_payments_patient_id" ON "payments" USING btree ("patient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_payments_session_id" ON "payments" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_forms_org_id" ON "forms" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_forms_platform_demo" ON "forms" USING btree ("org_id" uuid_ops) WHERE (is_platform_demo = false);--> statement-breakpoint
CREATE INDEX "idx_form_fields_form_id" ON "form_fields" USING btree ("form_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_submissions_appointment_created" ON "form_submissions" USING btree ("appointment_id" timestamptz_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_submissions_appointment_id" ON "form_submissions" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_submissions_form_id" ON "form_submissions" USING btree ("form_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_submissions_patient_created" ON "form_submissions" USING btree ("patient_id" timestamptz_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_submissions_patient_id" ON "form_submissions" USING btree ("patient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_submissions_readiness_pending" ON "form_submissions" USING btree ("created_at" timestamptz_ops,"form_id" timestamptz_ops) WHERE ((submission_source <> 'entry_flow'::text) AND (review_status = 'pending'::text));--> statement-breakpoint
CREATE INDEX "idx_form_assignments_appointment_id" ON "form_assignments" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_assignments_form_id" ON "form_assignments" USING btree ("form_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_assignments_patient_created" ON "form_assignments" USING btree ("patient_id" timestamptz_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_assignments_patient_id" ON "form_assignments" USING btree ("patient_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_form_assignments_status" ON "form_assignments" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_form_assignments_token" ON "form_assignments" USING btree ("token" text_ops);--> statement-breakpoint
CREATE INDEX "idx_workflow_templates_org_id" ON "workflow_templates" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_one_intake_package_per_template" ON "workflow_action_blocks" USING btree ("template_id" uuid_ops) WHERE ((action_type = 'intake_package'::action_type) AND (parent_action_block_id IS NULL));--> statement-breakpoint
CREATE INDEX "idx_workflow_action_blocks_parent" ON "workflow_action_blocks" USING btree ("parent_action_block_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_workflow_action_blocks_template_id" ON "workflow_action_blocks" USING btree ("template_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_type_workflow_links_template_id" ON "type_workflow_links" USING btree ("workflow_template_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_type_workflow_links_type_id" ON "type_workflow_links" USING btree ("appointment_type_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "one_pre_workflow_per_type" ON "type_workflow_links" USING btree ("appointment_type_id" uuid_ops) WHERE (direction = 'pre_appointment'::workflow_direction);--> statement-breakpoint
CREATE INDEX "idx_outcome_pathways_active" ON "outcome_pathways" USING btree ("org_id" uuid_ops) WHERE (archived_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_outcome_pathways_org_id" ON "outcome_pathways" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_appointment_id" ON "appointment_workflow_runs" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_status" ON "appointment_workflow_runs" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_template_id" ON "appointment_workflow_runs" USING btree ("workflow_template_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointment_actions_appointment_id" ON "appointment_actions" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_appointment_actions_post_status" ON "appointment_actions" USING btree ("status" timestamptz_ops,"scheduled_for" enum_ops) WHERE (session_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_appointment_actions_scan" ON "appointment_actions" USING btree ("status" enum_ops,"scheduled_for" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_appointment_actions_scheduled_for" ON "appointment_actions" USING btree ("scheduled_for" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_appointment_actions_session" ON "appointment_actions" USING btree ("session_id" uuid_ops) WHERE (session_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_appointment_actions_status" ON "appointment_actions" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_appointment_actions_workflow_run_id" ON "appointment_actions" USING btree ("workflow_run_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_intake_package_journeys_appointment" ON "intake_package_journeys" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_intake_package_journeys_token" ON "intake_package_journeys" USING btree ("journey_token" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_one_journey_per_appointment" ON "intake_package_journeys" USING btree ("appointment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_files_active" ON "files" USING btree ("org_id" uuid_ops) WHERE (archived_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_files_org" ON "files" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_file_deliveries_file" ON "file_deliveries" USING btree ("file_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_file_deliveries_token" ON "file_deliveries" USING btree ("token" text_ops);
*/