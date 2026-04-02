'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { PersistentHeader } from './persistent-header';

interface PhoneVerificationProps {
  clinicName: string;
  logoUrl: string | null;
  roomName: string | null;
  currentStep: number;
  totalSteps: number;
  prefillPhone: string | null;
  sessionId: string | null;
  orgId: string;
  onVerified: (phoneNumber: string, verificationId: string, patients: PatientContact[]) => void;
}

interface PatientContact {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
}

type Phase = 'enter_phone' | 'enter_code';

export function PhoneVerification({
  clinicName,
  logoUrl,
  roomName,
  currentStep,
  totalSteps,
  prefillPhone,
  sessionId,
  orgId,
  onVerified,
}: PhoneVerificationProps) {
  const [phase, setPhase] = useState<Phase>('enter_phone');
  const [phoneNumber, setPhoneNumber] = useState(prefillPhone || '');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [attempts, setAttempts] = useState(0);

  const codeInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Resend countdown timer
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((t) => t - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  const sendCode = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/patient/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber, session_id: sessionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to send code');
        return;
      }

      setVerificationId(data.verification_id);
      setPhase('enter_code');
      setResendTimer(30);
      setCode(['', '', '', '', '', '']);
      setAttempts(0);

      // Auto-focus first code input
      setTimeout(() => codeInputsRef.current[0]?.focus(), 100);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [phoneNumber, sessionId]);

  const verifyCode = useCallback(async (fullCode: string) => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/patient/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_id: verificationId,
          code: fullCode,
          org_id: orgId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAttempts((a) => a + 1);
        if (attempts >= 2) {
          setError('Too many attempts. Tap resend for a new code.');
        } else {
          setError(data.error || "That code didn't match. Try again.");
        }
        setCode(['', '', '', '', '', '']);
        setTimeout(() => codeInputsRef.current[0]?.focus(), 100);
        return;
      }

      onVerified(data.phone_number, verificationId!, data.patients);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [verificationId, orgId, attempts, onVerified]);

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);

    // Auto-advance to next input
    if (value && index < 5) {
      codeInputsRef.current[index + 1]?.focus();
    }

    // Auto-submit on last digit
    const fullCode = newCode.join('');
    if (fullCode.length === 6) {
      verifyCode(fullCode);
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      codeInputsRef.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split('');
      setCode(newCode);
      verifyCode(pasted);
    }
  };

  if (phase === 'enter_phone') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          roomName={roomName}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />

        <div className="w-full space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">
            Verify your phone number
          </h1>
          <p className="text-sm text-gray-500">
            We&apos;ll send you a code to confirm your identity.
          </p>

          <div>
            <label htmlFor="phone" className="mb-1 block text-xs font-medium text-gray-500">
              Phone number
            </label>
            <div className="flex gap-2">
              <div className="flex h-12 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">
                +61
              </div>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoFocus
                value={phoneNumber.replace(/^\+61/, '')}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  setPhoneNumber('+61' + digits);
                }}
                placeholder="450 336 880"
                className="h-12 flex-1 rounded-lg border border-gray-200 px-3 text-base text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500" role="alert" aria-live="assertive">{error}</p>
          )}

          <button
            onClick={sendCode}
            disabled={phoneNumber.replace(/^\+61/, '').length < 9 || loading}
            className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send code'}
          </button>
        </div>
      </div>
    );
  }

  // Phase: enter_code
  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        roomName={roomName}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />

      <div className="w-full space-y-4">
        <h1 className="text-xl font-semibold text-gray-800">
          Enter verification code
        </h1>
        <p className="text-sm text-gray-500">
          We sent a 6-digit code to{' '}
          <span className="font-medium text-gray-800">
            {phoneNumber.replace(/^\+61(\d{3})(\d{3})(\d{3,4})$/, '0$1 $2 $3')}
          </span>
        </p>

        {/* 6-digit code input */}
        <div className="flex justify-center gap-2" onPaste={handleCodePaste}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { codeInputsRef.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleCodeChange(i, e.target.value)}
              onKeyDown={(e) => handleCodeKeyDown(i, e)}
              aria-label={`Digit ${i + 1}`}
              className="h-14 w-11 rounded-lg border border-gray-200 text-center text-xl font-semibold text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          ))}
        </div>

        {error && (
          <p className="text-center text-sm text-red-500" role="alert" aria-live="assertive">
            {error}
          </p>
        )}

        {loading && (
          <p className="text-center text-sm text-gray-400">Verifying...</p>
        )}

        <div className="flex flex-col items-center gap-2 pt-2">
          <button
            onClick={sendCode}
            disabled={resendTimer > 0 || loading}
            className="text-sm font-medium text-teal-500 hover:text-teal-600 disabled:text-gray-400"
          >
            {resendTimer > 0 ? `Resend code (${resendTimer}s)` : 'Resend code'}
          </button>
          <button
            onClick={() => {
              setPhase('enter_phone');
              setError(null);
            }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Wrong number?
          </button>
        </div>
      </div>
    </div>
  );
}
