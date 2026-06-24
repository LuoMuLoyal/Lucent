import type { Prisma } from '../../../generated/prisma/client';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const reminderSelect = {
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
  select: typeof reminderSelect;
}>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const deliverySelect = {
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
  select: typeof deliverySelect;
}>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ownedReminderSelect = {
  userId: true,
  startDate: true,
  endDate: true,
} satisfies Prisma.UserMedicineReminderSelect;

export type OwnedMedicineReminderRecord =
  Prisma.UserMedicineReminderGetPayload<{
    select: typeof ownedReminderSelect;
  }>;
