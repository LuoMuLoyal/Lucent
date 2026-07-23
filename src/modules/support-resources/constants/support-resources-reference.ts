import type { SupportResourceDto } from '../dto';

/** Static reference data revision timestamp. */
export const REFERENCE_DATA_UPDATED_AT = '2026-07-02T00:00:00.000Z';

/**
 * Static support resources. These are reference entries served from
 * Lucent — no database required. Entries with `available: false` signal that
 * no real contact or URL has been configured yet.
 */
export const STATIC_SUPPORT_RESOURCES: SupportResourceDto[] = [
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
