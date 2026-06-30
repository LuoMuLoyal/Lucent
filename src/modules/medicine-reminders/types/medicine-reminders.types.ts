import type { Prisma } from '../../../generated/prisma/client';

const _reminderSelect = {
  id: true,
  currentMedicineId: true,
  label: true,
  scheduledHour: true,
  scheduledMinute: true,
  daysOfWeek: true,
  startDate: true,
  endDate: true,
  isActive: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserMedicineReminderSelect;

export type MedicineReminderRecord = Prisma.UserMedicineReminderGetPayload<{
  select: typeof _reminderSelect;
}>;

const _deliverySelect = {
  id: true,
  reminderId: true,
  deviceId: true,
  channel: true,
  status: true,
  scheduledFor: true,
  deliveredAt: true,
  errorMessage: true,
  createdAt: true,
} satisfies Prisma.UserReminderDeliverySelect;

export type ReminderDeliveryRecord = Prisma.UserReminderDeliveryGetPayload<{
  select: typeof _deliverySelect;
}>;

const _ownedReminderSelect = {
  userId: true,
  startDate: true,
  endDate: true,
} satisfies Prisma.UserMedicineReminderSelect;

export type OwnedMedicineReminderRecord =
  Prisma.UserMedicineReminderGetPayload<{
    select: typeof _ownedReminderSelect;
  }>;
