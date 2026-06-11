'use client';

import { useState, useEffect, useCallback } from 'react';
import { postJson } from '@/lib/api-client';
import { useSurveyModel } from '@/hooks/useSurveyModel';
import { SurveyStepShell } from './survey-shell';
import { PersistentHeader } from './persistent-header';
import { Spinner } from '@/components/ui/spinner';

interface FormStepProps {
  clinicName: string;
  logoUrl: string | null;
  currentStep: number;
  totalSteps: number;
  formId: string;
  formName: string;
  token: string;
  onComplete: () => void;
}

export function FormStep({
  clinicName,
  logoUrl,
  currentStep,
  totalSteps,
  formId,
  formName,
  token,
  onComplete,
}: FormStepProps) {
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/forms/${formId}`);
        if (!res.ok) throw new Error('Failed to load form');
        const data = await res.json();
        if (cancelled) return;
        const formSchema = data.form?.schema;
        if (!formSchema) throw new Error('Form has no schema');
        setSchema(formSchema);
      } catch {
        if (!cancelled) setError('Could not load form. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  const handleSubmit = useCallback(
    async (responses: Record<string, unknown>) => {
      setSubmitting(true);
      setError(null);
      const result = await postJson(
        `/api/intake/${token}/complete-item`,
        {
          item_type: 'form',
          form_id: formId,
          data: responses,
        },
        'Failed to submit form'
      );
      setSubmitting(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onComplete();
    },
    [token, formId, onComplete]
  );

  // Don't show SurveyJS's built-in "Thank you for completing the survey"
  // page — the intake journey advances to the next step itself, and we
  // render our own loading screen in the gap (see `submitting` below).
  const survey = useSurveyModel(schema, handleSubmit, {
    showCompletedPage: false,
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
        <div className="flex h-32 w-full items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }

  if (error && !schema) {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader clinicName={clinicName} logoUrl={logoUrl} />
        <div className="w-full space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">{formName}</h1>
          <p className="text-sm text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  // Once the survey is submitted, show a loading screen while complete-item
  // runs and the journey advances — rather than letting the SurveyJS view
  // (or its completion page) linger.
  if (submitting) {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Spinner />
          <p className="text-sm text-gray-500">Saving your answers…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
      <SurveyStepShell title={formName} error={error} model={survey} />
    </div>
  );
}
