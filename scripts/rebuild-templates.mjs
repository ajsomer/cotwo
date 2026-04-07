import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ORG_ID = '7d6b170c-19c5-461a-9af2-d320a88db341';

const templates = {
  'New Patient Intake': {
    title: 'New patient intake form',
    showQuestionNumbers: 'off',
    pages: [
      {
        name: 'personal_details',
        title: 'Personal details',
        elements: [
          {
            type: 'panel',
            name: 'panel_personal',
            title: 'Personal details',
            elements: [
              { type: 'text', name: 'firstName', title: 'First name', isRequired: true },
              { type: 'text', name: 'lastName', title: 'Last name', isRequired: true, startWithNewLine: false },
              { type: 'text', name: 'dateOfBirth', title: 'Date of birth', inputType: 'date', isRequired: true },
              {
                type: 'radiogroup',
                name: 'gender',
                title: 'Gender',
                isRequired: true,
                choices: ['Male', 'Female', 'Non-binary', 'Prefer not to say'],
              },
            ],
          },
        ],
      },
      {
        name: 'contact_information',
        title: 'Contact information',
        elements: [
          {
            type: 'panel',
            name: 'panel_contact',
            title: 'Contact information',
            elements: [
              { type: 'text', name: 'email', title: 'Email address', inputType: 'email' },
              { type: 'text', name: 'mobilePhone', title: 'Mobile phone', inputType: 'tel' },
              { type: 'comment', name: 'homeAddress', title: 'Home address', rows: 2 },
            ],
          },
        ],
      },
      {
        name: 'emergency_contact',
        title: 'Emergency contact',
        elements: [
          {
            type: 'panel',
            name: 'panel_emergency',
            title: 'Emergency contact',
            elements: [
              { type: 'text', name: 'emergencyContactName', title: 'Emergency contact name', isRequired: true },
              {
                type: 'dropdown',
                name: 'emergencyContactRelationship',
                title: 'Relationship to you',
                isRequired: true,
                choices: ['Partner', 'Parent', 'Sibling', 'Child', 'Friend', 'Other'],
              },
              { type: 'text', name: 'emergencyContactPhone', title: 'Emergency contact phone', inputType: 'tel', isRequired: true },
            ],
          },
        ],
      },
      {
        name: 'medicare_details',
        title: 'Medicare details',
        elements: [
          {
            type: 'panel',
            name: 'panel_medicare',
            title: 'Medicare details',
            description: 'Optional — skip if you don\'t have Medicare',
            elements: [
              { type: 'text', name: 'medicareNumber', title: 'Medicare number' },
              { type: 'text', name: 'medicareIRN', title: 'Reference number (IRN)', startWithNewLine: false },
              { type: 'text', name: 'medicareExpiry', title: 'Expiry date', placeholder: 'MM/YY' },
              { type: 'text', name: 'privateHealthFund', title: 'Private health fund' },
              { type: 'text', name: 'privateHealthMemberNumber', title: 'Member number', startWithNewLine: false },
            ],
          },
        ],
      },
      {
        name: 'medical_history_consent',
        title: 'Medical history and consent',
        elements: [
          {
            type: 'panel',
            name: 'panel_health',
            title: 'Current health',
            elements: [
              { type: 'boolean', name: 'hasConditions', title: 'Do you have any current medical conditions?' },
              { type: 'comment', name: 'conditionsDescription', title: 'Please describe your conditions', visibleIf: '{hasConditions} = true', rows: 3 },
              { type: 'comment', name: 'currentMedications', title: 'Current medications', rows: 2 },
              { type: 'comment', name: 'allergies', title: 'Allergies', rows: 2 },
            ],
          },
          {
            type: 'panel',
            name: 'panel_consent',
            title: 'Consent',
            elements: [
              { type: 'boolean', name: 'consentHealthInfo', title: 'I consent to the collection and use of my health information for the purposes of my care', isRequired: true, requiredErrorText: 'You must provide consent to continue' },
              { type: 'boolean', name: 'consentPrivacyPolicy', title: 'I have read and understood the practice privacy policy', isRequired: true, requiredErrorText: 'You must acknowledge the privacy policy to continue' },
            ],
          },
        ],
      },
    ],
  },

  'Referral Upload': {
    title: 'Referral upload',
    showQuestionNumbers: 'off',
    pages: [
      {
        name: 'referral',
        title: 'Your referral',
        elements: [
          {
            type: 'panel',
            name: 'panel_upload',
            title: 'Upload your referral',
            description: 'Take a photo or upload a PDF of your referral letter',
            elements: [
              { type: 'file', name: 'referralDocument', title: 'Referral document', isRequired: true, storeDataAsText: true, allowMultiple: true, maxSize: 10485760, acceptedTypes: '.pdf,.jpg,.jpeg,.png,.heic' },
              { type: 'comment', name: 'referralNotes', title: 'Additional notes about your referral', rows: 3 },
            ],
          },
        ],
      },
      {
        name: 'referring_doctor',
        title: 'Referring doctor',
        elements: [
          {
            type: 'panel',
            name: 'panel_doctor',
            title: 'Referring doctor details',
            elements: [
              { type: 'text', name: 'doctorName', title: 'Doctor\'s name', isRequired: true },
              { type: 'text', name: 'practiceName', title: 'Practice name', startWithNewLine: false },
              { type: 'text', name: 'doctorPhone', title: 'Doctor\'s phone', inputType: 'tel' },
              { type: 'text', name: 'doctorEmail', title: 'Doctor\'s email', inputType: 'email', startWithNewLine: false },
              { type: 'text', name: 'referralDate', title: 'Date of referral', inputType: 'date' },
              { type: 'text', name: 'reasonForReferral', title: 'Reason for referral', isRequired: true },
            ],
          },
        ],
      },
    ],
  },

  'Consent to Telehealth': {
    title: 'Consent to telehealth',
    showQuestionNumbers: 'off',
    pages: [
      {
        name: 'about_telehealth',
        title: 'About telehealth',
        elements: [
          {
            type: 'panel',
            name: 'panel_about',
            title: 'What is telehealth?',
            elements: [
              {
                type: 'html',
                name: 'telehealthInfo',
                html: '<p>Telehealth uses video conferencing to allow you to have a consultation with your clinician without visiting the clinic in person.</p><p style="margin-top:12px"><strong>Benefits:</strong> Access care from home, reduce travel time, maintain continuity of care.</p><p style="margin-top:12px"><strong>Limitations:</strong> Your clinician cannot perform a physical examination. Technical issues may occasionally disrupt the session. Some conditions may require an in-person visit.</p>',
              },
            ],
          },
        ],
      },
      {
        name: 'privacy',
        title: 'Privacy and security',
        elements: [
          {
            type: 'panel',
            name: 'panel_privacy',
            title: 'Privacy and security',
            elements: [
              {
                type: 'html',
                name: 'privacyNotice',
                html: '<p>Your telehealth session will be conducted over an encrypted, secure video connection. We do not record consultations unless explicitly agreed upon.</p><p style="margin-top:12px">Your personal health information is handled in accordance with the Australian Privacy Principles and the Privacy Act 1988.</p><p style="margin-top:12px">Please ensure you are in a private location during your consultation.</p>',
              },
            ],
          },
        ],
      },
      {
        name: 'consent',
        title: 'Your consent',
        elements: [
          {
            type: 'panel',
            name: 'panel_consent',
            title: 'Your consent',
            elements: [
              { type: 'boolean', name: 'understandTelehealth', title: 'I understand what a telehealth consultation involves, including its benefits and limitations', isRequired: true, requiredErrorText: 'You must acknowledge this to continue' },
              { type: 'boolean', name: 'consentPrivacy', title: 'I understand how my personal health information will be handled', isRequired: true, requiredErrorText: 'You must acknowledge this to continue' },
              { type: 'boolean', name: 'consentParticipate', title: 'I consent to participate in a telehealth consultation', isRequired: true, requiredErrorText: 'You must provide consent to continue' },
              { type: 'signaturepad', name: 'patientSignature', title: 'Patient signature', isRequired: true },
              { type: 'text', name: 'consentDate', title: 'Date', inputType: 'date', defaultValueExpression: 'today()', isRequired: true },
            ],
          },
        ],
      },
    ],
  },

  'Mental Health Assessment (K10)': {
    title: 'Kessler psychological distress scale (K10)',
    description: 'The following questions ask about how you have been feeling during the past 30 days.',
    showQuestionNumbers: 'on',
    pages: [
      {
        name: 'k10',
        title: 'In the past 30 days',
        elements: [
          {
            type: 'panel',
            name: 'panel_k10',
            title: 'In the past 30 days...',
            elements: [
              ...['tired out for no good reason', 'nervous', 'so nervous that nothing could calm you down', 'hopeless', 'restless or fidgety', 'so restless you could not sit still', 'depressed', 'that everything was an effort', 'so sad that nothing could cheer you up', 'worthless'].map((q, i) => ({
                type: 'radiogroup',
                name: `k10_q${i + 1}`,
                title: `About how often did you feel ${q}?`,
                isRequired: true,
                requiredErrorText: 'Please select a response',
                choices: [
                  { value: 1, text: 'None of the time' },
                  { value: 2, text: 'A little of the time' },
                  { value: 3, text: 'Some of the time' },
                  { value: 4, text: 'Most of the time' },
                  { value: 5, text: 'All of the time' },
                ],
              })),
            ],
          },
        ],
      },
    ],
  },

  'Pain Assessment': {
    title: 'Pain assessment',
    showQuestionNumbers: 'off',
    pages: [
      {
        name: 'pain_location',
        title: 'Pain location and type',
        elements: [
          {
            type: 'panel',
            name: 'panel_location',
            title: 'Where is your pain?',
            elements: [
              {
                type: 'checkbox',
                name: 'painAreas',
                title: 'Select all areas that apply',
                isRequired: true,
                requiredErrorText: 'Please select at least one area',
                choices: ['Head / Neck', 'Shoulder (left)', 'Shoulder (right)', 'Upper back', 'Lower back', 'Chest', 'Abdomen', 'Hip (left)', 'Hip (right)', 'Knee (left)', 'Knee (right)', 'Ankle / Foot (left)', 'Ankle / Foot (right)', 'Arm / Elbow (left)', 'Arm / Elbow (right)', 'Wrist / Hand (left)', 'Wrist / Hand (right)'],
                showOtherItem: true,
                otherText: 'Other (please specify)',
              },
              {
                type: 'checkbox',
                name: 'painType',
                title: 'How would you describe your pain?',
                choices: ['Sharp', 'Dull / Aching', 'Burning', 'Throbbing', 'Stabbing', 'Tingling / Numbness', 'Cramping', 'Stiffness'],
              },
            ],
          },
        ],
      },
      {
        name: 'pain_severity',
        title: 'Pain severity',
        elements: [
          {
            type: 'panel',
            name: 'panel_severity',
            title: 'Rate your pain',
            description: '0 = no pain, 10 = worst pain imaginable',
            elements: [
              { type: 'rating', name: 'painNow', title: 'Pain right now', rateMin: 0, rateMax: 10, isRequired: true },
              { type: 'rating', name: 'painWorst', title: 'Pain at its worst in the past week', rateMin: 0, rateMax: 10, isRequired: true },
              { type: 'rating', name: 'painBest', title: 'Pain at its best in the past week', rateMin: 0, rateMax: 10, isRequired: true },
            ],
          },
        ],
      },
      {
        name: 'pain_history',
        title: 'Pain history and impact',
        elements: [
          {
            type: 'panel',
            name: 'panel_history',
            title: 'Pain history',
            elements: [
              {
                type: 'radiogroup',
                name: 'painDuration',
                title: 'How long have you been experiencing this pain?',
                isRequired: true,
                choices: ['Less than 1 week', '1–4 weeks', '1–3 months', '3–6 months', '6–12 months', 'More than 1 year'],
              },
              {
                type: 'radiogroup',
                name: 'painFrequency',
                title: 'How often do you experience this pain?',
                choices: ['Constant (always there)', 'Frequent (most days)', 'Intermittent (comes and goes)', 'Occasional (few times a week)', 'Rare (few times a month)'],
              },
            ],
          },
          {
            type: 'panel',
            name: 'panel_impact',
            title: 'Impact on daily life',
            elements: [
              {
                type: 'checkbox',
                name: 'painImpact',
                title: 'Does your pain affect any of the following?',
                choices: ['Sleep', 'Work / Study', 'Exercise / Physical activity', 'Daily tasks (cooking, cleaning, dressing)', 'Mood / Mental health', 'Social life / Relationships', 'Driving'],
              },
              { type: 'comment', name: 'painTreatments', title: 'What treatments have you tried for this pain?', rows: 3 },
              { type: 'comment', name: 'painAdditional', title: 'Anything else you would like your clinician to know?', rows: 3 },
            ],
          },
        ],
      },
    ],
  },

  'Patient Satisfaction Survey': {
    title: 'Patient satisfaction survey',
    showQuestionNumbers: 'off',
    completedHtml: '<div style="text-align:center;padding:24px"><h3>Thank you for your feedback</h3><p>We appreciate you taking the time to share your experience.</p></div>',
    pages: [
      {
        name: 'experience',
        title: 'Your experience',
        elements: [
          {
            type: 'panel',
            name: 'panel_ratings',
            title: 'Rate your experience',
            elements: [
              { type: 'rating', name: 'overallRating', title: 'Overall experience', rateMin: 1, rateMax: 5, rateType: 'stars', isRequired: true },
              {
                type: 'matrix',
                name: 'serviceRatings',
                title: 'Please rate the following',
                isRequired: true,
                columns: [
                  { value: 1, text: 'Poor' },
                  { value: 2, text: 'Fair' },
                  { value: 3, text: 'Good' },
                  { value: 4, text: 'Very good' },
                  { value: 5, text: 'Excellent' },
                ],
                rows: [
                  { value: 'booking', text: 'Ease of booking' },
                  { value: 'waitTime', text: 'Wait time' },
                  { value: 'clinicianCommunication', text: 'Clinician communication' },
                  { value: 'clinicianKnowledge', text: 'Clinician knowledge' },
                  { value: 'staffFriendliness', text: 'Staff friendliness' },
                  { value: 'facilityCleanliness', text: 'Facility cleanliness' },
                ],
              },
              {
                type: 'radiogroup',
                name: 'recommend',
                title: 'How likely are you to recommend our clinic to a friend or family member?',
                isRequired: true,
                choices: ['Very likely', 'Likely', 'Neutral', 'Unlikely', 'Very unlikely'],
              },
            ],
          },
        ],
      },
      {
        name: 'comments',
        title: 'Additional feedback',
        elements: [
          {
            type: 'panel',
            name: 'panel_feedback',
            title: 'Your feedback',
            elements: [
              { type: 'comment', name: 'positiveFeedback', title: 'What did we do well?', rows: 3 },
              { type: 'comment', name: 'improvementFeedback', title: 'How could we improve?', rows: 3 },
              { type: 'boolean', name: 'contactPermission', title: 'May we contact you to follow up on your feedback?' },
            ],
          },
        ],
      },
    ],
  },

  'NDIS Intake': {
    title: 'NDIS intake form',
    showQuestionNumbers: 'off',
    pages: [
      {
        name: 'ndis_details',
        title: 'NDIS details',
        elements: [
          {
            type: 'panel',
            name: 'panel_ndis',
            title: 'NDIS plan details',
            elements: [
              { type: 'text', name: 'ndisNumber', title: 'NDIS participant number', isRequired: true, validators: [{ type: 'regex', regex: '^[0-9]{9}$', text: 'NDIS number must be 9 digits' }] },
              { type: 'text', name: 'planStartDate', title: 'Plan start date', inputType: 'date', isRequired: true },
              { type: 'text', name: 'planEndDate', title: 'Plan end date', inputType: 'date', isRequired: true, startWithNewLine: false },
              {
                type: 'radiogroup',
                name: 'planManagedBy',
                title: 'How is your plan managed?',
                isRequired: true,
                choices: ['Self-managed', 'Plan-managed', 'NDIA-managed'],
              },
              { type: 'text', name: 'planManagerName', title: 'Plan manager name', visibleIf: '{planManagedBy} = "Plan-managed"' },
              { type: 'text', name: 'planManagerEmail', title: 'Plan manager email', inputType: 'email', visibleIf: '{planManagedBy} = "Plan-managed"', startWithNewLine: false },
            ],
          },
        ],
      },
      {
        name: 'support_coordinator',
        title: 'Support coordination',
        elements: [
          {
            type: 'panel',
            name: 'panel_coordinator',
            title: 'Support coordinator',
            elements: [
              { type: 'boolean', name: 'hasSupportCoordinator', title: 'Do you have a support coordinator?' },
              { type: 'text', name: 'coordinatorName', title: 'Coordinator name', visibleIf: '{hasSupportCoordinator} = true' },
              { type: 'text', name: 'coordinatorOrganisation', title: 'Organisation', visibleIf: '{hasSupportCoordinator} = true', startWithNewLine: false },
              { type: 'text', name: 'coordinatorPhone', title: 'Coordinator phone', inputType: 'tel', visibleIf: '{hasSupportCoordinator} = true' },
              { type: 'text', name: 'coordinatorEmail', title: 'Coordinator email', inputType: 'email', visibleIf: '{hasSupportCoordinator} = true', startWithNewLine: false },
            ],
          },
        ],
      },
      {
        name: 'goals',
        title: 'Your goals',
        elements: [
          {
            type: 'panel',
            name: 'panel_goals',
            title: 'Your goals',
            description: 'Understanding your goals helps us tailor our services to your needs',
            elements: [
              {
                type: 'paneldynamic',
                name: 'ndisGoals',
                title: 'NDIS goals',
                panelCount: 1,
                minPanelCount: 1,
                panelAddText: 'Add another goal',
                templateElements: [
                  { type: 'text', name: 'goalDescription', title: 'Goal', isRequired: true },
                  { type: 'comment', name: 'goalDetails', title: 'What does achieving this goal look like for you?', rows: 2 },
                ],
              },
              { type: 'comment', name: 'additionalNeeds', title: 'Anything else we should know about your support needs?', rows: 3 },
            ],
          },
        ],
      },
      {
        name: 'consent',
        title: 'Consent',
        elements: [
          {
            type: 'panel',
            name: 'panel_consent',
            title: 'Consent',
            elements: [
              {
                type: 'html',
                name: 'ndisConsentText',
                html: '<p>I consent to this provider accessing my NDIS plan details for the purpose of delivering supports. I understand that my information will be handled in accordance with the provider\'s privacy policy and the NDIS Act 2013.</p>',
              },
              { type: 'boolean', name: 'ndisConsentAgreed', title: 'I agree to the above', isRequired: true, requiredErrorText: 'You must agree to continue' },
              { type: 'signaturepad', name: 'participantSignature', title: 'Participant signature', isRequired: true },
            ],
          },
        ],
      },
    ],
  },

  'Pre-Appointment Screening': {
    title: 'Pre-appointment health screening',
    showQuestionNumbers: 'off',
    pages: [
      {
        name: 'symptoms',
        title: 'Symptom check',
        elements: [
          {
            type: 'panel',
            name: 'panel_symptoms',
            title: 'Symptom check',
            description: 'In the past 7 days, have you experienced any of the following?',
            elements: [
              {
                type: 'checkbox',
                name: 'currentSymptoms',
                title: 'Select any symptoms you are currently experiencing',
                choices: ['Fever or chills', 'Cough', 'Sore throat', 'Shortness of breath', 'Runny nose or congestion', 'Loss of taste or smell', 'Nausea, vomiting, or diarrhoea', 'Body aches or fatigue', 'Headache'],
                showNoneItem: true,
                noneText: 'I have no symptoms',
              },
              { type: 'boolean', name: 'testedPositive', title: 'Have you tested positive for COVID-19 or influenza in the past 7 days?', isRequired: true },
            ],
          },
        ],
      },
      {
        name: 'exposure',
        title: 'Exposure and travel',
        elements: [
          {
            type: 'panel',
            name: 'panel_exposure',
            title: 'Exposure and travel',
            elements: [
              { type: 'boolean', name: 'closeContact', title: 'Have you been in close contact with anyone who has tested positive for COVID-19 or influenza in the past 7 days?', isRequired: true },
              { type: 'boolean', name: 'recentTravel', title: 'Have you returned from overseas travel in the past 14 days?', isRequired: true },
              { type: 'text', name: 'travelDetails', title: 'Where did you travel?', visibleIf: '{recentTravel} = true' },
            ],
          },
        ],
      },
      {
        name: 'declaration',
        title: 'Declaration',
        elements: [
          {
            type: 'panel',
            name: 'panel_declaration',
            title: 'Declaration',
            elements: [
              {
                type: 'html',
                name: 'declarationText',
                html: '<p>I declare that the information provided above is true and correct to the best of my knowledge. I understand that if my health status changes before my appointment, I should contact the clinic.</p>',
              },
              { type: 'boolean', name: 'declarationAgreed', title: 'I confirm the above declaration', isRequired: true, requiredErrorText: 'You must confirm the declaration' },
              { type: 'signaturepad', name: 'patientSignature', title: 'Signature', isRequired: true },
            ],
          },
        ],
      },
    ],
  },
};

// Strip title and description from all panels — page titles are the section headings
function stripPanelTitles(obj) {
  if (Array.isArray(obj)) {
    return obj.map(stripPanelTitles);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (obj.type === 'panel' && (key === 'title' || key === 'description')) {
        continue; // skip panel titles and descriptions
      }
      result[key] = stripPanelTitles(value);
    }
    return result;
  }
  return obj;
}

async function rebuild() {
  for (const [name, rawSchema] of Object.entries(templates)) {
    const schema = stripPanelTitles(rawSchema);
    const { data, error } = await supabase
      .from('forms')
      .update({ schema })
      .eq('org_id', ORG_ID)
      .eq('name', name)
      .select('id, name');

    if (error) {
      console.error(`Failed to update "${name}":`, error.message);
    } else if (data?.length) {
      console.log(`Updated: ${name} (${data[0].id})`);
    } else {
      console.log(`Not found: ${name}`);
    }
  }

  // Also update the seed org templates
  const SEED_ORG = '00000000-0000-0000-0000-000000000001';
  for (const [name, rawSchema] of Object.entries(templates)) {
    const schema = stripPanelTitles(rawSchema);
    await supabase.from('forms').update({ schema }).eq('org_id', SEED_ORG).eq('name', name);
  }
  console.log('\nAlso updated seed org templates.');
}

rebuild();
