import {
  workflowTemplates,
  workflowActionBlocks,
  appointmentActions,
  appointmentWorkflowRuns,
  typeWorkflowLinks,
  outcomePathways,
} from "@/lib/db/schema";

/** camelCase → snake_case at the type level, so wire-shape types stay
 *  derived from the Drizzle schema instead of a frozen codegen dump. */
type CamelToSnake<S extends string> = S extends `${infer H}${infer T}`
  ? `${H extends Lowercase<H> ? H : `_${Lowercase<H>}`}${CamelToSnake<T>}`
  : S;
export type SnakeKeys<T> = { [K in keyof T as CamelToSnake<K & string>]: T[K] };

export type DbWorkflowTemplate = SnakeKeys<typeof workflowTemplates.$inferSelect>;
export type DbWorkflowActionBlock = SnakeKeys<typeof workflowActionBlocks.$inferSelect>;
export type DbAppointmentAction = SnakeKeys<typeof appointmentActions.$inferSelect>;
export type DbAppointmentWorkflowRun = SnakeKeys<typeof appointmentWorkflowRuns.$inferSelect>;
export type DbTypeWorkflowLink = SnakeKeys<typeof typeWorkflowLinks.$inferSelect>;
export type DbOutcomePathway = SnakeKeys<typeof outcomePathways.$inferSelect>;
