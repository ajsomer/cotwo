-- ----------------------------------------------------------------------------
-- 008: Form templates — pre-built forms for allied health clinics
-- Scoped to the dev seed organisation (Sunrise Allied Health)
-- ----------------------------------------------------------------------------

-- 1. New Patient Intake
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000001',
  '00000000-0000-0000-0000-000000000001',
  'New Patient Intake',
  'Collect demographics, medical history, medications, allergies, and emergency contact details for new patients.',
  'published',
  '{
    "title": "New Patient Intake Form",
    "description": "Please complete this form before your appointment. All information is kept confidential.",
    "logoPosition": "right",
    "pages": [
      {
        "name": "personal_details",
        "title": "Personal Details",
        "elements": [
          {
            "type": "text",
            "name": "first_name",
            "title": "First Name",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "last_name",
            "title": "Last Name",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "date_of_birth",
            "title": "Date of Birth",
            "inputType": "date",
            "isRequired": true
          },
          {
            "type": "radiogroup",
            "name": "gender",
            "title": "Gender",
            "choices": ["Male", "Female", "Non-binary", "Prefer not to say"],
            "isRequired": true
          },
          {
            "type": "text",
            "name": "email",
            "title": "Email Address",
            "inputType": "email"
          },
          {
            "type": "text",
            "name": "address",
            "title": "Home Address"
          },
          {
            "type": "text",
            "name": "medicare_number",
            "title": "Medicare Number"
          },
          {
            "type": "text",
            "name": "medicare_ref",
            "title": "Medicare Reference Number (IRN)"
          }
        ]
      },
      {
        "name": "emergency_contact",
        "title": "Emergency Contact",
        "elements": [
          {
            "type": "text",
            "name": "emergency_name",
            "title": "Emergency Contact Name",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "emergency_relationship",
            "title": "Relationship to You",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "emergency_phone",
            "title": "Emergency Contact Phone",
            "inputType": "tel",
            "isRequired": true
          }
        ]
      },
      {
        "name": "medical_history",
        "title": "Medical History",
        "elements": [
          {
            "type": "checkbox",
            "name": "conditions",
            "title": "Do you have any of the following conditions? (Select all that apply)",
            "choices": [
              "Diabetes",
              "Heart disease",
              "High blood pressure",
              "Asthma",
              "Arthritis",
              "Depression or anxiety",
              "Epilepsy",
              "Cancer (current or past)",
              "Stroke",
              "Chronic pain"
            ],
            "showNoneItem": true,
            "noneText": "None of the above"
          },
          {
            "type": "comment",
            "name": "other_conditions",
            "title": "Any other medical conditions or past surgeries?",
            "rows": 3
          },
          {
            "type": "comment",
            "name": "allergies",
            "title": "Please list any allergies (medications, food, environmental)",
            "rows": 2
          }
        ]
      },
      {
        "name": "medications",
        "title": "Current Medications",
        "elements": [
          {
            "type": "boolean",
            "name": "taking_medications",
            "title": "Are you currently taking any medications?",
            "isRequired": true
          },
          {
            "type": "paneldynamic",
            "name": "medications_list",
            "title": "Please list your current medications",
            "visibleIf": "{taking_medications} = true",
            "panelCount": 1,
            "minPanelCount": 1,
            "panelAddText": "Add another medication",
            "templateElements": [
              {
                "type": "text",
                "name": "medication_name",
                "title": "Medication Name",
                "isRequired": true
              },
              {
                "type": "text",
                "name": "dosage",
                "title": "Dosage"
              },
              {
                "type": "text",
                "name": "frequency",
                "title": "Frequency (e.g. twice daily)"
              }
            ]
          }
        ]
      },
      {
        "name": "consent",
        "title": "Consent",
        "elements": [
          {
            "type": "html",
            "name": "consent_text",
            "html": "<p>I confirm that the information provided is accurate to the best of my knowledge. I understand that this information will be used for my clinical care and stored in accordance with the clinic''s privacy policy.</p>"
          },
          {
            "type": "boolean",
            "name": "consent_agreed",
            "title": "I agree to the above statement",
            "isRequired": true,
            "validators": [{ "type": "expression", "expression": "{consent_agreed} = true", "text": "You must agree to continue" }]
          },
          {
            "type": "signaturepad",
            "name": "patient_signature",
            "title": "Patient Signature",
            "isRequired": true
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "pages",
    "showQuestionNumbers": "off"
  }'::jsonb
);

-- 2. Referral Upload
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000002',
  '00000000-0000-0000-0000-000000000001',
  'Referral Upload',
  'Upload your referral letter or photo and provide referring doctor details.',
  'published',
  '{
    "title": "Referral Upload",
    "description": "Please upload your referral and provide details about your referring doctor.",
    "pages": [
      {
        "name": "referral",
        "title": "Your Referral",
        "elements": [
          {
            "type": "file",
            "name": "referral_document",
            "title": "Upload your referral letter or take a photo",
            "description": "Accepted formats: PDF, JPG, PNG. You can also use your phone camera.",
            "isRequired": true,
            "storeDataAsText": true,
            "allowMultiple": true,
            "maxSize": 10485760,
            "acceptedTypes": ".pdf,.jpg,.jpeg,.png,.heic"
          },
          {
            "type": "comment",
            "name": "referral_notes",
            "title": "Any additional notes about your referral?",
            "rows": 3
          }
        ]
      },
      {
        "name": "referring_doctor",
        "title": "Referring Doctor Details",
        "elements": [
          {
            "type": "text",
            "name": "doctor_name",
            "title": "Referring Doctor''s Name",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "practice_name",
            "title": "Practice / Clinic Name"
          },
          {
            "type": "text",
            "name": "doctor_phone",
            "title": "Doctor''s Phone Number",
            "inputType": "tel"
          },
          {
            "type": "text",
            "name": "doctor_email",
            "title": "Doctor''s Email Address",
            "inputType": "email"
          },
          {
            "type": "text",
            "name": "referral_date",
            "title": "Date of Referral",
            "inputType": "date"
          },
          {
            "type": "text",
            "name": "reason_for_referral",
            "title": "Reason for Referral",
            "isRequired": true
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "pages",
    "showQuestionNumbers": "off"
  }'::jsonb
);

-- 3. Consent to Telehealth
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000003',
  '00000000-0000-0000-0000-000000000001',
  'Consent to Telehealth',
  'Telehealth terms, privacy notice, and patient consent.',
  'published',
  '{
    "title": "Consent to Telehealth",
    "description": "Please review the following information about telehealth consultations and provide your consent.",
    "pages": [
      {
        "name": "telehealth_info",
        "title": "About Telehealth",
        "elements": [
          {
            "type": "html",
            "name": "telehealth_overview",
            "html": "<h3>What is Telehealth?</h3><p>Telehealth uses video conferencing technology to allow you to have a consultation with your clinician without needing to visit the clinic in person.</p><h3>Benefits</h3><ul><li>Access care from your home or workplace</li><li>Reduce travel time and costs</li><li>Maintain continuity of care</li></ul><h3>Limitations</h3><ul><li>Your clinician cannot perform a physical examination</li><li>Technical issues may occasionally disrupt the session</li><li>Some conditions may require an in-person visit</li></ul>"
          }
        ]
      },
      {
        "name": "privacy",
        "title": "Privacy & Security",
        "elements": [
          {
            "type": "html",
            "name": "privacy_notice",
            "html": "<h3>Privacy Notice</h3><p>Your telehealth session will be conducted over an encrypted, secure video connection. We do not record consultations unless explicitly agreed upon. Your personal health information is handled in accordance with the Australian Privacy Principles and the Privacy Act 1988.</p><p>You should ensure you are in a private location during your consultation where you feel comfortable discussing your health concerns.</p>"
          }
        ]
      },
      {
        "name": "consent",
        "title": "Your Consent",
        "elements": [
          {
            "type": "boolean",
            "name": "understand_telehealth",
            "title": "I understand what a telehealth consultation involves, including its benefits and limitations",
            "isRequired": true,
            "validators": [{ "type": "expression", "expression": "{understand_telehealth} = true", "text": "You must acknowledge this to continue" }]
          },
          {
            "type": "boolean",
            "name": "consent_privacy",
            "title": "I understand how my personal health information will be handled during and after the telehealth consultation",
            "isRequired": true,
            "validators": [{ "type": "expression", "expression": "{consent_privacy} = true", "text": "You must acknowledge this to continue" }]
          },
          {
            "type": "boolean",
            "name": "consent_participate",
            "title": "I consent to participate in a telehealth consultation",
            "isRequired": true,
            "validators": [{ "type": "expression", "expression": "{consent_participate} = true", "text": "You must consent to continue" }]
          },
          {
            "type": "signaturepad",
            "name": "patient_signature",
            "title": "Patient Signature",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "consent_date",
            "title": "Date",
            "inputType": "date",
            "defaultValueExpression": "today()",
            "isRequired": true
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "pages",
    "showQuestionNumbers": "off"
  }'::jsonb
);

-- 4. Mental Health Assessment (K10)
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000004',
  '00000000-0000-0000-0000-000000000001',
  'Mental Health Assessment (K10)',
  'Kessler Psychological Distress Scale — standardised 10-question mental health screening.',
  'published',
  '{
    "title": "Kessler Psychological Distress Scale (K10)",
    "description": "The following questions ask about how you have been feeling during the past 30 days. For each question, select the option that best describes how often you had this feeling.",
    "pages": [
      {
        "name": "k10_questions",
        "title": "In the past 30 days...",
        "elements": [
          {
            "type": "radiogroup",
            "name": "k10_q1",
            "title": "About how often did you feel tired out for no good reason?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q2",
            "title": "About how often did you feel nervous?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q3",
            "title": "About how often did you feel so nervous that nothing could calm you down?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q4",
            "title": "About how often did you feel hopeless?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q5",
            "title": "About how often did you feel restless or fidgety?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q6",
            "title": "About how often did you feel so restless you could not sit still?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q7",
            "title": "About how often did you feel depressed?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q8",
            "title": "About how often did you feel that everything was an effort?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q9",
            "title": "About how often did you feel so sad that nothing could cheer you up?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "k10_q10",
            "title": "About how often did you feel worthless?",
            "isRequired": true,
            "choices": [
              { "value": 1, "text": "None of the time" },
              { "value": 2, "text": "A little of the time" },
              { "value": 3, "text": "Some of the time" },
              { "value": 4, "text": "Most of the time" },
              { "value": 5, "text": "All of the time" }
            ]
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "questions",
    "showQuestionNumbers": "on"
  }'::jsonb
);

-- 5. Pain Assessment
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000005',
  '00000000-0000-0000-0000-000000000001',
  'Pain Assessment',
  'Assess pain location, severity, duration, and impact on daily life.',
  'published',
  '{
    "title": "Pain Assessment",
    "description": "Please tell us about the pain you are experiencing so your clinician can better understand your needs.",
    "pages": [
      {
        "name": "pain_location",
        "title": "Pain Location & Type",
        "elements": [
          {
            "type": "checkbox",
            "name": "pain_areas",
            "title": "Where is your pain? (Select all that apply)",
            "isRequired": true,
            "choices": [
              "Head / Neck",
              "Shoulder (Left)",
              "Shoulder (Right)",
              "Upper Back",
              "Lower Back",
              "Chest",
              "Abdomen",
              "Hip (Left)",
              "Hip (Right)",
              "Knee (Left)",
              "Knee (Right)",
              "Ankle / Foot (Left)",
              "Ankle / Foot (Right)",
              "Arm / Elbow (Left)",
              "Arm / Elbow (Right)",
              "Wrist / Hand (Left)",
              "Wrist / Hand (Right)"
            ],
            "showOtherItem": true,
            "otherText": "Other (please specify)"
          },
          {
            "type": "checkbox",
            "name": "pain_type",
            "title": "How would you describe your pain?",
            "choices": [
              "Sharp",
              "Dull / Aching",
              "Burning",
              "Throbbing",
              "Stabbing",
              "Tingling / Numbness",
              "Cramping",
              "Stiffness"
            ]
          }
        ]
      },
      {
        "name": "pain_severity",
        "title": "Pain Severity",
        "elements": [
          {
            "type": "rating",
            "name": "pain_now",
            "title": "How would you rate your pain RIGHT NOW?",
            "description": "0 = No pain, 10 = Worst pain imaginable",
            "rateMin": 0,
            "rateMax": 10,
            "isRequired": true
          },
          {
            "type": "rating",
            "name": "pain_worst",
            "title": "How would you rate your pain at its WORST in the past week?",
            "rateMin": 0,
            "rateMax": 10,
            "isRequired": true
          },
          {
            "type": "rating",
            "name": "pain_best",
            "title": "How would you rate your pain at its BEST in the past week?",
            "rateMin": 0,
            "rateMax": 10,
            "isRequired": true
          }
        ]
      },
      {
        "name": "pain_history",
        "title": "Pain History & Impact",
        "elements": [
          {
            "type": "radiogroup",
            "name": "pain_duration",
            "title": "How long have you been experiencing this pain?",
            "isRequired": true,
            "choices": [
              "Less than 1 week",
              "1–4 weeks",
              "1–3 months",
              "3–6 months",
              "6–12 months",
              "More than 1 year"
            ]
          },
          {
            "type": "radiogroup",
            "name": "pain_frequency",
            "title": "How often do you experience this pain?",
            "choices": [
              "Constant (always there)",
              "Frequent (most days)",
              "Intermittent (comes and goes)",
              "Occasional (few times a week)",
              "Rare (few times a month)"
            ]
          },
          {
            "type": "checkbox",
            "name": "pain_impact",
            "title": "Does your pain affect any of the following? (Select all that apply)",
            "choices": [
              "Sleep",
              "Work / Study",
              "Exercise / Physical activity",
              "Daily tasks (cooking, cleaning, dressing)",
              "Mood / Mental health",
              "Social life / Relationships",
              "Driving"
            ]
          },
          {
            "type": "comment",
            "name": "pain_treatments",
            "title": "What treatments have you tried for this pain? (e.g. medications, physiotherapy, heat packs)",
            "rows": 3
          },
          {
            "type": "comment",
            "name": "pain_additional",
            "title": "Is there anything else you would like your clinician to know about your pain?",
            "rows": 3
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "pages",
    "showQuestionNumbers": "off"
  }'::jsonb
);

-- 6. Patient Satisfaction Survey
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000006',
  '00000000-0000-0000-0000-000000000001',
  'Patient Satisfaction Survey',
  'Post-visit feedback — rating scales, service quality, and free-text comments.',
  'published',
  '{
    "title": "Patient Satisfaction Survey",
    "description": "We value your feedback. Please take a moment to share your experience so we can continue to improve our service.",
    "pages": [
      {
        "name": "experience",
        "title": "Your Experience",
        "elements": [
          {
            "type": "rating",
            "name": "overall_rating",
            "title": "How would you rate your overall experience?",
            "rateMin": 1,
            "rateMax": 5,
            "rateType": "stars",
            "isRequired": true
          },
          {
            "type": "matrix",
            "name": "service_ratings",
            "title": "Please rate the following aspects of your visit:",
            "isRequired": true,
            "columns": [
              { "value": 1, "text": "Poor" },
              { "value": 2, "text": "Fair" },
              { "value": 3, "text": "Good" },
              { "value": 4, "text": "Very Good" },
              { "value": 5, "text": "Excellent" }
            ],
            "rows": [
              { "value": "booking", "text": "Ease of booking" },
              { "value": "wait_time", "text": "Wait time" },
              { "value": "clinician_communication", "text": "Clinician communication" },
              { "value": "clinician_knowledge", "text": "Clinician knowledge" },
              { "value": "staff_friendliness", "text": "Staff friendliness" },
              { "value": "facility_cleanliness", "text": "Facility cleanliness" }
            ]
          },
          {
            "type": "radiogroup",
            "name": "recommend",
            "title": "How likely are you to recommend our clinic to a friend or family member?",
            "isRequired": true,
            "choices": [
              "Very likely",
              "Likely",
              "Neutral",
              "Unlikely",
              "Very unlikely"
            ]
          }
        ]
      },
      {
        "name": "comments",
        "title": "Additional Feedback",
        "elements": [
          {
            "type": "comment",
            "name": "positive_feedback",
            "title": "What did we do well?",
            "rows": 3
          },
          {
            "type": "comment",
            "name": "improvement_feedback",
            "title": "How could we improve?",
            "rows": 3
          },
          {
            "type": "boolean",
            "name": "contact_permission",
            "title": "May we contact you to follow up on your feedback?"
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "pages",
    "showQuestionNumbers": "off",
    "completedHtml": "<h3>Thank you for your feedback!</h3><p>We appreciate you taking the time to share your experience.</p>"
  }'::jsonb
);

-- 7. NDIS Intake
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000007',
  '00000000-0000-0000-0000-000000000001',
  'NDIS Intake',
  'Collect NDIS participant details, plan information, goals, and support coordinator info.',
  'published',
  '{
    "title": "NDIS Intake Form",
    "description": "Please provide your NDIS details so we can set up your care correctly.",
    "pages": [
      {
        "name": "ndis_details",
        "title": "NDIS Details",
        "elements": [
          {
            "type": "text",
            "name": "ndis_number",
            "title": "NDIS Participant Number",
            "isRequired": true,
            "validators": [{ "type": "regex", "regex": "^[0-9]{9}$", "text": "NDIS number must be 9 digits" }]
          },
          {
            "type": "text",
            "name": "plan_start_date",
            "title": "Plan Start Date",
            "inputType": "date",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "plan_end_date",
            "title": "Plan End Date",
            "inputType": "date",
            "isRequired": true
          },
          {
            "type": "radiogroup",
            "name": "plan_managed_by",
            "title": "How is your plan managed?",
            "isRequired": true,
            "choices": [
              "Self-managed",
              "Plan-managed",
              "NDIA-managed"
            ]
          },
          {
            "type": "text",
            "name": "plan_manager_name",
            "title": "Plan Manager Name (if applicable)",
            "visibleIf": "{plan_managed_by} = ''Plan-managed''"
          },
          {
            "type": "text",
            "name": "plan_manager_email",
            "title": "Plan Manager Email",
            "inputType": "email",
            "visibleIf": "{plan_managed_by} = ''Plan-managed''"
          }
        ]
      },
      {
        "name": "support_coordinator",
        "title": "Support Coordination",
        "elements": [
          {
            "type": "boolean",
            "name": "has_support_coordinator",
            "title": "Do you have a Support Coordinator?"
          },
          {
            "type": "text",
            "name": "coordinator_name",
            "title": "Support Coordinator Name",
            "visibleIf": "{has_support_coordinator} = true"
          },
          {
            "type": "text",
            "name": "coordinator_organisation",
            "title": "Support Coordinator Organisation",
            "visibleIf": "{has_support_coordinator} = true"
          },
          {
            "type": "text",
            "name": "coordinator_phone",
            "title": "Support Coordinator Phone",
            "inputType": "tel",
            "visibleIf": "{has_support_coordinator} = true"
          },
          {
            "type": "text",
            "name": "coordinator_email",
            "title": "Support Coordinator Email",
            "inputType": "email",
            "visibleIf": "{has_support_coordinator} = true"
          }
        ]
      },
      {
        "name": "goals",
        "title": "Your Goals",
        "elements": [
          {
            "type": "html",
            "name": "goals_intro",
            "html": "<p>Understanding your goals helps us tailor our services to your needs. Please share what you would like to achieve.</p>"
          },
          {
            "type": "paneldynamic",
            "name": "ndis_goals",
            "title": "Your NDIS Goals",
            "panelCount": 1,
            "minPanelCount": 1,
            "panelAddText": "Add another goal",
            "templateElements": [
              {
                "type": "text",
                "name": "goal_description",
                "title": "Goal",
                "isRequired": true
              },
              {
                "type": "comment",
                "name": "goal_details",
                "title": "What does achieving this goal look like for you?",
                "rows": 2
              }
            ]
          },
          {
            "type": "comment",
            "name": "additional_needs",
            "title": "Is there anything else we should know about your support needs?",
            "rows": 3
          }
        ]
      },
      {
        "name": "consent",
        "title": "Consent",
        "elements": [
          {
            "type": "html",
            "name": "ndis_consent_text",
            "html": "<p>I consent to this provider accessing my NDIS plan details for the purpose of delivering supports. I understand that my information will be handled in accordance with the provider''s privacy policy and the NDIS Act 2013.</p>"
          },
          {
            "type": "boolean",
            "name": "ndis_consent_agreed",
            "title": "I agree to the above",
            "isRequired": true,
            "validators": [{ "type": "expression", "expression": "{ndis_consent_agreed} = true", "text": "You must agree to continue" }]
          },
          {
            "type": "signaturepad",
            "name": "participant_signature",
            "title": "Participant Signature",
            "isRequired": true
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "pages",
    "showQuestionNumbers": "off"
  }'::jsonb
);

-- 8. Pre-Appointment Screening
INSERT INTO forms (id, org_id, name, description, status, schema) VALUES (
  '00000000-0000-0000-0000-f00000000008',
  '00000000-0000-0000-0000-000000000001',
  'Pre-Appointment Screening',
  'COVID/illness symptoms, recent travel, and exposure screening.',
  'published',
  '{
    "title": "Pre-Appointment Health Screening",
    "description": "To help keep everyone safe, please answer the following screening questions before your appointment.",
    "pages": [
      {
        "name": "symptoms",
        "title": "Symptom Check",
        "elements": [
          {
            "type": "html",
            "name": "symptoms_intro",
            "html": "<p>In the <strong>past 7 days</strong>, have you experienced any of the following symptoms?</p>"
          },
          {
            "type": "checkbox",
            "name": "current_symptoms",
            "title": "Select any symptoms you are currently experiencing:",
            "choices": [
              "Fever or chills",
              "Cough",
              "Sore throat",
              "Shortness of breath",
              "Runny nose or congestion",
              "Loss of taste or smell",
              "Nausea, vomiting, or diarrhoea",
              "Body aches or fatigue",
              "Headache"
            ],
            "showNoneItem": true,
            "noneText": "I have no symptoms"
          },
          {
            "type": "boolean",
            "name": "tested_positive",
            "title": "Have you tested positive for COVID-19 or influenza in the past 7 days?",
            "isRequired": true
          }
        ]
      },
      {
        "name": "exposure",
        "title": "Exposure & Travel",
        "elements": [
          {
            "type": "boolean",
            "name": "close_contact",
            "title": "Have you been in close contact with anyone who has tested positive for COVID-19 or influenza in the past 7 days?",
            "isRequired": true
          },
          {
            "type": "boolean",
            "name": "recent_travel",
            "title": "Have you returned from overseas travel in the past 14 days?",
            "isRequired": true
          },
          {
            "type": "text",
            "name": "travel_details",
            "title": "If yes, where did you travel?",
            "visibleIf": "{recent_travel} = true"
          }
        ]
      },
      {
        "name": "declaration",
        "title": "Declaration",
        "elements": [
          {
            "type": "html",
            "name": "declaration_text",
            "html": "<p>I declare that the information provided above is true and correct to the best of my knowledge. I understand that if my health status changes before my appointment, I should contact the clinic.</p>"
          },
          {
            "type": "boolean",
            "name": "declaration_agreed",
            "title": "I confirm the above declaration",
            "isRequired": true,
            "validators": [{ "type": "expression", "expression": "{declaration_agreed} = true", "text": "You must confirm the declaration" }]
          },
          {
            "type": "signaturepad",
            "name": "patient_signature",
            "title": "Signature",
            "isRequired": true
          }
        ]
      }
    ],
    "showProgressBar": "top",
    "progressBarType": "pages",
    "showQuestionNumbers": "off"
  }'::jsonb
);
