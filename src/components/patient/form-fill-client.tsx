'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import { coviuTheme } from '@/lib/survey/theme';

interface FormFillClientProps {
  token: string;
  formName: string;
  schema: Record<string, unknown>;
  patientFirstName: string | null;
  org: { name: string; logo_url: string | null } | null;
}

export function FormFillClient({
  token,
  formName,
  schema,
  patientFirstName,
  org,
}: FormFillClientProps) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [nextPageName, setNextPageName] = useState('');
  const [survey] = useState(() => {
    const s = new Model(schema);
    s.applyTheme(coviuTheme);
    s.showProgressBar = 'off';
    s.showTitle = false;
    return s;
  });

  const isPreview = token === '__preview__';

  const handleComplete = useCallback(
    async (sender: Model) => {
      if (isPreview) {
        setSubmitted(true);
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch(`/api/forms/fill/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ responses: sender.data }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to submit');
        }

        setSubmitted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setSubmitting(false);
      }
    },
    [token, isPreview]
  );

  useEffect(() => {
    survey.onComplete.add(handleComplete);

    const updatePage = () => {
      setCurrentPage(survey.currentPageNo);
      setPageCount(survey.visiblePageCount);
      // Get next page name for progress bar
      const pages = survey.visiblePages;
      const nextIdx = survey.currentPageNo + 1;
      if (nextIdx < pages.length) {
        setNextPageName(pages[nextIdx].title || pages[nextIdx].name || '');
      } else {
        setNextPageName('');
      }
    };

    survey.onCurrentPageChanged.add(updatePage);
    updatePage();

    return () => {
      survey.onComplete.remove(handleComplete);
      survey.onCurrentPageChanged.remove(updatePage);
    };
  }, [survey, handleComplete]);

  const styleOverrides = useMemo(() => `
  `, []);

  if (submitted) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
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
        <h1 className="text-xl font-semibold text-gray-800">Thank you</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your responses have been submitted. You can close this page.
        </p>
      </div>
    );
  }

  const clinicInitial = org?.name?.charAt(0)?.toUpperCase() || '?';
  const schemaTitle = (schema as { title?: string }).title || formName;

  return (
    <>
      <style>{styleOverrides}</style>
      <div
        className={submitting ? 'pointer-events-none opacity-60' : ''}
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          width: '100%',
          maxWidth: 680,
          margin: '0 auto',
        }}
      >
        {/* Outer container */}
        <div
          style={{
            background: '#F8F8F6',
            borderRadius: 16,
            border: '1px solid #E2E1DE',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: '#FFFFFF',
              padding: '32px 24px 24px',
              borderBottom: '1px solid #E2E1DE',
              textAlign: 'center',
            }}
          >
            {/* Clinic logo */}
            {org?.logo_url ? (
              <img
                src={org.logo_url}
                alt={org.name}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  objectFit: 'cover',
                  margin: '0 auto',
                }}
              />
            ) : (
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: '#2ABFBF',
                  color: '#FFFFFF',
                  fontSize: 22,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                }}
              >
                {clinicInitial}
              </div>
            )}

            {/* Clinic name */}
            {org?.name && (
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#2C2C2A',
                  marginTop: 12,
                }}
              >
                {org.name}
              </div>
            )}

            {/* Divider */}
            <div
              style={{
                width: 40,
                height: 1,
                background: '#E2E1DE',
                margin: '20px auto',
              }}
            />

            {/* Form title */}
            <div
              style={{
                fontSize: 20,
                fontWeight: 500,
                color: '#2C2C2A',
                letterSpacing: '-0.2px',
              }}
            >
              {schemaTitle}
            </div>

            {/* Subtitle */}
            <div
              style={{
                fontSize: 13,
                color: '#8A8985',
                lineHeight: 1.5,
                maxWidth: 280,
                margin: '6px auto 0',
              }}
            >
              Please complete before your appointment.
            </div>
          </div>

          {/* Progress bar */}
          {pageCount > 1 && (
            <div
              style={{
                background: '#FFFFFF',
                padding: '16px 24px',
                borderBottom: '1px solid #E2E1DE',
              }}
            >
              {/* Segmented bar */}
              <div style={{ display: 'flex', gap: 4 }}>
                {Array.from({ length: pageCount }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      background: i <= currentPage ? '#2ABFBF' : '#E2E1DE',
                      transition: 'background 0.2s ease',
                    }}
                  />
                ))}
              </div>

              {/* Page info */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 8,
                  fontSize: 11,
                  color: '#8A8985',
                }}
              >
                <span>
                  {nextPageName ? `Next: ${nextPageName}` : ''}
                </span>
                <span>
                  Page {currentPage + 1} of {pageCount}
                </span>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div
              style={{
                background: '#FEF2F2',
                padding: '12px 24px',
                fontSize: 13,
                color: '#E24B4A',
                borderBottom: '1px solid #E2E1DE',
              }}
            >
              {error}
              <button
                onClick={() => setError(null)}
                style={{
                  marginLeft: 8,
                  fontWeight: 500,
                  textDecoration: 'underline',
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 'inherit',
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* SurveyJS form body */}
          <Survey model={survey} />
        </div>
      </div>
    </>
  );
}
