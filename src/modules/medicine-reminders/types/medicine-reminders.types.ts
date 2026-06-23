export type MedicineReminderRecord = {
  id: string;
  currentMedicineId: string | null;
  label: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  daysOfWeek: unknown;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReminderDeliveryRecord = {
  id: string;
  reminderId: string | null;
  deviceId: string | null;
  channel: string;
  status: string;
  scheduledFor: Date;
  deliveredAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type OwnedMedicineReminderRecord = {
  userId: string;
  startDate: Date | null;
  endDate: Date | null;
};
