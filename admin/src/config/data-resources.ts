/**
 * Client-side descriptors for the generic admin data layer
 * (`/api/v1/admin/data/:resource`).
 *
 * The backend keeps the authoritative matrix in
 * `Lucent/src/modules/admin/constants/resource-registry.ts` (which columns
 * exist, which are sensitive, which are writable). This list only drives
 * presentation: the resource picker, English labels and whether the generic
 * write UI is offered. Every write is still validated server-side against the
 * registry, so a mismatch here can only hide/show controls, never bypass rules.
 */
interface DataResource {
  /** URL key in `/admin/data/:resource` — must match the backend registry. */
  key: string
  /** English display label. */
  label: string
  /** Picker group heading. */
  group: string
  /** Row locator column (defaults to `id`). */
  idField?: string
  /** Backend refuses generic writes for this table. */
  readOnly?: boolean
}

export const DATA_RESOURCES: DataResource[] = [
  // Accounts & access
  { key: 'users', label: 'Users', group: 'Accounts' },
  {
    key: 'user-profiles',
    label: 'User profiles',
    group: 'Accounts',
    idField: 'userId',
  },
  { key: 'user-sessions', label: 'User sessions', group: 'Accounts' },
  { key: 'user-settings', label: 'User settings', group: 'Accounts' },
  { key: 'accounts', label: 'Accounts', group: 'Accounts' },
  {
    key: 'admin-users',
    label: 'Admin grants',
    group: 'Accounts',
    idField: 'userId',
  },

  // Health
  { key: 'user-allergies', label: 'Allergies', group: 'Health' },
  { key: 'user-conditions', label: 'Conditions', group: 'Health' },
  {
    key: 'user-current-medicines',
    label: 'Current medicines',
    group: 'Health',
  },
  {
    key: 'medicine-risk-check-records',
    label: 'Risk check records',
    group: 'Health',
  },

  // Medication & records
  {
    key: 'user-medicine-reminders',
    label: 'Medicine reminders',
    group: 'Medication & records',
  },
  {
    key: 'user-reminder-deliveries',
    label: 'Reminder deliveries',
    group: 'Medication & records',
  },
  {
    key: 'user-medicine-dose-logs',
    label: 'Dose logs',
    group: 'Medication & records',
  },
  {
    key: 'user-daily-records',
    label: 'Daily records',
    group: 'Medication & records',
  },
  {
    key: 'user-daily-record-attachments',
    label: 'Daily record attachments',
    group: 'Medication & records',
  },
  {
    key: 'health-events',
    label: 'Health events',
    group: 'Medication & records',
  },
  {
    key: 'health-event-check-ins',
    label: 'Health event check-ins',
    group: 'Medication & records',
  },
  {
    key: 'health-event-medicines',
    label: 'Health event medicines',
    group: 'Medication & records',
  },

  // Suggestions & analysis
  {
    key: 'user-suggestions',
    label: 'Suggestions',
    group: 'Suggestions & analysis',
  },
  {
    key: 'user-suggestion-baselines',
    label: 'Suggestion baselines',
    group: 'Suggestions & analysis',
  },
  {
    key: 'user-suggestion-baseline-observations',
    label: 'Baseline observations',
    group: 'Suggestions & analysis',
  },
  {
    key: 'user-suggestion-materializations',
    label: 'Suggestion materializations',
    group: 'Suggestions & analysis',
  },
  {
    key: 'user-today-analysis-materializations',
    label: 'Today analysis materializations',
    group: 'Suggestions & analysis',
  },
  {
    key: 'user-suggestion-feedbacks',
    label: 'Suggestion feedbacks',
    group: 'Suggestions & analysis',
  },

  // Assistant
  {
    key: 'assistant-conversations',
    label: 'Assistant conversations',
    group: 'Assistant',
  },
  {
    key: 'assistant-messages',
    label: 'Assistant messages',
    group: 'Assistant',
  },
  {
    key: 'assistant-summary-histories',
    label: 'Assistant summary histories',
    group: 'Assistant',
  },
  {
    key: 'assistant-memories',
    label: 'Assistant memories',
    group: 'Assistant',
  },
  {
    key: 'assistant-regenerations',
    label: 'Assistant regenerations',
    group: 'Assistant',
  },

  // Notifications & privacy
  {
    key: 'user-notification-preferences',
    label: 'Notification preferences',
    group: 'Notifications & privacy',
    idField: 'userId',
  },
  {
    key: 'user-notifications',
    label: 'Notifications',
    group: 'Notifications & privacy',
  },
  {
    key: 'data-export-requests',
    label: 'Data export requests',
    group: 'Notifications & privacy',
  },
  {
    key: 'user-clinic-summary-shares',
    label: 'Clinic summary shares',
    group: 'Notifications & privacy',
  },

  // Telemetry & logs
  {
    key: 'user-product-events',
    label: 'Product events',
    group: 'Telemetry & logs',
    readOnly: true,
  },
  {
    key: 'audit-logs',
    label: 'Audit logs',
    group: 'Telemetry & logs',
    readOnly: true,
  },

  // Content
  { key: 'legal-documents', label: 'Legal documents', group: 'Content' },
  { key: 'medicine-safety-tips', label: 'Safety tips', group: 'Content' },
  { key: 'medical-qa-chunks', label: 'Medical QA chunks', group: 'Content' },

  // Knowledge base (written by import pipelines)
  {
    key: 'drug-source-imports',
    label: 'Drug source imports',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'cn-medicine-products',
    label: 'CN medicine products',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'cn-medicine-leaflets',
    label: 'CN medicine leaflets',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'cn-medicine-product-leaflet-links',
    label: 'CN product-leaflet links',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'medicine-leaflet-chunks',
    label: 'Leaflet chunks',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'drugbank-drugs',
    label: 'DrugBank drugs',
    group: 'Knowledge base',
    idField: 'drugbankId',
    readOnly: true,
  },
  {
    key: 'drugbank-passage-chunks',
    label: 'DrugBank passage chunks',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'drugbank-external-links',
    label: 'DrugBank external links',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'drugbank-targets',
    label: 'DrugBank targets',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'drugbank-drug-targets',
    label: 'DrugBank drug-targets',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'drugbank-target-sequences',
    label: 'DrugBank target sequences',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'drugbank-drug-sequences',
    label: 'DrugBank drug sequences',
    group: 'Knowledge base',
    readOnly: true,
  },
  {
    key: 'drugbank-structures',
    label: 'DrugBank structures',
    group: 'Knowledge base',
    idField: 'drugbankId',
    readOnly: true,
  },
]

const BY_KEY = new Map(
  DATA_RESOURCES.map((resource) => [resource.key, resource])
)

/** Every registered resource key (used by the data provider / access control). */
export const DATA_RESOURCE_KEYS: ReadonlySet<string> = new Set(BY_KEY.keys())

export function getDataResource(key: string): DataResource | undefined {
  return BY_KEY.get(key)
}

export function dataResourceIdField(resource: DataResource): string {
  return resource.idField ?? 'id'
}

/** Resources grouped for the picker, preserving declaration order. */
export function groupedDataResources(): {
  group: string
  resources: DataResource[]
}[] {
  const groups: { group: string; resources: DataResource[] }[] = []
  for (const resource of DATA_RESOURCES) {
    const existing = groups.find((entry) => entry.group === resource.group)
    if (existing) {
      existing.resources.push(resource)
    } else {
      groups.push({ group: resource.group, resources: [resource] })
    }
  }
  return groups
}
