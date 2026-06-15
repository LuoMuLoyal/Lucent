import type { SupportResourceDto } from './dto';

/** Static reference data revision timestamp. */
export const REFERENCE_DATA_UPDATED_AT = '2026-06-10T00:00:00.000Z';

/**
 * Static campus support resources. These are reference entries served from
 * Lucent — no database required. Entries with `available: false` signal that
 * no real contact or URL has been configured yet.
 */
export const STATIC_SUPPORT_RESOURCES: SupportResourceDto[] = [
  // ── Campus scope ───────────────────────────────────────────
  {
    id: 'campus-hospital',
    scope: 'campus',
    title: 'Campus Hospital',
    titleKey: 'mineCampusHospitalTitle',
    subtitle: 'On-campus medical services',
    subtitleKey: 'mineCampusHospitalSubtitle',
    icon: 'local_hospital',
    actionUrl: 'https://www.pku.edu.cn/hospital/',
    actionType: 'url',
    available: true,
  },
  {
    id: 'campus-support',
    scope: 'campus',
    title: 'Student Support',
    titleKey: 'mineCampusSupportTitle',
    subtitle: 'Psychological and academic support',
    subtitleKey: 'mineCampusSupportSubtitle',
    icon: 'favorite',
    actionUrl: null,
    actionType: null,
    available: false,
  },
  {
    id: 'campus-pharmacy',
    scope: 'campus',
    title: 'Campus Pharmacy',
    titleKey: 'mineCampusPharmacyTitle',
    subtitle: 'On-campus pharmacy services',
    subtitleKey: 'mineCampusPharmacySubtitle',
    icon: 'medical_services',
    actionUrl: 'https://www.pku.edu.cn/pharmacy/',
    actionType: 'url',
    available: true,
  },
  {
    id: 'campus-emergency',
    scope: 'campus',
    title: 'Emergency Contact',
    titleKey: 'mineCampusEmergencyTitle',
    subtitle: 'Campus emergency services',
    subtitleKey: 'mineCampusEmergencySubtitle',
    icon: 'emergency',
    actionUrl: 'tel:120',
    actionType: 'phone',
    available: true,
  },

  // ── Help scope ─────────────────────────────────────────────
  {
    id: 'help-faq',
    scope: 'help',
    title: 'FAQ',
    titleKey: 'mineHelpFaqTitle',
    subtitle: 'Frequently asked questions',
    subtitleKey: 'mineHelpFaqSubtitle',
    icon: 'help',
    actionUrl: null,
    actionType: null,
    available: false,
  },
  {
    id: 'help-feedback',
    scope: 'help',
    title: 'Feedback',
    titleKey: 'mineHelpFeedbackTitle',
    subtitle: 'Report issues or suggest improvements',
    subtitleKey: 'mineHelpFeedbackSubtitle',
    icon: 'feedback',
    actionUrl: null,
    actionType: null,
    available: false,
  },
];
