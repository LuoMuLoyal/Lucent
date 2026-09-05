import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ProblemDetailsDto } from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import { CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { createHealthContextAllergySchema } from './dto/create-allergy.dto.js';
import type { CreateHealthContextAllergyDto } from './dto/create-allergy.dto.js';
import { createHealthContextConditionSchema } from './dto/create-condition.dto.js';
import type { CreateHealthContextConditionDto } from './dto/create-condition.dto.js';
import { createCurrentMedicineSchema } from './dto/create-current-medicine.dto.js';
import type { CreateCurrentMedicineDto } from './dto/create-current-medicine.dto.js';
import { healthContextResponseSchema } from './dto/response.dto.js';
import { updateHealthContextAllergySchema } from './dto/update-allergy.dto.js';
import type { UpdateHealthContextAllergyDto } from './dto/update-allergy.dto.js';
import { updateHealthContextConditionSchema } from './dto/update-condition.dto.js';
import type { UpdateHealthContextConditionDto } from './dto/update-condition.dto.js';
import { updateCurrentMedicineSchema } from './dto/update-current-medicine.dto.js';
import type { UpdateCurrentMedicineDto } from './dto/update-current-medicine.dto.js';
import { updateHealthContextProfileSchema } from './dto/update-profile.dto.js';
import type { UpdateHealthContextProfileDto } from './dto/update-profile.dto.js';
import { UserHealthContextService } from './services/health-context.service.js';

@ApiTags('User Health Context')
@Controller('health-context')
export class UserHealthContextController {
  constructor(
    private readonly userHealthContextService: UserHealthContextService,
  ) {}

  @Get()
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the current user health context aggregate' })
  @ApiResponse({
    status: 200,
    description: 'The current user health-context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async getUserHealthContext(@CurrentUser() user: UserPayload) {
    return unwrapResult(this.userHealthContextService.getForUser(user.sub));
  }

  @Patch('profile')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update the current user health-context profile',
  })
  @ApiResponse({
    status: 200,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async updateUserHealthContextProfile(
    @CurrentUser() user: UserPayload,
    @Body({ schema: updateHealthContextProfileSchema })
    dto: UpdateHealthContextProfileDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.updateProfile(user.sub, dto),
    );
  }

  // ── Allergy endpoints ──

  @Post('allergies')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create an allergy record' })
  // NOTE: 201 success body is the same aggregate as GET; the response
  // registry/export only wires 200 responses, so this endpoint stays
  // description-only in OpenAPI until the export side grows 201 support.
  @ApiResponse({
    status: 201,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async createAllergy(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createHealthContextAllergySchema })
    dto: CreateHealthContextAllergyDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.createAllergy(user.sub, dto),
    );
  }

  @Patch('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update an allergy record' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 403,
    description: 'Allergy is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Allergy not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async updateAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateHealthContextAllergySchema })
    dto: UpdateHealthContextAllergyDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.updateAllergy(user.sub, id, dto),
    );
  }

  @Delete('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Deactivate an allergy record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 403,
    description: 'Allergy is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Allergy not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async deleteAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return unwrapResult(
      this.userHealthContextService.deleteAllergy(user.sub, id),
    );
  }

  // ── Condition endpoints ──

  @Post('conditions')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a condition record' })
  // NOTE: 201 success body is the same aggregate as GET; the response
  // registry/export only wires 200 responses, so this endpoint stays
  // description-only in OpenAPI until the export side grows 201 support.
  @ApiResponse({
    status: 201,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async createCondition(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createHealthContextConditionSchema })
    dto: CreateHealthContextConditionDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.createCondition(user.sub, dto),
    );
  }

  @Patch('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a condition record' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 403,
    description: 'Condition is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Condition not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async updateCondition(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateHealthContextConditionSchema })
    dto: UpdateHealthContextConditionDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.updateCondition(user.sub, id, dto),
    );
  }

  @Delete('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Resolve a condition record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 403,
    description: 'Condition is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Condition not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async deleteCondition(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return unwrapResult(
      this.userHealthContextService.deleteCondition(user.sub, id),
    );
  }

  // ── Current medicine endpoints ──

  @Post('current-medicines')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Add a current medicine record' })
  // NOTE: 201 success body is the same aggregate as GET; the response
  // registry/export only wires 200 responses, so this endpoint stays
  // description-only in OpenAPI until the export side grows 201 support.
  @ApiResponse({
    status: 201,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async createCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createCurrentMedicineSchema })
    dto: CreateCurrentMedicineDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.createCurrentMedicine(user.sub, dto),
    );
  }

  @Patch('current-medicines/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a current medicine record' })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 403,
    description: 'Current medicine is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Current medicine not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async updateCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateCurrentMedicineSchema })
    dto: UpdateCurrentMedicineDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.updateCurrentMedicine(user.sub, id, dto),
    );
  }

  @Delete('current-medicines/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Deactivate a current medicine record (soft delete)',
  })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user health-context aggregate.',
  })
  @ApiResponse({
    status: 403,
    description: 'Current medicine is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Current medicine not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: healthContextResponseSchema })
  async deleteCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return unwrapResult(
      this.userHealthContextService.deleteCurrentMedicine(user.sub, id),
    );
  }
}

registerResponseSchema({
  path: '/api/v1/user/health-context',
  method: 'get',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The current user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/profile',
  method: 'patch',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

// 201 主成功体注记:export-openapi 目前只把注册组件的 200 响应回写为 $ref;
// 三个 201 端点(POST allergies/conditions/current-medicines)的响应体与 GET
// 同一 aggregate,按稳定组件名登记,导出脚本支持 201 回写后自动生效。
registerResponseSchema({
  path: '/api/v1/user/health-context/allergies',
  method: 'post',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/conditions',
  method: 'post',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/current-medicines',
  method: 'post',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/allergies/{id}',
  method: 'patch',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/allergies/{id}',
  method: 'delete',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/conditions/{id}',
  method: 'patch',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/conditions/{id}',
  method: 'delete',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/current-medicines/{id}',
  method: 'patch',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/health-context/current-medicines/{id}',
  method: 'delete',
  componentName: 'HealthContextResponse',
  schema: healthContextResponseSchema,
  description: 'The updated user health-context aggregate.',
});
