'use client';

import { useState, useEffect } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import { postJson } from '@/lib/api-client';
import { coviuTheme } from '@/lib/survey/theme';
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
  const [survey, setSurvey] = useState<Model | null>(null);
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
        const model = new Model(formSchema);
        model.applyTheme(coviuTheme);
        model.showProgressBar = 'off';
        model.showTitle = false;
        // Don't show SurveyJS's built-in "Thank you for completing the survey"
        // page — the intake journey advances to the next step itself, and we
        // render our own loading screen in the gap (see `submitting` below).
        model.showCompletedPage = false;
        setSurvey(model);
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

  useEffect(() => {
    if (!survey) return;
    const handler = async (sender: Model) => {
      setSubmitting(true);
      setError(null);
      const result = await postJson(
        `/api/intake/${token}/complete-item`,
        {
          item_type: 'form',
          form_id: formId,
          data: sender.data,
        },
        'Failed to submit form'
      );
      setSubmitting(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onComplete();
    };
    survey.onComplete.add(handler);
    return () => {
      survey.onComplete.remove(handler);
    };
  }, [survey, token, formId, onComplete]);

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
      <div className="w-full">
        <h1 className="mb-3 text-xl font-semibold text-gray-800">{formName}</h1>
        {error && (
          <p className="mb-2 text-sm text-red-500" role="alert">
            {error}
          </p>
        )}
        {survey && <Survey model={survey} />}
      </div>
    </div>
  );
}
