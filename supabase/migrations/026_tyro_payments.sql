-- 026_tyro_payments.sql
-- Tyro Health Online (Checkout) as a second payment provider alongside Stripe.
-- Adds org-level provider selection + provider-neutral columns. Keeps all
-- existing Stripe columns (made nullable where Tyro won't populate them).
--
-- See docs/plans/tyro-payments-integration.md §4. DO NOT auto-apply — review first.

BEGIN;

-- 1. Org-level provider selection. Text + CHECK, matching the `tier` convention.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'stripe';

ALTER TABLE organisations
  ADD CONSTRAINT organisations_payment_provider_check
  CHECK (payment_provider = ANY (ARRAY['stripe'::text, 'tyro'::text, 'console'::text]));

-- Tyro location/settlement identifier (e.g. 'T01LHM0B'), passed as providerNumber
-- on charge. Org-level for now (single location identifier); revisit per-location
-- if multi-location settlement is needed.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS tyro_provider_number text;

-- 2. Patient-level provider handle. For Tyro this is the refId (the saved card
-- follows the patient across visits). Card data itself stays on Tyro.
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS provider_customer_ref text;

-- 3. payment_methods: tag the provider; relax the Stripe-only constraint since a
-- Tyro "card on file" row has no Stripe token (the card lives on Tyro's side).
ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

ALTER TABLE payment_methods
  ALTER COLUMN stripe_payment_method_id DROP NOT NULL;

-- 4. payments: provider-neutral columns alongside the existing Stripe ones.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_txn_id text;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_request_url text;

COMMIT;

-- Status mapping (no enum change needed — reuse payment_status):
--   Tyro invoice pending / awaiting patient  -> 'processing'
--   Tyro invoiceCompleted                    -> 'completed'
--   Tyro invoiceCancelled / failed           -> 'failed'

-- Per-org Tyro connection (added after initial 026): each clinic connects their
-- OWN Tyro business via an API key generated in their Tyro Health portal. The
-- key is per-business, so it must be stored per-org, not as a global env var.
-- api_key stored as an AES-256-GCM encrypted blob; business_id is not secret.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS tyro_api_key_encrypted text;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS tyro_business_id text;
