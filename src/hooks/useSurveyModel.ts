'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Model } from 'survey-core';
import { coviuTheme } from '@/lib/survey/theme';

interface UseSurveyModelOptions {
  /**
   * SurveyJS shows its own "Thank you" page after completion by default.
   * Pass false when the caller advances to its own screen instead.
   */
  showCompletedPage?: boolean;
}

/**
 * Builds a Coviu-themed SurveyJS Model and wires its onComplete event to
 * `onSubmit`. The model is rebuilt whenever `schema` changes identity;
 * pass null while the schema is still loading.
 */
export function useSurveyModel(
  schema: Record<string, unknown> | null,
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>,
  options?: UseSurveyModelOptions
): Model | null {
  const showCompletedPage = options?.showCompletedPage ?? true;

  const model = useMemo(() => {
    if (!schema) return null;
    const m = new Model(schema);
    m.applyTheme(coviuTheme);
    m.showProgressBar = 'off';
    m.showTitle = false;
    if (!showCompletedPage) m.showCompletedPage = false;
    return m;
  }, [schema, showCompletedPage]);

  // Keep the latest onSubmit without rebuilding the model when the callback
  // identity changes between renders.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  useEffect(() => {
    if (!model) return;
    const handler = (sender: Model) => {
      void onSubmitRef.current(sender.data as Record<string, unknown>);
    };
    model.onComplete.add(handler);
    return () => {
      model.onComplete.remove(handler);
    };
  }, [model]);

  return model;
}
