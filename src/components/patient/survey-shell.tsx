'use client';

import { Model } from 'survey-core';
import { CheckCircle } from '@/components/ui/check-circle';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';

/**
 * Shared body for a patient-facing SurveyJS step: form name as an h1 above
 * the survey, inline error, no outer card. Callers compose PersistentHeader
 * and any page shell around it. Used by the intake journey's form step and
 * the standalone form flow, which deliberately render identically.
 */
export function SurveyStepShell({
  title,
  error,
  model,
}: {
  title: string;
  error: string | null;
  model: Model | null;
}) {
  return (
    <div className="w-full">
      <h1 className="mb-3 text-xl font-semibold text-gray-800">{title}</h1>
      {error && (
        <p className="mb-2 text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
      {model && <Survey model={model} />}
    </div>
  );
}

/**
 * Post-submission thanks block: teal check circle, title, message.
 * Callers control the surrounding chrome (bordered card vs bare).
 */
export function SurveyThanks({
  title,
  message,
  className,
}: {
  title: string;
  message: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <CheckCircle className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50" />
      <h1 className="text-xl font-semibold text-gray-800">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">{message}</p>
    </div>
  );
}
