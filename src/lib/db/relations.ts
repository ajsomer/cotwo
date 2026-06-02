import { relations } from "drizzle-orm/relations";
import { organisations, appointments, patients, users, appointmentTypes, rooms, locations, staffAssignments, clinicianRoomAssignments, patientPhoneNumbers, paymentMethods, sessions, outcomePathways, phoneVerifications, sessionParticipants, payments, forms, formFields, formSubmissions, formAssignments, workflowTemplates, workflowActionBlocks, typeWorkflowLinks, appointmentWorkflowRuns, appointmentActions, intakePackageJourneys, files, fileDeliveries, pmsConnections, stripeConnections } from "./schema";

export const appointmentsRelations = relations(appointments, ({one, many}) => ({
	organisation: one(organisations, {
		fields: [appointments.orgId],
		references: [organisations.id]
	}),
	patient: one(patients, {
		fields: [appointments.patientId],
		references: [patients.id]
	}),
	user: one(users, {
		fields: [appointments.clinicianId],
		references: [users.id]
	}),
	appointmentType: one(appointmentTypes, {
		fields: [appointments.appointmentTypeId],
		references: [appointmentTypes.id]
	}),
	room: one(rooms, {
		fields: [appointments.roomId],
		references: [rooms.id]
	}),
	location: one(locations, {
		fields: [appointments.locationId],
		references: [locations.id]
	}),
	sessions: many(sessions),
	payments: many(payments),
	formSubmissions: many(formSubmissions),
	formAssignments: many(formAssignments),
	appointmentWorkflowRuns: many(appointmentWorkflowRuns),
	appointmentActions: many(appointmentActions),
	intakePackageJourneys: many(intakePackageJourneys),
}));

export const organisationsRelations = relations(organisations, ({many}) => ({
	appointments: many(appointments),
	locations: many(locations),
	patients: many(patients),
	appointmentTypes: many(appointmentTypes),
	forms: many(forms),
	workflowTemplates: many(workflowTemplates),
	outcomePathways: many(outcomePathways),
	files: many(files),
	pmsConnections: many(pmsConnections),
	stripeConnections: many(stripeConnections),
}));

export const patientsRelations = relations(patients, ({one, many}) => ({
	appointments: many(appointments),
	organisation: one(organisations, {
		fields: [patients.orgId],
		references: [organisations.id]
	}),
	patientPhoneNumbers: many(patientPhoneNumbers),
	paymentMethods: many(paymentMethods),
	sessionParticipants: many(sessionParticipants),
	payments: many(payments),
	formSubmissions: many(formSubmissions),
	formAssignments: many(formAssignments),
	intakePackageJourneys: many(intakePackageJourneys),
	fileDeliveries: many(fileDeliveries),
}));

export const usersRelations = relations(users, ({many}) => ({
	appointments: many(appointments),
	staffAssignments: many(staffAssignments),
	forms: many(forms),
	formSubmissions: many(formSubmissions),
	appointmentActions: many(appointmentActions),
	files: many(files),
}));

export const appointmentTypesRelations = relations(appointmentTypes, ({one, many}) => ({
	appointments: many(appointments),
	organisation: one(organisations, {
		fields: [appointmentTypes.orgId],
		references: [organisations.id]
	}),
	typeWorkflowLinks: many(typeWorkflowLinks),
}));

export const roomsRelations = relations(rooms, ({one, many}) => ({
	appointments: many(appointments),
	location: one(locations, {
		fields: [rooms.locationId],
		references: [locations.id]
	}),
	clinicianRoomAssignments: many(clinicianRoomAssignments),
	sessions: many(sessions),
}));

export const locationsRelations = relations(locations, ({one, many}) => ({
	appointments: many(appointments),
	organisation: one(organisations, {
		fields: [locations.orgId],
		references: [organisations.id]
	}),
	rooms: many(rooms),
	staffAssignments: many(staffAssignments),
	sessions: many(sessions),
}));

export const staffAssignmentsRelations = relations(staffAssignments, ({one, many}) => ({
	user: one(users, {
		fields: [staffAssignments.userId],
		references: [users.id]
	}),
	location: one(locations, {
		fields: [staffAssignments.locationId],
		references: [locations.id]
	}),
	clinicianRoomAssignments: many(clinicianRoomAssignments),
}));

export const clinicianRoomAssignmentsRelations = relations(clinicianRoomAssignments, ({one}) => ({
	staffAssignment: one(staffAssignments, {
		fields: [clinicianRoomAssignments.staffAssignmentId],
		references: [staffAssignments.id]
	}),
	room: one(rooms, {
		fields: [clinicianRoomAssignments.roomId],
		references: [rooms.id]
	}),
}));

export const patientPhoneNumbersRelations = relations(patientPhoneNumbers, ({one}) => ({
	patient: one(patients, {
		fields: [patientPhoneNumbers.patientId],
		references: [patients.id]
	}),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({one}) => ({
	patient: one(patients, {
		fields: [paymentMethods.patientId],
		references: [patients.id]
	}),
}));

export const sessionsRelations = relations(sessions, ({one, many}) => ({
	appointment: one(appointments, {
		fields: [sessions.appointmentId],
		references: [appointments.id]
	}),
	room: one(rooms, {
		fields: [sessions.roomId],
		references: [rooms.id]
	}),
	location: one(locations, {
		fields: [sessions.locationId],
		references: [locations.id]
	}),
	outcomePathway: one(outcomePathways, {
		fields: [sessions.outcomePathwayId],
		references: [outcomePathways.id]
	}),
	phoneVerifications: many(phoneVerifications),
	sessionParticipants: many(sessionParticipants),
	payments: many(payments),
	appointmentActions: many(appointmentActions),
	fileDeliveries: many(fileDeliveries),
}));

export const outcomePathwaysRelations = relations(outcomePathways, ({one, many}) => ({
	sessions: many(sessions),
	organisation: one(organisations, {
		fields: [outcomePathways.orgId],
		references: [organisations.id]
	}),
	workflowTemplate: one(workflowTemplates, {
		fields: [outcomePathways.workflowTemplateId],
		references: [workflowTemplates.id]
	}),
}));

export const phoneVerificationsRelations = relations(phoneVerifications, ({one}) => ({
	session: one(sessions, {
		fields: [phoneVerifications.sessionId],
		references: [sessions.id]
	}),
}));

export const sessionParticipantsRelations = relations(sessionParticipants, ({one}) => ({
	session: one(sessions, {
		fields: [sessionParticipants.sessionId],
		references: [sessions.id]
	}),
	patient: one(patients, {
		fields: [sessionParticipants.patientId],
		references: [patients.id]
	}),
}));

export const paymentsRelations = relations(payments, ({one}) => ({
	appointment: one(appointments, {
		fields: [payments.appointmentId],
		references: [appointments.id]
	}),
	session: one(sessions, {
		fields: [payments.sessionId],
		references: [sessions.id]
	}),
	patient: one(patients, {
		fields: [payments.patientId],
		references: [patients.id]
	}),
}));

export const formsRelations = relations(forms, ({one, many}) => ({
	organisation: one(organisations, {
		fields: [forms.orgId],
		references: [organisations.id]
	}),
	user: one(users, {
		fields: [forms.publicTokenRotatedBy],
		references: [users.id]
	}),
	formFields: many(formFields),
	formSubmissions: many(formSubmissions),
	formAssignments: many(formAssignments),
	workflowActionBlocks: many(workflowActionBlocks),
	appointmentActions: many(appointmentActions),
}));

export const formFieldsRelations = relations(formFields, ({one}) => ({
	form: one(forms, {
		fields: [formFields.formId],
		references: [forms.id]
	}),
}));

export const formSubmissionsRelations = relations(formSubmissions, ({one, many}) => ({
	form: one(forms, {
		fields: [formSubmissions.formId],
		references: [forms.id]
	}),
	patient: one(patients, {
		fields: [formSubmissions.patientId],
		references: [patients.id]
	}),
	appointment: one(appointments, {
		fields: [formSubmissions.appointmentId],
		references: [appointments.id]
	}),
	user: one(users, {
		fields: [formSubmissions.reviewedBy],
		references: [users.id]
	}),
	formAssignments: many(formAssignments),
}));

export const formAssignmentsRelations = relations(formAssignments, ({one}) => ({
	form: one(forms, {
		fields: [formAssignments.formId],
		references: [forms.id]
	}),
	appointment: one(appointments, {
		fields: [formAssignments.appointmentId],
		references: [appointments.id]
	}),
	patient: one(patients, {
		fields: [formAssignments.patientId],
		references: [patients.id]
	}),
	formSubmission: one(formSubmissions, {
		fields: [formAssignments.submissionId],
		references: [formSubmissions.id]
	}),
}));

export const workflowTemplatesRelations = relations(workflowTemplates, ({one, many}) => ({
	organisation: one(organisations, {
		fields: [workflowTemplates.orgId],
		references: [organisations.id]
	}),
	workflowActionBlocks: many(workflowActionBlocks),
	typeWorkflowLinks: many(typeWorkflowLinks),
	outcomePathways: many(outcomePathways),
	appointmentWorkflowRuns: many(appointmentWorkflowRuns),
}));

export const workflowActionBlocksRelations = relations(workflowActionBlocks, ({one, many}) => ({
	workflowTemplate: one(workflowTemplates, {
		fields: [workflowActionBlocks.templateId],
		references: [workflowTemplates.id]
	}),
	form: one(forms, {
		fields: [workflowActionBlocks.formId],
		references: [forms.id]
	}),
	workflowActionBlock: one(workflowActionBlocks, {
		fields: [workflowActionBlocks.parentActionBlockId],
		references: [workflowActionBlocks.id],
		relationName: "workflowActionBlocks_parentActionBlockId_workflowActionBlocks_id"
	}),
	workflowActionBlocks: many(workflowActionBlocks, {
		relationName: "workflowActionBlocks_parentActionBlockId_workflowActionBlocks_id"
	}),
	appointmentActions: many(appointmentActions),
}));

export const typeWorkflowLinksRelations = relations(typeWorkflowLinks, ({one}) => ({
	appointmentType: one(appointmentTypes, {
		fields: [typeWorkflowLinks.appointmentTypeId],
		references: [appointmentTypes.id]
	}),
	workflowTemplate: one(workflowTemplates, {
		fields: [typeWorkflowLinks.workflowTemplateId],
		references: [workflowTemplates.id]
	}),
}));

export const appointmentWorkflowRunsRelations = relations(appointmentWorkflowRuns, ({one, many}) => ({
	appointment: one(appointments, {
		fields: [appointmentWorkflowRuns.appointmentId],
		references: [appointments.id]
	}),
	workflowTemplate: one(workflowTemplates, {
		fields: [appointmentWorkflowRuns.workflowTemplateId],
		references: [workflowTemplates.id]
	}),
	appointmentActions: many(appointmentActions),
}));

export const appointmentActionsRelations = relations(appointmentActions, ({one}) => ({
	appointment: one(appointments, {
		fields: [appointmentActions.appointmentId],
		references: [appointments.id]
	}),
	workflowActionBlock: one(workflowActionBlocks, {
		fields: [appointmentActions.actionBlockId],
		references: [workflowActionBlocks.id]
	}),
	appointmentWorkflowRun: one(appointmentWorkflowRuns, {
		fields: [appointmentActions.workflowRunId],
		references: [appointmentWorkflowRuns.id]
	}),
	session: one(sessions, {
		fields: [appointmentActions.sessionId],
		references: [sessions.id]
	}),
	form: one(forms, {
		fields: [appointmentActions.formId],
		references: [forms.id]
	}),
	user: one(users, {
		fields: [appointmentActions.resolvedBy],
		references: [users.id]
	}),
}));

export const intakePackageJourneysRelations = relations(intakePackageJourneys, ({one}) => ({
	appointment: one(appointments, {
		fields: [intakePackageJourneys.appointmentId],
		references: [appointments.id]
	}),
	patient: one(patients, {
		fields: [intakePackageJourneys.patientId],
		references: [patients.id]
	}),
}));

export const filesRelations = relations(files, ({one, many}) => ({
	organisation: one(organisations, {
		fields: [files.orgId],
		references: [organisations.id]
	}),
	user: one(users, {
		fields: [files.uploadedBy],
		references: [users.id]
	}),
	fileDeliveries: many(fileDeliveries),
}));

export const fileDeliveriesRelations = relations(fileDeliveries, ({one}) => ({
	file: one(files, {
		fields: [fileDeliveries.fileId],
		references: [files.id]
	}),
	patient: one(patients, {
		fields: [fileDeliveries.patientId],
		references: [patients.id]
	}),
	session: one(sessions, {
		fields: [fileDeliveries.sessionId],
		references: [sessions.id]
	}),
}));

export const pmsConnectionsRelations = relations(pmsConnections, ({one}) => ({
	organisation: one(organisations, {
		fields: [pmsConnections.orgId],
		references: [organisations.id]
	}),
}));

export const stripeConnectionsRelations = relations(stripeConnections, ({one}) => ({
	organisation: one(organisations, {
		fields: [stripeConnections.orgId],
		references: [organisations.id]
	}),
}));