'use client';

import { useState, useEffect } from 'react';
import { PersistentHeader } from './persistent-header';

interface CardCaptureProps {
  clinicName: string;
  logoUrl: string | null;
  roomName: string | null;
  currentStep: number;
  totalSteps: number;
  patientId: string;
  sessionId: string | null;
  stripeAccountId: string | null;
  onComplete: (cardInfo: { card_last_four: string; card_brand: string } | null) => void;
}

interface ExistingCard {
  card_last_four: string;
  card_brand: string;
  card_expiry: string | null;
}

export function CardCapture({
  clinicName,
  logoUrl,
  roomName,
  currentStep,
  totalSteps,
  patientId,
  sessionId,
  stripeAccountId,
  onComplete,
}: CardCaptureProps) {
  const [existingCard, setExistingCard] = useState<ExistingCard | null>(null);
  const [showNewCard, setShowNewCard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Card form fields (simplified — production would use Stripe Elements)
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');

  // Check for existing card on file
  useEffect(() => {
    async function checkCard() {
      try {
        const res = await fetch(`/api/patient/card?patient_id=${patientId}`);
        const data = await res.json();
        if (data.card) {
          setExistingCard(data.card);
        }
      } catch {
        // No card on file
      } finally {
        setLoading(false);
      }
    }
    checkCard();
  }, [patientId]);

  const saveCard = async () => {
    setError(null);
    setSaving(true);

    try {
      // In production, this would use Stripe.js to tokenise the card.
      // For the prototype, we simulate with test card data.
      const cleanNumber = cardNumber.replace(/\s/g, '');
      const lastFour = cleanNumber.slice(-4);
      const brand = cleanNumber.startsWith('4') ? 'Visa' : cleanNumber.startsWith('5') ? 'Mastercard' : 'Card';

      // Simulate Stripe PaymentMethod creation
      const mockPaymentMethodId = `pm_test_${Date.now()}`;

      const res = await fetch('/api/patient/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          stripe_payment_method_id: mockPaymentMethodId,
          card_last_four: lastFour,
          card_brand: brand,
          card_expiry: expiry,
          session_id: sessionId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save card');
        return;
      }

      onComplete({ card_last_four: lastFour, card_brand: brand });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          roomName={roomName}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
        <div className="flex h-32 w-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
        </div>
      </div>
    );
  }

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
          Payment method
        </h1>

        <p className="text-sm text-gray-500">
          {clinicName} collects payment after your appointment. Please store a
          card so your clinician can focus on your care.
        </p>

        {/* Existing card on file */}
        {existingCard && !showNewCard && (
          <>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardBrandIcon brand={existingCard.card_brand} />
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {existingCard.card_brand} ending {existingCard.card_last_four}
                    </p>
                    {existingCard.card_expiry && (
                      <p className="text-xs text-gray-400">
                        Expires {existingCard.card_expiry}
                      </p>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
                  On file
                </span>
              </div>
            </div>

            <button
              onClick={() => onComplete({
                card_last_four: existingCard.card_last_four,
                card_brand: existingCard.card_brand,
              })}
              className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600"
            >
              Continue with this card
            </button>

            <button
              onClick={() => setShowNewCard(true)}
              className="w-full text-center text-sm font-medium text-teal-500 hover:text-teal-600"
            >
              Use a different card
            </button>
          </>
        )}

        {/* New card form */}
        {(!existingCard || showNewCard) && (
          <>
            <div>
              <label htmlFor="cardNumber" className="mb-1 block text-xs font-medium text-gray-500">
                Card number
              </label>
              <input
                id="cardNumber"
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="4242 4242 4242 4242"
                value={cardNumber}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 16);
                  setCardNumber(v.replace(/(\d{4})/g, '$1 ').trim());
                }}
                className="h-12 w-full rounded-lg border border-gray-200 px-3 text-base text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="expiry" className="mb-1 block text-xs font-medium text-gray-500">
                  Expiry
                </label>
                <input
                  id="expiry"
                  type="text"
                  inputMode="numeric"
                  placeholder="MM/YY"
                  value={expiry}
                  onChange={(e) => {
                    let v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
                    setExpiry(v);
                  }}
                  className="h-12 w-full rounded-lg border border-gray-200 px-3 text-base text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="cvc" className="mb-1 block text-xs font-medium text-gray-500">
                  CVC
                </label>
                <input
                  id="cvc"
                  type="text"
                  inputMode="numeric"
                  placeholder="123"
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="h-12 w-full rounded-lg border border-gray-200 px-3 text-base text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-500" role="alert" aria-live="assertive">{error}</p>
            )}

            <button
              onClick={saveCard}
              disabled={cardNumber.replace(/\s/g, '').length < 15 || expiry.length < 5 || cvc.length < 3 || saving}
              className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save card'}
            </button>

            {existingCard && showNewCard && (
              <button
                onClick={() => setShowNewCard(false)}
                className="w-full text-center text-sm text-gray-400 hover:text-gray-600"
              >
                Use existing card
              </button>
            )}

            <p className="text-center text-xs text-gray-400">
              Test mode — use card number 4242 4242 4242 4242
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function CardBrandIcon({ brand }: { brand: string }) {
  const initial = brand.charAt(0).toUpperCase();
  return (
    <div className="flex h-8 w-10 items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs font-bold text-gray-600">
      {initial}
    </div>
  );
}
