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

import { ProblemDetailsDto } from '../../../../common/index.js';
import { registerResponseSchema } from '../../../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../../../common/result/index.js';
import { CurrentUser } from '../../../auth/index.js';
import type { UserPayload } from '../../../auth/index.js';
import { createContextAllergySchema } from '../../application/ports/create-allergy.js';
import type { CreateContextAllergyDto } from '../../application/ports/create-allergy.js';
import { createContextConditionSchema } from '../../application/ports/create-condition.js';
import type { CreateContextConditionDto } from '../../application/ports/create-condition.js';
import { createCurrentMedicineSchema } from '../../application/ports/create-current-medicine.js';
import type { CreateCurrentMedicineDto } from '../../application/ports/create-current-medicine.js';
import { contextResponseSchema } from '../../application/ports/context-resource.js';
import { updateContextAllergySchema } from '../../application/ports/update-allergy.js';
import type { UpdateContextAllergyDto } from '../../application/ports/update-allergy.js';
import { updateContextConditionSchema } from '../../application/ports/update-condition.js';
import type { UpdateContextConditionDto } from '../../application/ports/update-condition.js';
import { updateCurrentMedicineSchema } from '../../application/ports/update-current-medicine.js';
import type { UpdateCurrentMedicineDto } from '../../application/ports/update-current-medicine.js';
import { updateContextProfileSchema } from '../../application/ports/update-profile.js';
import type { UpdateContextProfileDto } from '../../application/ports/update-profile.js';
import { UserContextService } from '../../application/services/context.js';

@ApiTags('User Health Context')
@Controller('context')
export class ContextController {
  constructor(
    private readonly userContextService: UserContextService,
  ) {}

  @Get()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'getUserContext',
    summary: 'Get the current user health context aggregate',
  })
  @ApiResponse({
    status: 200,
    description: 'The current user context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: contextResponseSchema })
  async getUserContext(@CurrentUser() user: UserPayload) {
    return unwrapResult(this.userContextService.getForUser(user.sub));
  }

  @Patch('profile')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'updateUserContextProfile',
    summary: 'Update the current user context profile',
  })
  @ApiResponse({
    status: 200,
    description: 'The updated user context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: contextResponseSchema })
  async updateUserContextProfile(
    @CurrentUser() user: UserPayload,
    @Body({ schema: updateContextProfileSchema })
    dto: UpdateContextProfileDto,
  ) {
    return unwrapResult(
      this.userContextService.updateProfile(user.sub, dto),
    );
  }

  // ── Allergy endpoints ──

  @Post('allergies')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'createAllergy',
    summary: 'Create an allergy record',
  })
  // NOTE: 201 success body is the same aggregate as GET; the response
  // registry/export only wires 200 responses, so this endpoint stays
  // description-only in OpenAPI until the export side grows 201 support.
  @ApiResponse({
    status: 201,
    description: 'The updated user context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: contextResponseSchema })
  async createAllergy(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createContextAllergySchema })
    dto: CreateContextAllergyDto,
  ) {
    return unwrapResult(
      this.userContextService.createAllergy(user.sub, dto),
    );
  }

  @Patch('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'updateAllergy',
    summary: 'Update an allergy record',
  })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user context aggregate.',
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
  @SerializeOptions({ schema: contextResponseSchema })
  async updateAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateContextAllergySchema })
    dto: UpdateContextAllergyDto,
  ) {
    return unwrapResult(
      this.userContextService.updateAllergy(user.sub, id, dto),
    );
  }

  @Delete('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'deleteAllergy',
    summary: 'Deactivate an allergy record (soft delete)',
  })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user context aggregate.',
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
  @SerializeOptions({ schema: contextResponseSchema })
  async deleteAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return unwrapResult(
      this.userContextService.deleteAllergy(user.sub, id),
    );
  }

  // ── Condition endpoints ──

  @Post('conditions')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'createCondition',
    summary: 'Create a condition record',
  })
  // NOTE: 201 success body is the same aggregate as GET; the response
  // registry/export only wires 200 responses, so this endpoint stays
  // description-only in OpenAPI until the export side grows 201 support.
  @ApiResponse({
    status: 201,
    description: 'The updated user context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: contextResponseSchema })
  async createCondition(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createContextConditionSchema })
    dto: CreateContextConditionDto,
  ) {
    return unwrapResult(
      this.userContextService.createCondition(user.sub, dto),
    );
  }

  @Patch('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'updateCondition',
    summary: 'Update a condition record',
  })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user context aggregate.',
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
  @SerializeOptions({ schema: contextResponseSchema })
  async updateCondition(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateContextConditionSchema })
    dto: UpdateContextConditionDto,
  ) {
    return unwrapResult(
      this.userContextService.updateCondition(user.sub, id, dto),
    );
  }

  @Delete('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'deleteCondition',
    summary: 'Resolve a condition record (soft delete)',
  })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user context aggregate.',
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
  @SerializeOptions({ schema: contextResponseSchema })
  async deleteCondition(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return unwrapResult(
      this.userContextService.deleteCondition(user.sub, id),
    );
  }

  // ── Current medicine endpoints ──

  @Post('current-medicines')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'createCurrentMedicine',
    summary: 'Add a current medicine record',
  })
  // NOTE: 201 success body is the same aggregate as GET; the response
  // registry/export only wires 200 responses, so this endpoint stays
  // description-only in OpenAPI until the export side grows 201 support.
  @ApiResponse({
    status: 201,
    description: 'The updated user context aggregate.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: contextResponseSchema })
  async createCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createCurrentMedicineSchema })
    dto: CreateCurrentMedicineDto,
  ) {
    return unwrapResult(
      this.userContextService.createCurrentMedicine(user.sub, dto),
    );
  }

  @Patch('current-medicines/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'updateCurrentMedicine',
    summary: 'Update a current medicine record',
  })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user context aggregate.',
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
  @SerializeOptions({ schema: contextResponseSchema })
  async updateCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateCurrentMedicineSchema })
    dto: UpdateCurrentMedicineDto,
  ) {
    return unwrapResult(
      this.userContextService.updateCurrentMedicine(user.sub, id, dto),
    );
  }

  @Delete('current-medicines/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    operationId: 'deleteCurrentMedicine',
    summary: 'Deactivate a current medicine record (soft delete)',
  })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiResponse({
    status: 200,
    description: 'The updated user context aggregate.',
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
  @SerializeOptions({ schema: contextResponseSchema })
  async deleteCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return unwrapResult(
      this.userContextService.deleteCurrentMedicine(user.sub, id),
    );
  }
}

registerResponseSchema({
  path: '/api/v1/user/context',
  method: 'get',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The current user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/profile',
  method: 'patch',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

// 201 主成功体注记:export-openapi 目前只把注册组件的 200 响应回写为 $ref;
// 三个 201 端点(POST allergies/conditions/current-medicines)的响应体与 GET
// 同一 aggregate,按稳定组件名登记,导出脚本支持 201 回写后自动生效。
registerResponseSchema({
  path: '/api/v1/user/context/allergies',
  method: 'post',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/conditions',
  method: 'post',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/current-medicines',
  method: 'post',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/allergies/{id}',
  method: 'patch',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/allergies/{id}',
  method: 'delete',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/conditions/{id}',
  method: 'patch',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/conditions/{id}',
  method: 'delete',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/current-medicines/{id}',
  method: 'patch',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});

registerResponseSchema({
  path: '/api/v1/user/context/current-medicines/{id}',
  method: 'delete',
  componentName: 'ContextResponse',
  schema: contextResponseSchema,
  description: 'The updated user context aggregate.',
});
