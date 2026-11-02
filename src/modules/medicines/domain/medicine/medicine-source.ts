export const MEDICINE_KNOWLEDGE_SOURCES = ['drugbank', 'cn'] as const;
export type MedicineKnowledgeSource =
  (typeof MEDICINE_KNOWLEDGE_SOURCES)[number];

export const DEFAULT_MEDICINE_SOURCE: MedicineKnowledgeSource = 'drugbank';
