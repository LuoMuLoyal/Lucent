/**
 * Safety-tip contracts (`application/ports`).
 *
 * Two surfaces over the `medicine_safety_tips` table: the public read source
 * (`listActiveCached`, used by the user-facing tips endpoint) and the admin
 * repository (editorial CRUD backing the admin console).
 */

export const MEDICINE_SAFETY_TIPS_SOURCE = 'MEDICINE_SAFETY_TIPS_SOURCE';
export const MEDICINE_SAFETY_TIP_REPOSITORY = 'MEDICINE_SAFETY_TIP_REPOSITORY';

export interface MedicineSafetyTipRow {
  id: string;
  contentZh: string;
  contentEn: string;
  category: string;
}

/** One tip projected for the localized `GET /medicines/safety-tips` surface. */
export interface MedicineSafetyTipItem {
  id: string;
  text: string;
  category: string;
}

export interface MedicineSafetyTipsSourcePort {
  /** All active tips, behind the shared safety-tips cache key. */
  listActiveCached(): Promise<MedicineSafetyTipRow[]>;
}

export interface MedicineSafetyTipAdminInput {
  contentZh: string;
  contentEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
}

export type MedicineSafetyTipAdminPatch = {
  [Key in keyof MedicineSafetyTipAdminInput]?:
    | MedicineSafetyTipAdminInput[Key]
    | undefined;
};

/** Row shape returned by the admin repository — `updatedAt` is ISO serialised here. */
export interface MedicineSafetyTipAdminRow {
  id: string;
  contentZh: string;
  contentEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}

/** Pre-update snapshot without `updatedAt` (the admin "before" payload). */
export interface MedicineSafetyTipEditableRow {
  id: string;
  contentZh: string;
  contentEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MedicineSafetyTipRepositoryPort {
  listAll(): Promise<MedicineSafetyTipAdminRow[]>;
  create(
    input: MedicineSafetyTipAdminInput,
  ): Promise<MedicineSafetyTipAdminRow>;
  update(
    id: string,
    patch: MedicineSafetyTipAdminPatch,
  ): Promise<MedicineSafetyTipAdminRow | null>;
  findEditable(id: string): Promise<MedicineSafetyTipEditableRow | null>;
  remove(id: string): Promise<void>;
}
