import { Injectable } from '@nestjs/common';
import { AdminResource, adminSchemaFromClassValidator } from 'nestjs-dj-admin';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserDisplayDto,
  UserProfileDisplayDto,
  DrugbankDrugDisplayDto,
  CnMedicineProductDisplayDto,
  UserDailyRecordDisplayDto,
  UserMedicineDoseLogDisplayDto,
} from './admin.dtos';

/** Quick helper: reuse display DTO as create/update schema. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function roSchema(displayDto: Function) {
  return adminSchemaFromClassValidator({
    displayDto,
    createDto: displayDto,
    updateDto: displayDto,
  });
}

// ── User ──
@Injectable()
@AdminResource({
  model: PrismaService.prototype.user as unknown as object as new () => object,
  list: ['id', 'email', 'nickname', 'status', 'createdAt'],
  search: ['email', 'nickname'],
  filters: ['status'],
  readonly: ['id', 'createdAt'],
  schema: roSchema(UserDisplayDto),
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class UserAdmin {}

// ── User Profile ──
@Injectable()
@AdminResource({
  model: PrismaService.prototype
    .userProfile as unknown as object as new () => object,
  list: ['userId', 'sexAtBirth', 'heightCm', 'bloodType', 'locale'],
  search: ['userId'],
  filters: ['sexAtBirth', 'bloodType'],
  readonly: ['userId'],
  schema: roSchema(UserProfileDisplayDto),
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class UserProfileAdmin {}

// ── DrugBank Drug ──
@Injectable()
@AdminResource({
  model: PrismaService.prototype
    .drugbankDrug as unknown as object as new () => object,
  list: ['drugbankId', 'name', 'drugType', 'casNumber'],
  search: ['name', 'casNumber'],
  filters: ['drugType'],
  readonly: ['drugbankId', 'createdAt'],
  schema: roSchema(DrugbankDrugDisplayDto),
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DrugbankDrugAdmin {}

// ── CN Medicine Product ──
@Injectable()
@AdminResource({
  model: PrismaService.prototype
    .cnMedicineProduct as unknown as object as new () => object,
  list: [
    'id',
    'name',
    'manufacturer',
    'approvalNumber',
    'drugType',
    'mainCategory',
  ],
  search: ['name', 'manufacturer', 'approvalNumber'],
  filters: ['drugType', 'mainCategory'],
  readonly: ['id', 'createdAt'],
  schema: roSchema(CnMedicineProductDisplayDto),
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class CnMedicineProductAdmin {}

// ── Daily Records ──
@Injectable()
@AdminResource({
  model: PrismaService.prototype
    .userDailyRecord as unknown as object as new () => object,
  list: ['id', 'userId', 'kind', 'occurredAt', 'title', 'value'],
  search: ['title', 'userId'],
  filters: ['kind'],
  readonly: ['id', 'createdAt'],
  schema: roSchema(UserDailyRecordDisplayDto),
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class UserDailyRecordAdmin {}

// ── Dose Logs ──
@Injectable()
@AdminResource({
  model: PrismaService.prototype
    .userMedicineDoseLog as unknown as object as new () => object,
  list: ['id', 'userId', 'status', 'scheduledFor', 'currentMedicineId'],
  search: ['userId'],
  filters: ['status'],
  readonly: ['id', 'createdAt'],
  schema: roSchema(UserMedicineDoseLogDisplayDto),
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class UserMedicineDoseLogAdmin {}
