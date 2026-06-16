/**
 * Open Tyro's clinic-side charge window for a session.
 *
 * Clinic Process action for Tyro orgs: fetch the SDK token + patient details
 * (incl. refId) for the session, then render Tyro's own transaction window
 * (renderCreateTransaction) pre-populated with the patient. The operator picks
 * the patient's stored card and charges. Card data never touches us.
 *
 * The SDK renders its own modal/window, so no popup is opened here — we just load
 * the SDK and call render. Auth is the minted account-scoped token + appId.
 */
export async function openTyroChargeWindow(sessionId: string): Promise<void> {
  const res = await fetch('/api/clinic/tyro-charge-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Could not start Tyro charge');
  }

  const { sdk_token, env, app_id, patient } = await res.json();

  const sdkModule = await import('@medipass/partner-sdk');
  const sdk = sdkModule.default ?? sdkModule;

  // Open Tyro's general transaction window pre-populated with the patient only.
  // We deliberately omit `funder` and `providerNumber` so the operator chooses
  // the action in Tyro (charge the stored card, or lodge a claim) and selects
  // the provider. The patient refId ties the session to their stored card.
  sdk.renderCreateTransaction(
    {
      patient: {
        firstName: patient.first_name,
        lastName: patient.last_name,
        mobile: patient.mobile,
        dob: patient.dob,
        refId: patient.ref_id,
      },
    },
    {
      token: sdk_token,
      tokenType: 'account',
      appId: app_id,
      env,
      onSuccess: () => {
        // The transaction completed in Tyro's window; the run sheet refetches on
        // its own realtime channel. Nothing required here for the prototype.
      },
      onError: () => {},
      onCancel: () => {},
    }
  );
}
