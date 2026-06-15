import { pgTable, index, foreignKey, uuid, timestamp, text, unique, check, integer, boolean, date, jsonb, uniqueIndex, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const actionStatus = pgEnum("action_status", ['pending', 'sent', 'completed', 'failed', 'skipped', 'scheduled', 'opened', 'captured', 'verified', 'cancelled', 'firing', 'transcribed', 'dropped'])
export const actionType = pgEnum("action_type", ['send_sms', 'deliver_form', 'capture_card', 'send_reminder', 'send_nudge', 'send_session_link', 'send_resource', 'send_proms', 'send_rebooking_nudge', 'verify_contact', 'send_file', 'intake_package', 'intake_reminder', 'add_to_runsheet', 'task'])
export const appointmentModality = pgEnum("appointment_modality", ['telehealth', 'in_person'])
export const appointmentStatus = pgEnum("appointment_status", ['scheduled', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'])
export const appointmentTypeSource = pgEnum("appointment_type_source", ['coviu', 'pms'])
export const employmentType = pgEnum("employment_type", ['full_time', 'part_time'])
export const onboardingStage = pgEnum("onboarding_stage", ['not_started', 'test_session_sent', 'call_active', 'call_completed'])
export const paymentStatus = pgEnum("payment_status", ['pending', 'processing', 'completed', 'failed', 'refunded'])
export const pmsConnectionStatus = pgEnum("pms_connection_status", ['connected', 'skipped', 'pending'])
export const pmsProvider = pgEnum("pms_provider", ['cliniko', 'halaxy', 'nookal', 'power_diary', 'gentu'])
export const roomType = pgEnum("room_type", ['clinical', 'reception', 'shared', 'triage'])
export const sessionStatus = pgEnum("session_status", ['queued', 'waiting', 'checked_in', 'in_session', 'complete', 'done'])
export const stripeConnectionStatus = pgEnum("stripe_connection_status", ['connected', 'skipped'])
export const stripeRouting = pgEnum("stripe_routing", ['location', 'clinician'])
export const userRole = pgEnum("user_role", ['practice_manager', 'receptionist', 'clinician', 'clinic_owner'])
export const workflowDirection = pgEnum("workflow_direction", ['pre_appointment', 'post_appointment'])
export const workflowRunStatus = pgEnum("workflow_run_status", ['active', 'complete', 'cancelled'])
export const workflowTemplateStatus = pgEnum("workflow_template_status", ['draft', 'published', 'archived'])
export const workflowTerminalType = pgEnum("workflow_terminal_type", ['run_sheet', 'collection_only'])


export const appointments = pgTable("appointments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	patientId: uuid("patient_id"),
	clinicianId: uuid("clinician_id"),
	appointmentTypeId: uuid("appointment_type_id"),
	roomId: uuid("room_id"),
	locationId: uuid("location_id").notNull(),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	status: appointmentStatus().default('scheduled').notNull(),
	phoneNumber: text("phone_number"),
	pmsExternalId: text("pms_external_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_appointments_clinician_id").using("btree", table.clinicianId.asc().nullsLast().op("uuid_ops")),
	index("idx_appointments_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_appointments_location_id").using("btree", table.locationId.asc().nullsLast().op("uuid_ops")),
	index("idx_appointments_location_scheduled").using("btree", table.locationId.asc().nullsLast().op("timestamptz_ops"), table.scheduledAt.asc().nullsLast().op("uuid_ops")),
	index("idx_appointments_org_id").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	index("idx_appointments_patient_awaiting").using("btree", table.patientId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")).where(sql`((scheduled_at IS NULL) AND (status <> 'cancelled'::appointment_status))`),
	index("idx_appointments_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_appointments_patient_scheduled_active").using("btree", table.patientId.asc().nullsLast().op("timestamptz_ops"), table.scheduledAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(status <> 'cancelled'::appointment_status)`),
	index("idx_appointments_scheduled_at").using("btree", table.scheduledAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "appointments_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "appointments_patient_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.clinicianId],
			foreignColumns: [users.id],
			name: "appointments_clinician_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.appointmentTypeId],
			foreignColumns: [appointmentTypes.id],
			name: "appointments_appointment_type_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "appointments_room_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.id],
			name: "appointments_location_id_fkey"
		}).onDelete("cascade"),
]);

export const organisations = pgTable("organisations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	tier: text().default('core').notNull(),
	logoUrl: text("logo_url"),
	stripeRouting: stripeRouting("stripe_routing").default('location').notNull(),
	timezone: text().default('Australia/Sydney').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("organisations_slug_key").on(table.slug),
	check("organisations_tier_check", sql`tier = ANY (ARRAY['core'::text, 'complete'::text])`),
]);

export const locations = pgTable("locations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: text().notNull(),
	address: text(),
	timezone: text().default('Australia/Sydney').notNull(),
	qrToken: text("qr_token").default(sql`gen_random_uuid()::text`),
	stripeAccountId: text("stripe_account_id"),
	pmsExternalId: text("pms_external_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_locations_org_id").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	index("idx_locations_qr_token").using("btree", table.qrToken.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "locations_org_id_fkey"
		}).onDelete("cascade"),
	unique("locations_qr_token_key").on(table.qrToken),
]);

export const rooms = pgTable("rooms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	locationId: uuid("location_id").notNull(),
	name: text().notNull(),
	roomType: roomType("room_type").default('clinical').notNull(),
	linkToken: text("link_token").default(sql`gen_random_uuid()::text`),
	sortOrder: integer("sort_order").default(0).notNull(),
	paymentsEnabled: boolean("payments_enabled").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_rooms_link_token").using("btree", table.linkToken.asc().nullsLast().op("text_ops")),
	index("idx_rooms_location_id").using("btree", table.locationId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.id],
			name: "rooms_location_id_fkey"
		}).onDelete("cascade"),
	unique("rooms_link_token_key").on(table.linkToken),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	fullName: text("full_name").notNull(),
	avatarUrl: text("avatar_url"),
	onboardingStage: onboardingStage("onboarding_stage").default('not_started').notNull(),
	hasSeenPatientJourney: boolean("has_seen_patient_journey").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("users_email_key").on(table.email),
]);

export const staffAssignments = pgTable("staff_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	locationId: uuid("location_id").notNull(),
	role: userRole().notNull(),
	employmentType: employmentType("employment_type").default('full_time').notNull(),
	stripeAccountId: text("stripe_account_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_staff_assignments_location_id").using("btree", table.locationId.asc().nullsLast().op("uuid_ops")),
	index("idx_staff_assignments_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "staff_assignments_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.id],
			name: "staff_assignments_location_id_fkey"
		}).onDelete("cascade"),
	unique("staff_assignments_user_id_location_id_key").on(table.userId, table.locationId),
]);

export const clinicianRoomAssignments = pgTable("clinician_room_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	staffAssignmentId: uuid("staff_assignment_id").notNull(),
	roomId: uuid("room_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_clinician_room_assignments_room").using("btree", table.roomId.asc().nullsLast().op("uuid_ops")),
	index("idx_clinician_room_assignments_staff").using("btree", table.staffAssignmentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.staffAssignmentId],
			foreignColumns: [staffAssignments.id],
			name: "clinician_room_assignments_staff_assignment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "clinician_room_assignments_room_id_fkey"
		}).onDelete("cascade"),
	unique("clinician_room_assignments_staff_assignment_id_room_id_key").on(table.staffAssignmentId, table.roomId),
]);

export const patients = pgTable("patients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	firstName: text("first_name").notNull(),
	lastName: text("last_name").notNull(),
	dateOfBirth: date("date_of_birth"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_patients_org_id").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "patients_org_id_fkey"
		}).onDelete("cascade"),
]);

export const patientPhoneNumbers = pgTable("patient_phone_numbers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	patientId: uuid("patient_id").notNull(),
	phoneNumber: text("phone_number").notNull(),
	isPrimary: boolean("is_primary").default(true).notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_patient_phone_numbers_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_patient_phone_numbers_phone").using("btree", table.phoneNumber.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "patient_phone_numbers_patient_id_fkey"
		}).onDelete("cascade"),
	unique("patient_phone_numbers_patient_id_phone_number_key").on(table.patientId, table.phoneNumber),
]);

export const paymentMethods = pgTable("payment_methods", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	patientId: uuid("patient_id").notNull(),
	stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
	cardLastFour: text("card_last_four").notNull(),
	cardBrand: text("card_brand").notNull(),
	cardExpiry: text("card_expiry"),
	isDefault: boolean("is_default").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_payment_methods_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "payment_methods_patient_id_fkey"
		}).onDelete("cascade"),
]);

export const appointmentTypes = pgTable("appointment_types", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: text().notNull(),
	modality: appointmentModality().default('telehealth').notNull(),
	durationMinutes: integer("duration_minutes").default(30).notNull(),
	defaultFeeCents: integer("default_fee_cents").default(0).notNull(),
	pmsExternalId: text("pms_external_id"),
	source: appointmentTypeSource().default('coviu').notNull(),
	pmsProvider: text("pms_provider"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_appointment_types_org_id").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "appointment_types_org_id_fkey"
		}).onDelete("cascade"),
]);

export const sessions = pgTable("sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id"),
	roomId: uuid("room_id"),
	locationId: uuid("location_id").notNull(),
	status: sessionStatus().default('queued').notNull(),
	entryToken: text("entry_token").default(sql`gen_random_uuid()::text`),
	videoCallId: text("video_call_id"),
	notificationSent: boolean("notification_sent").default(false).notNull(),
	notificationSentAt: timestamp("notification_sent_at", { withTimezone: true, mode: 'string' }),
	patientArrived: boolean("patient_arrived").default(false).notNull(),
	patientArrivedAt: timestamp("patient_arrived_at", { withTimezone: true, mode: 'string' }),
	sessionStartedAt: timestamp("session_started_at", { withTimezone: true, mode: 'string' }),
	sessionEndedAt: timestamp("session_ended_at", { withTimezone: true, mode: 'string' }),
	inviteSent: boolean("invite_sent").default(false).notNull(),
	inviteSentAt: timestamp("invite_sent_at", { withTimezone: true, mode: 'string' }),
	prepCompleted: boolean("prep_completed").default(false).notNull(),
	cardCaptured: boolean("card_captured").default(false).notNull(),
	deviceTested: boolean("device_tested").default(false).notNull(),
	outcomePathwayId: uuid("outcome_pathway_id"),
	isOnboardingDemo: boolean("is_onboarding_demo").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_sessions_appointment_created").using("btree", table.appointmentId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_sessions_appointment_id").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_sessions_entry_token").using("btree", table.entryToken.asc().nullsLast().op("text_ops")),
	index("idx_sessions_location_created").using("btree", table.locationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_sessions_location_id").using("btree", table.locationId.asc().nullsLast().op("uuid_ops")),
	index("idx_sessions_onboarding_demo").using("btree", table.isOnboardingDemo.asc().nullsLast().op("bool_ops")).where(sql`(is_onboarding_demo = true)`),
	index("idx_sessions_room_id").using("btree", table.roomId.asc().nullsLast().op("uuid_ops")),
	index("idx_sessions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "sessions_appointment_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "sessions_room_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.id],
			name: "sessions_location_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.outcomePathwayId],
			foreignColumns: [outcomePathways.id],
			name: "sessions_outcome_pathway_id_fkey"
		}),
	unique("sessions_entry_token_key").on(table.entryToken),
]);

export const phoneVerifications = pgTable("phone_verifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	phoneNumber: text("phone_number").notNull(),
	code: text().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	sessionId: uuid("session_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_phone_verifications_phone").using("btree", table.phoneNumber.asc().nullsLast().op("text_ops")),
	index("idx_phone_verifications_session").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "phone_verifications_session_id_fkey"
		}).onDelete("set null"),
]);

export const sessionParticipants = pgTable("session_participants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	role: text().default('patient').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_session_participants_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_session_participants_session_id").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "session_participants_session_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "session_participants_patient_id_fkey"
		}).onDelete("cascade"),
	unique("session_participants_session_id_patient_id_key").on(table.sessionId, table.patientId),
]);

export const payments = pgTable("payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id"),
	sessionId: uuid("session_id"),
	patientId: uuid("patient_id"),
	amountCents: integer("amount_cents").notNull(),
	status: paymentStatus().default('pending').notNull(),
	stripePaymentIntentId: text("stripe_payment_intent_id"),
	stripeAccountId: text("stripe_account_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_payments_appointment_id").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_payments_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_payments_session_id").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "payments_appointment_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "payments_session_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "payments_patient_id_fkey"
		}).onDelete("set null"),
]);

export const forms = pgTable("forms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: text().notNull(),
	description: text(),
	schema: jsonb().default({}).notNull(),
	status: text().default('draft').notNull(),
	isPlatformDemo: boolean("is_platform_demo").default(false).notNull(),
	// NULL = generic form. Set = PMS-bound (its pmsTarget keys belong to this
	// provider's vocabulary; only offered at locations running that PMS). §8.F
	pmsProvider: pmsProvider("pms_provider"),
	publicToken: text("public_token").default(sql`gen_random_uuid()::text`).notNull(),
	publicTokenRotatedAt: timestamp("public_token_rotated_at", { withTimezone: true, mode: 'string' }),
	publicTokenRotatedBy: uuid("public_token_rotated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_forms_org_id").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	index("idx_forms_platform_demo").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(is_platform_demo = false)`),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "forms_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.publicTokenRotatedBy],
			foreignColumns: [users.id],
			name: "forms_public_token_rotated_by_fkey"
		}).onDelete("set null"),
	unique("forms_public_token_key").on(table.publicToken),
	check("forms_status_check", sql`status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])`),
]);

export const formFields = pgTable("form_fields", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	formId: uuid("form_id").notNull(),
	fieldType: text("field_type").notNull(),
	label: text().notNull(),
	isRequired: boolean("is_required").default(false).notNull(),
	options: jsonb(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_form_fields_form_id").using("btree", table.formId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "form_fields_form_id_fkey"
		}).onDelete("cascade"),
]);

export const formSubmissions = pgTable("form_submissions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	formId: uuid("form_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	appointmentId: uuid("appointment_id"),
	responses: jsonb().default({}).notNull(),
	submissionSource: text("submission_source").default('entry_flow').notNull(),
	reviewStatus: text("review_status"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	reviewedBy: uuid("reviewed_by"),
	// PMS write-back roll-up (per-field detail lives in pms_push_field_results). §8.G
	pmsExternalId: text("pms_external_id"),
	pmsPushStatus: text("pms_push_status"),
	pmsPushedAt: timestamp("pms_pushed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_form_submissions_appointment_created").using("btree", table.appointmentId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_form_submissions_appointment_id").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_form_submissions_form_id").using("btree", table.formId.asc().nullsLast().op("uuid_ops")),
	index("idx_form_submissions_patient_created").using("btree", table.patientId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_form_submissions_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_form_submissions_readiness_pending").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops"), table.formId.asc().nullsLast().op("timestamptz_ops")).where(sql`((submission_source <> 'entry_flow'::text) AND (review_status = 'pending'::text))`),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "form_submissions_form_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "form_submissions_patient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "form_submissions_appointment_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "form_submissions_reviewed_by_fkey"
		}).onDelete("set null"),
	check("form_submissions_submission_source_check", sql`submission_source = ANY (ARRAY['entry_flow'::text, 'standalone_public'::text, 'standalone_sms'::text, 'standalone_qr'::text])`),
	check("form_submissions_source_review_consistency", sql`((submission_source = 'entry_flow'::text) AND (review_status IS NULL)) OR ((submission_source <> 'entry_flow'::text) AND (review_status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'archived'::text])))`),
	check("form_submissions_standalone_no_appointment", sql`(submission_source = 'entry_flow'::text) OR (appointment_id IS NULL)`),
]);

export const formAssignments = pgTable("form_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	formId: uuid("form_id").notNull(),
	appointmentId: uuid("appointment_id"),
	patientId: uuid("patient_id").notNull(),
	token: text().default(sql`gen_random_uuid()::text`).notNull(),
	schemaSnapshot: jsonb("schema_snapshot").default({}).notNull(),
	status: text().default('pending').notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	submissionId: uuid("submission_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_form_assignments_appointment_id").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_form_assignments_form_id").using("btree", table.formId.asc().nullsLast().op("uuid_ops")),
	index("idx_form_assignments_patient_created").using("btree", table.patientId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_form_assignments_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_form_assignments_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_form_assignments_token").using("btree", table.token.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "form_assignments_form_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "form_assignments_appointment_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "form_assignments_patient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [formSubmissions.id],
			name: "form_assignments_submission_id_fkey"
		}).onDelete("set null"),
	unique("form_assignments_token_key").on(table.token),
	check("form_assignments_status_check", sql`status = ANY (ARRAY['pending'::text, 'sent'::text, 'opened'::text, 'completed'::text])`),
]);

export const workflowTemplates = pgTable("workflow_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: text().notNull(),
	description: text(),
	direction: workflowDirection().notNull(),
	status: workflowTemplateStatus().default('draft').notNull(),
	terminalType: workflowTerminalType("terminal_type").default('run_sheet').notNull(),
	atRiskAfterDays: integer("at_risk_after_days"),
	overdueAfterDays: integer("overdue_after_days"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_workflow_templates_org_id").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "workflow_templates_org_id_fkey"
		}).onDelete("cascade"),
]);

export const workflowActionBlocks = pgTable("workflow_action_blocks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	templateId: uuid("template_id").notNull(),
	actionType: actionType("action_type").notNull(),
	offsetMinutes: integer("offset_minutes").default(0).notNull(),
	offsetDirection: text("offset_direction").default('before').notNull(),
	modalityFilter: appointmentModality("modality_filter"),
	formId: uuid("form_id"),
	config: jsonb().default({}).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	precondition: jsonb(),
	parentActionBlockId: uuid("parent_action_block_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("idx_one_intake_package_per_template").using("btree", table.templateId.asc().nullsLast().op("uuid_ops")).where(sql`((action_type = 'intake_package'::action_type) AND (parent_action_block_id IS NULL))`),
	index("idx_workflow_action_blocks_parent").using("btree", table.parentActionBlockId.asc().nullsLast().op("uuid_ops")),
	index("idx_workflow_action_blocks_template_id").using("btree", table.templateId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [workflowTemplates.id],
			name: "workflow_action_blocks_template_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "workflow_action_blocks_form_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.parentActionBlockId],
			foreignColumns: [table.id],
			name: "workflow_action_blocks_parent_action_block_id_fkey"
		}).onDelete("cascade"),
	check("workflow_action_blocks_offset_direction_check", sql`offset_direction = ANY (ARRAY['before'::text, 'after'::text])`),
]);

export const typeWorkflowLinks = pgTable("type_workflow_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentTypeId: uuid("appointment_type_id").notNull(),
	workflowTemplateId: uuid("workflow_template_id").notNull(),
	direction: workflowDirection().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_type_workflow_links_template_id").using("btree", table.workflowTemplateId.asc().nullsLast().op("uuid_ops")),
	index("idx_type_workflow_links_type_id").using("btree", table.appointmentTypeId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("one_pre_workflow_per_type").using("btree", table.appointmentTypeId.asc().nullsLast().op("uuid_ops")).where(sql`(direction = 'pre_appointment'::workflow_direction)`),
	foreignKey({
			columns: [table.appointmentTypeId],
			foreignColumns: [appointmentTypes.id],
			name: "type_workflow_links_appointment_type_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workflowTemplateId],
			foreignColumns: [workflowTemplates.id],
			name: "type_workflow_links_workflow_template_id_fkey"
		}).onDelete("cascade"),
	unique("type_workflow_links_appointment_type_id_template_id_direction_k").on(table.appointmentTypeId, table.workflowTemplateId, table.direction),
]);

export const outcomePathways = pgTable("outcome_pathways", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: text().notNull(),
	description: text(),
	workflowTemplateId: uuid("workflow_template_id"),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_outcome_pathways_active").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(archived_at IS NULL)`),
	index("idx_outcome_pathways_org_id").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "outcome_pathways_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workflowTemplateId],
			foreignColumns: [workflowTemplates.id],
			name: "outcome_pathways_workflow_template_id_fkey"
		}).onDelete("set null"),
]);

export const appointmentWorkflowRuns = pgTable("appointment_workflow_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	workflowTemplateId: uuid("workflow_template_id").notNull(),
	direction: workflowDirection().notNull(),
	status: workflowRunStatus().default('active').notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_workflow_runs_appointment_id").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_workflow_runs_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_workflow_runs_template_id").using("btree", table.workflowTemplateId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "appointment_workflow_runs_appointment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workflowTemplateId],
			foreignColumns: [workflowTemplates.id],
			name: "appointment_workflow_runs_workflow_template_id_fkey"
		}).onDelete("cascade"),
]);

export const appointmentActions = pgTable("appointment_actions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	actionBlockId: uuid("action_block_id").notNull(),
	status: actionStatus().default('pending').notNull(),
	scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: 'string' }).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	result: jsonb(),
	workflowRunId: uuid("workflow_run_id"),
	firedAt: timestamp("fired_at", { withTimezone: true, mode: 'string' }),
	errorMessage: text("error_message"),
	sessionId: uuid("session_id"),
	config: jsonb(),
	formId: uuid("form_id"),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	resolvedBy: uuid("resolved_by"),
	resolutionNote: text("resolution_note"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_appointment_actions_appointment_id").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_appointment_actions_post_status").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.scheduledFor.asc().nullsLast().op("enum_ops")).where(sql`(session_id IS NOT NULL)`),
	index("idx_appointment_actions_scan").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.scheduledFor.asc().nullsLast().op("enum_ops")),
	index("idx_appointment_actions_scheduled_for").using("btree", table.scheduledFor.asc().nullsLast().op("timestamptz_ops")),
	index("idx_appointment_actions_session").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")).where(sql`(session_id IS NOT NULL)`),
	index("idx_appointment_actions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_appointment_actions_workflow_run_id").using("btree", table.workflowRunId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "appointment_actions_appointment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actionBlockId],
			foreignColumns: [workflowActionBlocks.id],
			name: "appointment_actions_action_block_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workflowRunId],
			foreignColumns: [appointmentWorkflowRuns.id],
			name: "appointment_actions_workflow_run_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "appointment_actions_session_id_fkey"
		}),
	foreignKey({
			columns: [table.formId],
			foreignColumns: [forms.id],
			name: "appointment_actions_form_id_fkey"
		}),
	foreignKey({
			columns: [table.resolvedBy],
			foreignColumns: [users.id],
			name: "appointment_actions_resolved_by_fkey"
		}),
]);

export const intakePackageJourneys = pgTable("intake_package_journeys", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	patientId: uuid("patient_id"),
	journeyToken: text("journey_token").notNull(),
	status: text().default('in_progress').notNull(),
	includesCardCapture: boolean("includes_card_capture").default(false).notNull(),
	includesConsent: boolean("includes_consent").default(false).notNull(),
	formIds: uuid("form_ids").array().default([""]).notNull(),
	cardCapturedAt: timestamp("card_captured_at", { withTimezone: true, mode: 'string' }),
	consentCompletedAt: timestamp("consent_completed_at", { withTimezone: true, mode: 'string' }),
	formsCompleted: jsonb("forms_completed").default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_intake_package_journeys_appointment").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_intake_package_journeys_token").using("btree", table.journeyToken.asc().nullsLast().op("text_ops")),
	uniqueIndex("idx_one_journey_per_appointment").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "intake_package_journeys_appointment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "intake_package_journeys_patient_id_fkey"
		}),
	unique("intake_package_journeys_journey_token_key").on(table.journeyToken),
]);

export const files = pgTable("files", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: text().notNull(),
	description: text(),
	storagePath: text("storage_path").notNull(),
	fileSizeBytes: integer("file_size_bytes").notNull(),
	mimeType: text("mime_type").default('application/pdf').notNull(),
	uploadedBy: uuid("uploaded_by"),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_files_active").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")).where(sql`(archived_at IS NULL)`),
	index("idx_files_org").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "files_org_id_fkey"
		}),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "files_uploaded_by_fkey"
		}),
]);

export const fileDeliveries = pgTable("file_deliveries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fileId: uuid("file_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	sessionId: uuid("session_id"),
	token: text().notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	viewedAt: timestamp("viewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_file_deliveries_file").using("btree", table.fileId.asc().nullsLast().op("uuid_ops")),
	index("idx_file_deliveries_token").using("btree", table.token.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.fileId],
			foreignColumns: [files.id],
			name: "file_deliveries_file_id_fkey"
		}),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "file_deliveries_patient_id_fkey"
		}),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessions.id],
			name: "file_deliveries_session_id_fkey"
		}),
	unique("file_deliveries_token_key").on(table.token),
]);

export const pmsConnections = pgTable("pms_connections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	locationId: uuid("location_id").notNull(),
	provider: pmsProvider().notNull(),
	status: pmsConnectionStatus().notNull(),
	importedData: jsonb("imported_data"),
	// Opaque, adapter-owned encrypted credentials. A connection is "sync-active"
	// iff this is non-null (plan §8.A). Markers from onboarding leave it null.
	credentialsEncrypted: text("credentials_encrypted"),
	defaultBusinessExternalId: text("default_business_external_id"),
	// Cliniko account subdomain (e.g. 'coviu-test') for web deep links:
	// https://{subdomain}.{shard}.cliniko.com/patients/{id}. Fetched at connect.
	accountSubdomain: text("account_subdomain"),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
	lastSyncError: text("last_sync_error"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "pms_connections_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.id],
			name: "pms_connections_location_id_fkey"
		}).onDelete("cascade"),
	unique("pms_connections_location_id_key").on(table.locationId),
]);

// Telephony call-pop TEST trigger config (docs/plans/3cx-incoming-call-patient-pop.md).
// Internal demo tool, NOT a real phone-system integration: a Twilio number's
// webhook posts here, we match the caller number to a patient and pop the card
// on the configured demo user's run sheet. One config per location.
//   - path_token: hard-to-guess segment in the webhook URL; PRIMARY config locator.
//   - webhook_url: the EXACT public URL pasted into Twilio, stored verbatim and used
//     for X-Twilio-Signature validation (reconstructing it behind a proxy is unsafe).
//   - auth_token_encrypted: Twilio auth token, encrypted via the PMS cred helper.
//   - demo_user_id: whose run sheet the pop targets (Twilio can't report an answerer).
export const telephonyTestConfig = pgTable("telephony_test_config", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	locationId: uuid("location_id").notNull(),
	orgId: uuid("org_id").notNull(),
	provider: text().default('twilio').notNull(),
	twilioAccountSid: text("twilio_account_sid"),
	twilioPhoneNumber: text("twilio_phone_number"),
	pathToken: text("path_token").notNull(),
	webhookUrl: text("webhook_url"),
	authTokenEncrypted: text("auth_token_encrypted"),
	demoUserId: uuid("demo_user_id"),
	status: text().default('off').notNull(),
	lastEventAt: timestamp("last_event_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_telephony_test_config_location_id").using("btree", table.locationId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.id],
			name: "telephony_test_config_location_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "telephony_test_config_org_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.demoUserId],
			foreignColumns: [users.id],
			name: "telephony_test_config_demo_user_id_fkey"
		}).onDelete("set null"),
	unique("telephony_test_config_location_id_key").on(table.locationId),
	unique("telephony_test_config_path_token_key").on(table.pathToken),
]);

export const pmsSyncCursors = pgTable("pms_sync_cursors", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	connectionId: uuid("connection_id").notNull(),
	resource: text().notNull(),
	cursorUpdatedAt: timestamp("cursor_updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.connectionId],
			foreignColumns: [pmsConnections.id],
			name: "pms_sync_cursors_connection_id_fkey"
		}).onDelete("cascade"),
	unique("pms_sync_cursors_connection_id_resource_key").on(table.connectionId, table.resource),
]);

export const pmsPatientLinks = pgTable("pms_patient_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	connectionId: uuid("connection_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	pmsExternalId: text("pms_external_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pms_patient_links_patient").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.connectionId],
			foreignColumns: [pmsConnections.id],
			name: "pms_patient_links_connection_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [patients.id],
			name: "pms_patient_links_patient_id_fkey"
		}).onDelete("cascade"),
	unique("pms_patient_links_connection_id_pms_external_id_key").on(table.connectionId, table.pmsExternalId),
	unique("pms_patient_links_connection_id_patient_id_key").on(table.connectionId, table.patientId),
]);

export const pmsPractitionerLinks = pgTable("pms_practitioner_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	connectionId: uuid("connection_id").notNull(),
	// Maps a PMS practitioner (the appointment-book column) to a Coviu ROOM, so
	// a synced appointment lands the patient in the right room. The room already
	// carries its clinician — we don't map to a staff member. §025
	roomId: uuid("room_id"),
	pmsExternalId: text("pms_external_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.connectionId],
			foreignColumns: [pmsConnections.id],
			name: "pms_practitioner_links_connection_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "pms_practitioner_links_room_id_fkey"
		}).onDelete("set null"),
	unique("pms_practitioner_links_connection_id_pms_external_id_key").on(table.connectionId, table.pmsExternalId),
]);

export const pmsAppointmentTypeLinks = pgTable("pms_appointment_type_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	connectionId: uuid("connection_id").notNull(),
	appointmentTypeId: uuid("appointment_type_id").notNull(),
	pmsExternalId: text("pms_external_id").notNull(),
	confirmedModality: appointmentModality("confirmed_modality"),
	roomId: uuid("room_id"),
	syncEnabled: boolean("sync_enabled").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.connectionId],
			foreignColumns: [pmsConnections.id],
			name: "pms_appointment_type_links_connection_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentTypeId],
			foreignColumns: [appointmentTypes.id],
			name: "pms_appointment_type_links_appointment_type_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "pms_appointment_type_links_room_id_fkey"
		}).onDelete("set null"),
	unique("pms_appointment_type_links_connection_id_pms_external_id_key").on(table.connectionId, table.pmsExternalId),
	unique("pms_appointment_type_links_connection_id_appointment_type_id_key").on(table.connectionId, table.appointmentTypeId),
]);

export const pmsPushFieldResults = pgTable("pms_push_field_results", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	submissionId: uuid("submission_id").notNull(),
	provider: pmsProvider().notNull(),
	surveyQuestionName: text("survey_question_name").notNull(),
	pmsTargetKey: text("pms_target_key").notNull(),
	status: text().notNull(),
	attemptedValue: text("attempted_value"),
	failureKind: text("failure_kind"),
	detail: text(),
	attempts: integer().default(1).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pms_push_field_results_submission").using("btree", table.submissionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.submissionId],
			foreignColumns: [formSubmissions.id],
			name: "pms_push_field_results_submission_id_fkey"
		}).onDelete("cascade"),
	unique("pms_push_field_results_submission_id_survey_question_name_key").on(table.submissionId, table.surveyQuestionName),
]);

export const stripeConnections = pgTable("stripe_connections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	status: stripeConnectionStatus().notNull(),
	stripeAccountId: text("stripe_account_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organisations.id],
			name: "stripe_connections_org_id_fkey"
		}).onDelete("cascade"),
	unique("stripe_connections_org_id_key").on(table.orgId),
]);
