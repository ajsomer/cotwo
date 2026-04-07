-- Add per-room payment toggle
-- Default true preserves existing behaviour: if location has Stripe, all rooms collect payments
ALTER TABLE rooms ADD COLUMN payments_enabled BOOLEAN NOT NULL DEFAULT true;
