import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ProblemDetailsDto } from '../../common';
import { unwrapResult } from '../../common/result';
import { CurrentUser } from '../auth';
import type { UserPayload } from '../auth';
import { CreateCurrentMedicineDto } from './dto/create-current-medicine.dto';

import { CreateHealthContextAllergyDto } from './dto/create-allergy.dto';

import { CreateHealthContextConditionDto } from './dto/create-condition.dto';

import { HealthContextResponseDto } from './dto/response.dto';

import { UpdateCurrentMedicineDto } from './dto/update-current-medicine.dto';

import { UpdateHealthContextAllergyDto } from './dto/update-allergy.dto';

import { UpdateHealthContextConditionDto } from './dto/update-condition.dto';

import { UpdateHealthContextProfileDto } from './dto/update-profile.dto';
import { UserHealthContextService } from './services/health-context.service';

@ApiTags('User Health Context')
@Controller('health-context')
export class UserHealthContextController {
  constructor(
    private readonly userHealthContextService: UserHealthContextService,
  ) {}

  @Get()
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the current user health context aggregate' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  async getUserHealthContext(@CurrentUser() user: UserPayload) {
    return unwrapResult(this.userHealthContextService.getForUser(user.sub));
  }

  @Patch('profile')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update the current user health-context profile',
  })
  @ApiBody({ type: UpdateHealthContextProfileDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  async updateUserHealthContextProfile(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateHealthContextProfileDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.updateProfile(user.sub, dto),
    );
  }

  // ── Allergy endpoints ──

  @Post('allergies')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create an allergy record' })
  @ApiBody({ type: CreateHealthContextAllergyDto })
  @ApiResponse({ status: 201, type: HealthContextResponseDto })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  async createAllergy(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateHealthContextAllergyDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.createAllergy(user.sub, dto),
    );
  }

  @Patch('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update an allergy record' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiBody({ type: UpdateHealthContextAllergyDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
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
  async updateAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHealthContextAllergyDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.updateAllergy(user.sub, id, dto),
    );
  }

  @Delete('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Deactivate an allergy record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
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
  @ApiBody({ type: CreateHealthContextConditionDto })
  @ApiResponse({ status: 201, type: HealthContextResponseDto })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  async createCondition(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateHealthContextConditionDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.createCondition(user.sub, dto),
    );
  }

  @Patch('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a condition record' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiBody({ type: UpdateHealthContextConditionDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
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
  async updateCondition(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHealthContextConditionDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.updateCondition(user.sub, id, dto),
    );
  }

  @Delete('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Resolve a condition record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
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
  @ApiBody({ type: CreateCurrentMedicineDto })
  @ApiResponse({ status: 201, type: HealthContextResponseDto })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ProblemDetailsDto,
  })
  async createCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateCurrentMedicineDto,
  ) {
    return unwrapResult(
      this.userHealthContextService.createCurrentMedicine(user.sub, dto),
    );
  }

  @Patch('current-medicines/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a current medicine record' })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiBody({ type: UpdateCurrentMedicineDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
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
  async updateCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCurrentMedicineDto,
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
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
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
  async deleteCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return unwrapResult(
      this.userHealthContextService.deleteCurrentMedicine(user.sub, id),
    );
  }
}
