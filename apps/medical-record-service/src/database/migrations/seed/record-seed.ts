// Reference data for record_db (DATABASE.md §9). Codes and titles follow
// WHO ICD-10; the list covers what the five departments (GEN, CARD, PED,
// NEURO, ORTH) see most. Lab test codes match billing's 'LAB-<code>'.

const CIRC = 'Diseases of the circulatory system';
const ENDO = 'Endocrine, nutritional and metabolic diseases';
const RESP = 'Diseases of the respiratory system';
const DIG = 'Diseases of the digestive system';
const MSK = 'Diseases of the musculoskeletal system';
const NERV = 'Diseases of the nervous system';
const GU = 'Diseases of the genitourinary system';
const BLOOD = 'Diseases of the blood';
const SYMP = 'Symptoms, signs and abnormal findings';
const HEALTH = 'Factors influencing health status';
const INF = 'Certain infectious and parasitic diseases';
const MENT = 'Mental and behavioural disorders';
const SKIN = 'Diseases of the skin and subcutaneous tissue';
const EAR = 'Diseases of the ear and mastoid process';
const EYE = 'Diseases of the eye and adnexa';
const INJ = 'Injury, poisoning and external causes';

export const ICD10_SEED: [code: string, title: string, chapter: string][] = [
  // Circulatory (CARD)
  ['I10', 'Essential (primary) hypertension', CIRC],
  ['I11.9', 'Hypertensive heart disease without heart failure', CIRC],
  ['I20.9', 'Angina pectoris, unspecified', CIRC],
  ['I21.9', 'Acute myocardial infarction, unspecified', CIRC],
  ['I25.1', 'Atherosclerotic heart disease', CIRC],
  ['I34.0', 'Mitral (valve) insufficiency', CIRC],
  ['I42.9', 'Cardiomyopathy, unspecified', CIRC],
  ['I47.1', 'Supraventricular tachycardia', CIRC],
  ['I48.9', 'Atrial fibrillation and atrial flutter, unspecified', CIRC],
  ['I49.9', 'Cardiac arrhythmia, unspecified', CIRC],
  ['I50.9', 'Heart failure, unspecified', CIRC],
  ['I63.9', 'Cerebral infarction, unspecified', CIRC],
  [
    'I83.9',
    'Varicose veins of lower extremities without ulcer or inflammation',
    CIRC,
  ],
  ['I95.9', 'Hypotension, unspecified', CIRC],
  // Endocrine
  ['E03.9', 'Hypothyroidism, unspecified', ENDO],
  ['E05.9', 'Thyrotoxicosis, unspecified', ENDO],
  ['E10.9', 'Type 1 diabetes mellitus without complications', ENDO],
  ['E11.9', 'Type 2 diabetes mellitus without complications', ENDO],
  ['E55.9', 'Vitamin D deficiency, unspecified', ENDO],
  ['E66.9', 'Obesity, unspecified', ENDO],
  ['E78.0', 'Pure hypercholesterolaemia', ENDO],
  ['E78.5', 'Hyperlipidaemia, unspecified', ENDO],
  ['E86', 'Volume depletion', ENDO],
  // Respiratory (GEN, PED)
  ['J00', 'Acute nasopharyngitis (common cold)', RESP],
  ['J01.9', 'Acute sinusitis, unspecified', RESP],
  ['J02.9', 'Acute pharyngitis, unspecified', RESP],
  ['J03.9', 'Acute tonsillitis, unspecified', RESP],
  ['J06.9', 'Acute upper respiratory infection, unspecified', RESP],
  [
    'J11.1',
    'Influenza with other respiratory manifestations, virus not identified',
    RESP,
  ],
  ['J18.9', 'Pneumonia, unspecified organism', RESP],
  ['J20.9', 'Acute bronchitis, unspecified', RESP],
  ['J30.4', 'Allergic rhinitis, unspecified', RESP],
  ['J44.9', 'Chronic obstructive pulmonary disease, unspecified', RESP],
  ['J45.9', 'Asthma, unspecified', RESP],
  // Digestive
  ['K21.9', 'Gastro-oesophageal reflux disease without oesophagitis', DIG],
  ['K25.9', 'Gastric ulcer, unspecified', DIG],
  ['K29.7', 'Gastritis, unspecified', DIG],
  ['K30', 'Functional dyspepsia', DIG],
  ['K52.9', 'Noninfective gastroenteritis and colitis, unspecified', DIG],
  ['K58.9', 'Irritable bowel syndrome without diarrhoea', DIG],
  ['K59.0', 'Constipation', DIG],
  ['K76.0', 'Fatty (change of) liver, not elsewhere classified', DIG],
  ['K80.2', 'Calculus of gallbladder without cholecystitis', DIG],
  // Musculoskeletal (ORTH)
  ['M10.9', 'Gout, unspecified', MSK],
  ['M17.9', 'Gonarthrosis, unspecified', MSK],
  ['M16.9', 'Coxarthrosis, unspecified', MSK],
  ['M19.9', 'Arthrosis, unspecified', MSK],
  ['M25.5', 'Pain in joint', MSK],
  ['M41.9', 'Scoliosis, unspecified', MSK],
  ['M51.2', 'Other specified intervertebral disc displacement', MSK],
  ['M54.2', 'Cervicalgia', MSK],
  ['M54.4', 'Lumbago with sciatica', MSK],
  ['M54.5', 'Low back pain', MSK],
  ['M65.9', 'Synovitis and tenosynovitis, unspecified', MSK],
  ['M75.1', 'Rotator cuff syndrome', MSK],
  ['M77.1', 'Lateral epicondylitis', MSK],
  ['M79.1', 'Myalgia', MSK],
  ['M81.9', 'Osteoporosis, unspecified', MSK],
  // Injuries (ORTH)
  ['S52.5', 'Fracture of lower end of radius', INJ],
  ['S62.6', 'Fracture of other finger', INJ],
  ['S82.6', 'Fracture of lateral malleolus', INJ],
  [
    'S83.5',
    'Sprain and strain involving (anterior)(posterior) cruciate ligament of knee',
    INJ,
  ],
  ['S93.4', 'Sprain and strain of ankle', INJ],
  ['T78.4', 'Allergy, unspecified', INJ],
  // Nervous (NEURO)
  ['G20', 'Parkinson disease', NERV],
  ['G35', 'Multiple sclerosis', NERV],
  ['G40.9', 'Epilepsy, unspecified', NERV],
  ['G43.9', 'Migraine, unspecified', NERV],
  ['G44.2', 'Tension-type headache', NERV],
  ['G45.9', 'Transient cerebral ischaemic attack, unspecified', NERV],
  ['G47.0', 'Disorders of initiating and maintaining sleep [insomnias]', NERV],
  ['G51.0', 'Bell palsy', NERV],
  ['G56.0', 'Carpal tunnel syndrome', NERV],
  ['G62.9', 'Polyneuropathy, unspecified', NERV],
  // Mental
  ['F32.9', 'Depressive episode, unspecified', MENT],
  ['F41.1', 'Generalized anxiety disorder', MENT],
  ['F90.0', 'Disturbance of activity and attention', MENT],
  // Genitourinary
  ['N10', 'Acute tubulo-interstitial nephritis', GU],
  ['N18.9', 'Chronic kidney disease, unspecified', GU],
  ['N20.0', 'Calculus of kidney', GU],
  ['N30.0', 'Acute cystitis', GU],
  ['N39.0', 'Urinary tract infection, site not specified', GU],
  ['N40', 'Hyperplasia of prostate', GU],
  // Blood
  ['D50.9', 'Iron deficiency anaemia, unspecified', BLOOD],
  ['D64.9', 'Anaemia, unspecified', BLOOD],
  // Infectious (PED, GEN)
  [
    'A09',
    'Other gastroenteritis and colitis of infectious and unspecified origin',
    INF,
  ],
  ['B01.9', 'Varicella without complication', INF],
  ['B34.9', 'Viral infection, unspecified', INF],
  ['U07.1', 'COVID-19, virus identified', INF],
  // Skin, ear, eye
  ['L20.9', 'Atopic dermatitis, unspecified', SKIN],
  ['L50.9', 'Urticaria, unspecified', SKIN],
  ['H10.9', 'Conjunctivitis, unspecified', EYE],
  ['H66.9', 'Otitis media, unspecified', EAR],
  // Symptoms
  ['R05', 'Cough', SYMP],
  ['R07.4', 'Chest pain, unspecified', SYMP],
  ['R10.4', 'Other and unspecified abdominal pain', SYMP],
  ['R42', 'Dizziness and giddiness', SYMP],
  ['R50.9', 'Fever, unspecified', SYMP],
  ['R51', 'Headache', SYMP],
  ['R53', 'Malaise and fatigue', SYMP],
  ['R55', 'Syncope and collapse', SYMP],
  // Health status
  ['Z00.0', 'General adult medical examination', HEALTH],
  ['Z00.1', 'Routine child health examination', HEALTH],
  ['Z09.9', 'Follow-up examination after unspecified treatment', HEALTH],
  ['Z23', 'Need for immunization against single bacterial diseases', HEALTH],
];

export const LAB_TEST_SEED: [
  code: string,
  name: string,
  category: string,
  sampleType: string,
  unit: string | null,
  referenceRange: string,
  turnaroundHours: number,
][] = [
  [
    'CBC',
    'Complete Blood Count',
    'HEMATOLOGY',
    'BLOOD',
    'x10^9/L',
    'WBC 4.5 - 11.0',
    4,
  ],
  ['HGB', 'Hemoglobin', 'HEMATOLOGY', 'BLOOD', 'g/dL', '12.0 - 17.5', 4],
  [
    'GLU',
    'Fasting Blood Glucose',
    'BIOCHEMISTRY',
    'BLOOD',
    'mmol/L',
    '3.9 - 5.6',
    4,
  ],
  [
    'HBA1C',
    'Glycated Hemoglobin (HbA1c)',
    'BIOCHEMISTRY',
    'BLOOD',
    '%',
    '< 5.7',
    24,
  ],
  [
    'LIPID',
    'Lipid Panel',
    'BIOCHEMISTRY',
    'BLOOD',
    'mmol/L',
    'Total chol. < 5.2',
    24,
  ],
  ['CREA', 'Creatinine', 'BIOCHEMISTRY', 'BLOOD', 'µmol/L', '62 - 115', 24],
  [
    'ALT',
    'Alanine Aminotransferase',
    'BIOCHEMISTRY',
    'BLOOD',
    'U/L',
    '7 - 56',
    24,
  ],
  [
    'TSH',
    'Thyroid Stimulating Hormone',
    'IMMUNOLOGY',
    'BLOOD',
    'mIU/L',
    '0.4 - 4.0',
    48,
  ],
  ['CRP', 'C-Reactive Protein', 'IMMUNOLOGY', 'BLOOD', 'mg/L', '< 5', 4],
  ['UA', 'Urinalysis', 'URINALYSIS', 'URINE', null, 'See report', 4],
];
