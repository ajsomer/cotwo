# TODO

## Add Session Panel: Patient Search

The add session panel currently takes a phone number only. When a phone number matches multiple patient contacts in the org, we auto-link the first match — which may be wrong.

**Plan:** Add a combo search (name + phone) to the add session panel. The receptionist types a name or phone, gets a filtered list of existing contacts, and selects one. This makes the patient link explicit at scheduling time, removing ambiguity for shared phone numbers (e.g. parent with two children).

When this lands:
- The panel passes `patient_id` directly to `createSessions`, skipping the phone-number-based auto-link
- The identity confirmation step in the patient entry flow can skip or pre-confirm since we already know who's scheduled
- Multi-contact resolution only falls back to the patient-side picker for on-demand entries (no pre-existing appointment)
