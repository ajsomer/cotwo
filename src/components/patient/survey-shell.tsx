'use client';

import { Model } from 'survey-core';
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
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
        <svg
          className="h-6 w-6 text-teal-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 12.75l6 6 9-13.5"
          />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-gray-800">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">{message}</p>
    </div>
  );
}
