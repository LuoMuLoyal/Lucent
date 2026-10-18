/**
 * Resource registry for the admin generic data layer
 * (`/api/v1/admin/data/:resource`, plan `2026-10-18-admin-management-expansion`).
 *
 * One entry per Prisma model drives read/write behaviour so the ~51 tables do
 * not need a hand-written controller each. The registry is deliberately
 * explicit rather than introspecting Prisma DMMF: the runtime client exposes no
 * field metadata in Prisma 7, and hand-declaring the surface is what lets the
 * security red lines below be reviewable in one place.
 *
 * Contracts:
 * - `model` is the Prisma client delegate property name (camelCase).
 * - `idField` is the row locator; most models use `id`, four use another PK.
 * - `softDelete` mirrors a `deletedAt` column — reads inject `deletedAt: null`
 *   (same guarantee the `prisma.nonDeleted` extension provides) and DELETE
 *   stamps `deletedAt` instead of removing the row.
 * - `omitFields` is the security red line: never returned, never writable.
 *   Masking is intentionally stronger than redaction — the field is dropped
 *   entirely rather than shipped as `***`.
 * - `writableFields` is the allowlist for create/update; any other key in the
 *   body is rejected (default-deny for undeclared columns).
 * - `readOnly` resources accept generic reads but reject generic writes — the
 *   import/reference tables are written by their import flows and the audit /
 *   telemetry logs are append-only.
 */
export interface AdminResource {
  /** URL segment in `/admin/data/:resource`. */
  readonly key: string;
  /** Prisma client delegate property name. */
  readonly model: string;
  /** Row locator column (defaults to `id`). */
  readonly idField: string;
  /** Model carries a `deletedAt` column. */
  readonly softDelete: boolean;
  /** Generic writes are refused (import/reference/log tables). */
  readonly readOnly: boolean;
  /** Text columns matched by the `q` search param (`contains`, case-insensitive). */
  readonly searchFields: readonly string[];
  /** Equality-filterable / sortable columns (`userId` is the exposed filter). */
  readonly filterFields: readonly string[];
  /** Security red line: never returned, never writable. */
  readonly omitFields: readonly string[];
  /** Allowlist for create/update (default-deny). Empty when `readOnly`. */
  readonly writableFields: readonly string[];
}

interface AdminResourceInput {
  key: string;
  model: string;
  idField?: string;
  softDelete?: boolean;
  readOnly?: boolean;
  searchFields?: readonly string[];
  filterFields?: readonly string[];
  omitFields?: readonly string[];
  writableFields?: readonly string[];
}

function defineResource(input: AdminResourceInput): AdminResource {
  return {
    key: input.key,
    model: input.model,
    idField: input.idField ?? 'id',
    softDelete: input.softDelete ?? false,
    readOnly: input.readOnly ?? false,
    searchFields: input.searchFields ?? [],
    filterFields: input.filterFields ?? [],
    omitFields: input.omitFields ?? [],
    writableFields: input.writableFields ?? [],
  };
}

export const ADMIN_RESOURCES: readonly AdminResource[] = [
  // ── 1.1 Accounts & permissions ─────────────────────────────────────────
  defineResource({
    key: 'users',
    model: 'user',
    softDelete: true,
    searchFields: ['email', 'nickname'],
    filterFields: ['status'],
    writableFields: [
      'email',
      'emailVerified',
      'nickname',
      'avatar',
      'status',
      'emailVerifiedAt',
      'lastLoginAt',
    ],
  }),
  defineResource({
    key: 'user-profiles',
    model: 'userProfile',
    idField: 'userId',
    searchFields: ['locale', 'timezone'],
    writableFields: [
      'userId',
      'birthDate',
      'sexAtBirth',
      'heightCm',
      'locale',
      'timezone',
      'unitSystem',
      'activityLevel',
      'onboardingCompletedAt',
      'extras',
    ],
  }),
  defineResource({
    key: 'user-sessions',
    model: 'userSession',
    omitFields: ['refreshTokenHash'],
    searchFields: ['deviceName', 'ipAddress', 'userAgent'],
    filterFields: ['userId'],
    writableFields: [
      'userId',
      'deviceType',
      'deviceName',
      'platform',
      'appVersion',
      'ipAddress',
      'userAgent',
      'context',
      'lastUsedAt',
      'expiresAt',
      'revokedAt',
    ],
  }),
  defineResource({
    key: 'user-settings',
    model: 'userSetting',
    searchFields: ['key'],
    filterFields: ['userId', 'key'],
    writableFields: ['userId', 'key', 'value'],
  }),
  defineResource({
    key: 'audit-logs',
    model: 'auditLog',
    readOnly: true,
    searchFields: ['action', 'resourceType'],
    filterFields: ['userId', 'action'],
  }),
  defineResource({
    key: 'accounts',
    model: 'account',
    omitFields: [
      'password',
      'accessToken',
      'refreshToken',
      'idToken',
      'rawProfile',
    ],
    searchFields: ['providerId', 'accountId', 'providerEmail'],
    filterFields: ['userId', 'issuer', 'providerId'],
    writableFields: [
      'userId',
      'issuer',
      'providerId',
      'accountId',
      'providerUnionId',
      'providerEmail',
      'providerEmailVerifiedAt',
      'scope',
      'accessTokenExpiresAt',
      'refreshTokenExpiresAt',
    ],
  }),
  defineResource({
    key: 'admin-users',
    model: 'adminUser',
    idField: 'userId',
    filterFields: ['userId', 'role'],
    writableFields: ['userId', 'role'],
  }),

  // ── 1.2 Health context / medicine / records ────────────────────────────
  defineResource({
    key: 'user-allergies',
    model: 'userAllergy',
    searchFields: ['label', 'reaction'],
    filterFields: ['userId', 'kind', 'isActive'],
    writableFields: [
      'userId',
      'kind',
      'label',
      'reaction',
      'severity',
      'isActive',
      'note',
      'extras',
      'recordedAt',
    ],
  }),
  defineResource({
    key: 'user-conditions',
    model: 'userCondition',
    searchFields: ['label'],
    filterFields: ['userId', 'status'],
    writableFields: [
      'userId',
      'label',
      'status',
      'diagnosedAt',
      'resolvedAt',
      'note',
      'extras',
    ],
  }),
  defineResource({
    key: 'user-current-medicines',
    model: 'userCurrentMedicine',
    searchFields: ['displayName', 'strengthText'],
    filterFields: ['userId', 'source', 'isCurrent'],
    writableFields: [
      'userId',
      'source',
      'sourceRefId',
      'displayName',
      'strengthText',
      'doseText',
      'route',
      'startedAt',
      'endedAt',
      'isCurrent',
      'note',
      'sourcePayload',
    ],
  }),
  defineResource({
    key: 'user-medicine-reminders',
    model: 'userMedicineReminder',
    softDelete: true,
    searchFields: ['label', 'note'],
    filterFields: ['userId', 'isActive', 'currentMedicineId'],
    writableFields: [
      'userId',
      'currentMedicineId',
      'label',
      'scheduledHour',
      'scheduledMinute',
      'daysOfWeek',
      'startDate',
      'endDate',
      'isActive',
      'note',
    ],
  }),
  defineResource({
    key: 'user-reminder-deliveries',
    model: 'userReminderDelivery',
    searchFields: ['channel', 'status', 'deviceId'],
    filterFields: ['userId', 'channel', 'status'],
    writableFields: [
      'userId',
      'reminderId',
      'deviceId',
      'channel',
      'status',
      'scheduledFor',
      'deliveredAt',
      'errorMessage',
    ],
  }),
  defineResource({
    key: 'user-medicine-dose-logs',
    model: 'userMedicineDoseLog',
    softDelete: true,
    searchFields: ['doseText', 'note'],
    filterFields: ['userId', 'status'],
    writableFields: [
      'userId',
      'currentMedicineId',
      'reminderId',
      'healthEventId',
      'status',
      'scheduledFor',
      'scheduledTime',
      'takenAt',
      'doseText',
      'note',
      'source',
    ],
  }),
  defineResource({
    key: 'medicine-risk-check-records',
    model: 'medicineRiskCheckRecord',
    searchFields: ['checkType', 'riskLevel'],
    filterFields: ['userId', 'checkType'],
    writableFields: [
      'userId',
      'checkType',
      'result',
      'riskScore',
      'riskLevel',
      'stale',
    ],
  }),
  defineResource({
    key: 'user-daily-records',
    model: 'userDailyRecord',
    softDelete: true,
    searchFields: ['title', 'value', 'note'],
    filterFields: ['userId', 'kind', 'mealAnalysisStatus'],
    writableFields: [
      'userId',
      'kind',
      'occurredAt',
      'occurredTime',
      'title',
      'value',
      'unit',
      'note',
      'payload',
      'source',
      'mealAnalysisStatus',
      'mealAnalysisUpdatedAt',
      'mealAnalysisFailureReason',
      'mealHeadline',
      'mealCalorieMin',
      'mealCalorieMax',
      'mealCalorieBucket',
      'mealSourceRevision',
      'healthEventId',
    ],
  }),
  defineResource({
    key: 'user-daily-record-attachments',
    model: 'userDailyRecordAttachment',
    searchFields: ['fileName', 'objectKey'],
    filterFields: ['userId', 'recordId'],
    writableFields: [
      'userId',
      'recordId',
      'kind',
      'objectKey',
      'bucket',
      'provider',
      'fileName',
      'contentType',
      'sizeBytes',
      'width',
      'height',
      'publicUrl',
    ],
  }),
  defineResource({
    key: 'health-events',
    model: 'healthEvent',
    softDelete: true,
    searchFields: ['title'],
    filterFields: ['userId', 'status', 'kind'],
    writableFields: [
      'userId',
      'title',
      'kind',
      'status',
      'startedAt',
      'endedAt',
      'outcome',
      'reasonRecordId',
    ],
  }),
  defineResource({
    key: 'health-event-check-ins',
    model: 'healthEventCheckIn',
    filterFields: ['eventId'],
    writableFields: ['eventId', 'date', 'outcome'],
  }),
  defineResource({
    key: 'health-event-medicines',
    model: 'healthEventMedicine',
    filterFields: ['eventId', 'currentMedicineId'],
    writableFields: ['eventId', 'currentMedicineId'],
  }),

  // ── 1.3 Suggestions / analysis / assistant / notifications / export ────
  defineResource({
    key: 'user-suggestions',
    model: 'userSuggestion',
    searchFields: ['title', 'ruleId'],
    filterFields: ['userId', 'type', 'lifecycleState', 'locale'],
    writableFields: [
      'userId',
      'date',
      'type',
      'triggerType',
      'ruleId',
      'ruleVersion',
      'title',
      'reason',
      'boundary',
      'evidence',
      'primaryAction',
      'secondaryActions',
      'priorityScore',
      'confidence',
      'lifecycleState',
      'notificationEligible',
      'notificationSentAt',
      'feedback',
      'feedbackAt',
      'subtype',
      'locale',
      'sourceVersion',
      'generatedAt',
      'activatedAt',
      'fadingAt',
      'expiredAt',
    ],
  }),
  defineResource({
    key: 'user-suggestion-baselines',
    model: 'userSuggestionBaseline',
    filterFields: ['userId', 'dimension'],
    writableFields: [
      'userId',
      'dimension',
      'daysCollected',
      'baselineValue',
      'establishedAt',
    ],
  }),
  defineResource({
    key: 'user-suggestion-baseline-observations',
    model: 'userSuggestionBaselineObservation',
    filterFields: ['userId', 'dimension'],
    writableFields: ['userId', 'dimension', 'localDate', 'value'],
  }),
  defineResource({
    key: 'user-suggestion-materializations',
    model: 'userSuggestionMaterialization',
    filterFields: ['userId', 'status'],
    writableFields: [
      'userId',
      'localDate',
      'sourceVersion',
      'computedVersion',
      'status',
      'reasonCodes',
      'lastErrorCode',
      'queuedAt',
      'computedAt',
    ],
  }),
  defineResource({
    key: 'user-today-analysis-materializations',
    model: 'userTodayAnalysisMaterialization',
    filterFields: ['userId', 'status'],
    writableFields: [
      'userId',
      'localDate',
      'sourceVersion',
      'computedVersion',
      'status',
      'reasonCodes',
      'generationCount',
      'activeVersion',
      'activeAt',
      'lastManualAt',
      'lastTriggerKey',
      'lastErrorCode',
      'queuedAt',
      'computedAt',
    ],
  }),
  defineResource({
    key: 'user-suggestion-feedbacks',
    model: 'userSuggestionFeedback',
    filterFields: ['userId', 'suggestionType'],
    writableFields: [
      'userId',
      'suggestionId',
      'suggestionType',
      'feedback',
      'appliedAt',
      'expiresAt',
    ],
  }),
  defineResource({
    key: 'assistant-conversations',
    model: 'assistantConversation',
    searchFields: ['title'],
    filterFields: ['userId', 'status'],
    writableFields: ['userId', 'title', 'status', 'lastMessageAt'],
  }),
  defineResource({
    key: 'assistant-messages',
    model: 'assistantMessage',
    searchFields: ['content'],
    filterFields: ['userId', 'conversationId', 'role'],
    writableFields: [
      'conversationId',
      'userId',
      'role',
      'content',
      'usedTools',
    ],
  }),
  defineResource({
    key: 'assistant-summary-histories',
    model: 'assistantSummaryHistory',
    searchFields: ['scopeKey', 'summary'],
    filterFields: ['userId', 'kind'],
    writableFields: [
      'userId',
      'kind',
      'scopeKey',
      'date',
      'rangeKey',
      'startDate',
      'endDate',
      'generatedAt',
      'summary',
      'bullets',
      'actionLabel',
      'action',
      'confidenceNote',
      'payload',
      'aiGenerated',
      'sourceVersion',
    ],
  }),
  defineResource({
    key: 'assistant-memories',
    model: 'assistantMemory',
    searchFields: ['content'],
    filterFields: ['userId', 'sourceConversationId'],
    writableFields: ['userId', 'sourceConversationId', 'content'],
  }),
  defineResource({
    key: 'assistant-regenerations',
    model: 'assistantRegeneration',
    filterFields: ['userId', 'conversationId'],
    writableFields: [
      'conversationId',
      'userId',
      'sourceMessageId',
      'checkpointId',
    ],
  }),
  defineResource({
    key: 'user-notification-preferences',
    model: 'userNotificationPreference',
    idField: 'userId',
    filterFields: ['userId'],
    writableFields: [
      'userId',
      'healthAlertsEnabled',
      'weeklyInsightEnabled',
      'waterRemindersEnabled',
      'sleepReminderEnabled',
      'sleepBedtimeMinutes',
      'sleepWakeTimeMinutes',
    ],
  }),
  defineResource({
    key: 'user-notifications',
    model: 'userNotification',
    searchFields: ['title', 'content'],
    filterFields: ['userId', 'type', 'isRead'],
    writableFields: [
      'userId',
      'type',
      'scopeKey',
      'title',
      'content',
      'action',
      'actionPayload',
      'isRead',
      'readAt',
    ],
  }),
  defineResource({
    key: 'data-export-requests',
    model: 'dataExportRequest',
    searchFields: ['kind', 'status'],
    filterFields: ['userId', 'status', 'kind'],
    writableFields: [
      'userId',
      'kind',
      'format',
      'range',
      'status',
      'objectKey',
      'bucket',
      'provider',
      'fileName',
      'fileSizeBytes',
      'completedAt',
      'downloadUrl',
      'errorMessage',
    ],
  }),
  defineResource({
    key: 'user-clinic-summary-shares',
    model: 'userClinicSummaryShare',
    omitFields: ['tokenHash'],
    filterFields: ['userId', 'revokedAt'],
    writableFields: [
      'userId',
      'eventId',
      'dateFrom',
      'dateTo',
      'selectedFields',
      'expiresAt',
      'revokedAt',
      'firstAccessedAt',
      'lastAccessedAt',
      'accessCount',
    ],
  }),
  defineResource({
    key: 'user-product-events',
    model: 'userProductEvent',
    readOnly: true,
    filterFields: ['userId', 'name', 'surface'],
  }),

  // ── 1.4 Content / knowledge base ───────────────────────────────────────
  defineResource({
    key: 'legal-documents',
    model: 'legalDocument',
    searchFields: ['docType', 'titleZh', 'titleEn'],
    filterFields: ['isActive', 'docType'],
    writableFields: [
      'docType',
      'titleZh',
      'titleEn',
      'contentZh',
      'contentEn',
      'isActive',
    ],
  }),
  defineResource({
    key: 'medicine-safety-tips',
    model: 'medicineSafetyTip',
    searchFields: ['contentZh', 'contentEn', 'category'],
    filterFields: ['isActive', 'category'],
    writableFields: [
      'contentZh',
      'contentEn',
      'category',
      'sortOrder',
      'isActive',
    ],
  }),
  defineResource({
    key: 'medical-qa-chunks',
    model: 'medicalQaChunk',
    searchFields: ['qaId', 'question', 'answer'],
    filterFields: ['safetyLabel'],
    writableFields: ['qaId', 'question', 'answer', 'safetyLabel'],
  }),
  // Import / reference / derived-RAG tables: written by import flows, generic
  // layer is read-only (see the `readOnly` contract above).
  defineResource({
    key: 'drug-source-imports',
    model: 'drugSourceImport',
    readOnly: true,
    searchFields: ['sourceKey', 'sourceName'],
    filterFields: ['sourceKey', 'status'],
  }),
  defineResource({
    key: 'cn-medicine-products',
    model: 'cnMedicineProduct',
    readOnly: true,
    searchFields: ['name', 'manufacturer', 'approvalNumber'],
    filterFields: ['importRunId'],
  }),
  defineResource({
    key: 'cn-medicine-leaflets',
    model: 'cnMedicineLeaflet',
    readOnly: true,
    searchFields: ['genericName', 'brandName', 'manufacturer'],
    filterFields: ['importRunId'],
  }),
  defineResource({
    key: 'cn-medicine-product-leaflet-links',
    model: 'cnMedicineProductLeafletLink',
    readOnly: true,
    filterFields: ['productId', 'leafletId', 'isBestMatch'],
  }),
  defineResource({
    key: 'medicine-leaflet-chunks',
    model: 'medicineLeafletChunk',
    readOnly: true,
    searchFields: ['sourceField'],
    filterFields: ['leafletId', 'sourceField'],
  }),
  defineResource({
    key: 'drugbank-drugs',
    model: 'drugbankDrug',
    idField: 'drugbankId',
    readOnly: true,
    searchFields: ['name', 'casNumber', 'unii'],
    filterFields: ['importRunId', 'drugType'],
  }),
  defineResource({
    key: 'drugbank-passage-chunks',
    model: 'drugbankPassageChunk',
    readOnly: true,
    searchFields: ['sourceField'],
    filterFields: ['drugbankId', 'sourceField'],
  }),
  defineResource({
    key: 'drugbank-external-links',
    model: 'drugbankExternalLink',
    readOnly: true,
    searchFields: ['drugName', 'uniprotId'],
    filterFields: ['drugbankId'],
  }),
  defineResource({
    key: 'drugbank-targets',
    model: 'drugbankTarget',
    readOnly: true,
    searchFields: ['name', 'geneName', 'uniprotId'],
    filterFields: ['importRunId', 'sourceDataset'],
  }),
  defineResource({
    key: 'drugbank-drug-targets',
    model: 'drugbankDrugTarget',
    readOnly: true,
    filterFields: ['drugbankId', 'targetId', 'relationKind'],
  }),
  defineResource({
    key: 'drugbank-target-sequences',
    model: 'drugbankTargetSequence',
    readOnly: true,
    searchFields: ['uniprotId', 'targetName'],
    filterFields: ['importRunId', 'sourceDataset', 'uniprotId'],
  }),
  defineResource({
    key: 'drugbank-drug-sequences',
    model: 'drugbankDrugSequence',
    readOnly: true,
    searchFields: ['description'],
    filterFields: ['importRunId', 'drugbankId'],
  }),
  defineResource({
    key: 'drugbank-structures',
    model: 'drugbankStructure',
    idField: 'drugbankId',
    readOnly: true,
    searchFields: ['inchiKey', 'formula'],
    filterFields: ['importRunId'],
  }),
];

const RESOURCE_BY_KEY: ReadonlyMap<string, AdminResource> = new Map(
  ADMIN_RESOURCES.map((resource) => [resource.key, resource]),
);

/** Looks up a resource definition by its URL key; `undefined` when unknown. */
export function getAdminResource(key: string): AdminResource | undefined {
  return RESOURCE_BY_KEY.get(key);
}

/** Columns a `sort` query param may reference for a resource. */
export function adminResourceSortFields(
  resource: AdminResource,
): readonly string[] {
  return [...new Set([...resource.filterFields, 'createdAt', resource.idField])];
}

/** A tab on the user-detail page: a named bundle of user-owned resources. */
export interface AdminUserRelatedGroup {
  readonly key: string;
  readonly resources: readonly AdminResource[];
}

/**
 * User-owned resources grouped by domain for
 * `GET /admin/users/:id/related`. Only tables with a direct `userId` column are
 * listed — child tables (`health-event-check-ins`, `assistant-messages`, …) are
 * reached through their parent. Unknown keys are dropped here; the registry
 * spec asserts every key resolves.
 */
const USER_RELATED_GROUP_KEYS: readonly {
  key: string;
  resources: readonly string[];
}[] = [
  {
    key: 'account',
    resources: ['accounts', 'user-sessions', 'user-settings', 'user-profiles'],
  },
  { key: 'health', resources: ['user-allergies', 'user-conditions'] },
  {
    key: 'medication',
    resources: [
      'user-current-medicines',
      'user-medicine-reminders',
      'user-reminder-deliveries',
      'user-medicine-dose-logs',
      'medicine-risk-check-records',
    ],
  },
  {
    key: 'records',
    resources: ['user-daily-records', 'user-daily-record-attachments'],
  },
  { key: 'events', resources: ['health-events'] },
  {
    key: 'suggestions',
    resources: [
      'user-suggestions',
      'user-suggestion-baselines',
      'user-suggestion-baseline-observations',
      'user-suggestion-materializations',
      'user-today-analysis-materializations',
      'user-suggestion-feedbacks',
    ],
  },
  {
    key: 'assistant',
    resources: [
      'assistant-conversations',
      'assistant-messages',
      'assistant-summary-histories',
      'assistant-memories',
      'assistant-regenerations',
    ],
  },
  {
    key: 'notifications',
    resources: ['user-notification-preferences', 'user-notifications'],
  },
  {
    key: 'privacy',
    resources: ['data-export-requests', 'user-clinic-summary-shares'],
  },
  { key: 'telemetry', resources: ['user-product-events'] },
];

export const ADMIN_USER_RELATED_GROUPS: readonly AdminUserRelatedGroup[] =
  USER_RELATED_GROUP_KEYS.map((group) => ({
    key: group.key,
    resources: group.resources.flatMap((key) => {
      const resource = RESOURCE_BY_KEY.get(key);
      return resource === undefined ? [] : [resource];
    }),
  }));
