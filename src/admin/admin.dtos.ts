import { IsEmail, IsOptional, IsString } from 'class-validator';
import { AdminField } from 'nestjs-dj-admin';

// ── User ──

export class UserDisplayDto {
  @AdminField({ label: 'ID' })
  @IsString()
  id!: string;

  @AdminField({ label: 'Email' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @AdminField({ label: 'Nickname' })
  @IsString()
  @IsOptional()
  nickname?: string;

  @AdminField({ label: 'Status' })
  @IsString()
  status!: string;

  @AdminField({ label: 'Created' })
  @IsString()
  createdAt!: string;
}

export class UserProfileDisplayDto {
  @AdminField({ label: 'User ID' })
  @IsString()
  userId!: string;

  @AdminField({ label: 'Sex' })
  @IsString()
  @IsOptional()
  sexAtBirth?: string;

  @AdminField({ label: 'Height (cm)' })
  @IsOptional()
  heightCm?: number;

  @AdminField({ label: 'Blood Type' })
  @IsString()
  @IsOptional()
  bloodType?: string;

  @AdminField({ label: 'Locale' })
  @IsString()
  @IsOptional()
  locale?: string;
}

// ── DrugBank ──

export class DrugbankDrugDisplayDto {
  @AdminField({ label: 'DrugBank ID' })
  @IsString()
  drugbankId!: string;

  @AdminField({ label: 'Name' })
  @IsString()
  name!: string;

  @AdminField({ label: 'Type' })
  @IsString()
  @IsOptional()
  drugType?: string;

  @AdminField({ label: 'CAS' })
  @IsString()
  @IsOptional()
  casNumber?: string;

  @AdminField({ label: 'Groups' })
  @IsOptional()
  groups?: unknown;
}

// ── CN Medicine ──

export class CnMedicineProductDisplayDto {
  @AdminField({ label: 'ID' })
  @IsString()
  id!: string;

  @AdminField({ label: 'Name' })
  @IsString()
  name!: string;

  @AdminField({ label: 'Manufacturer' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @AdminField({ label: 'Approval No.' })
  @IsString()
  @IsOptional()
  approvalNumber?: string;

  @AdminField({ label: 'Drug Type' })
  @IsString()
  @IsOptional()
  drugType?: string;

  @AdminField({ label: 'Category' })
  @IsString()
  @IsOptional()
  mainCategory?: string;
}

// ── Daily Record ──

export class UserDailyRecordDisplayDto {
  @AdminField({ label: 'ID' })
  @IsString()
  id!: string;

  @AdminField({ label: 'User' })
  @IsString()
  userId!: string;

  @AdminField({ label: 'Kind' })
  @IsString()
  kind!: string;

  @AdminField({ label: 'Date' })
  @IsString()
  occurredAt!: string;

  @AdminField({ label: 'Title' })
  @IsString()
  @IsOptional()
  title?: string;

  @AdminField({ label: 'Value' })
  @IsString()
  @IsOptional()
  value?: string;
}

// ── Dose Log ──

export class UserMedicineDoseLogDisplayDto {
  @AdminField({ label: 'ID' })
  @IsString()
  id!: string;

  @AdminField({ label: 'User' })
  @IsString()
  userId!: string;

  @AdminField({ label: 'Status' })
  @IsString()
  status!: string;

  @AdminField({ label: 'Scheduled' })
  @IsString()
  scheduledFor!: string;

  @AdminField({ label: 'Medicine' })
  @IsString()
  @IsOptional()
  currentMedicineId?: string;
}
