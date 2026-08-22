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
  async getUserHealthContext(@CurrentUser() user: UserPayload) {
    const healthContext = await this.userHealthContextService.getForUser(
      user.sub,
    );

    return healthContext;
  }

  @Patch('profile')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update the current user health-context profile',
  })
  @ApiBody({ type: UpdateHealthContextProfileDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateUserHealthContextProfile(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateHealthContextProfileDto,
  ) {
    const healthContext = await this.userHealthContextService.updateProfile(
      user.sub,
      dto,
    );

    return healthContext;
  }

  // ── Allergy endpoints ──

  @Post('allergies')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create an allergy record' })
  @ApiBody({ type: CreateHealthContextAllergyDto })
  @ApiResponse({ status: 201, type: HealthContextResponseDto })
  async createAllergy(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateHealthContextAllergyDto,
  ) {
    const healthContext = await this.userHealthContextService.createAllergy(
      user.sub,
      dto,
    );
    return healthContext;
  }

  @Patch('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update an allergy record' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiBody({ type: UpdateHealthContextAllergyDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHealthContextAllergyDto,
  ) {
    const healthContext = await this.userHealthContextService.updateAllergy(
      user.sub,
      id,
      dto,
    );
    return healthContext;
  }

  @Delete('allergies/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Deactivate an allergy record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async deleteAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const healthContext = await this.userHealthContextService.deleteAllergy(
      user.sub,
      id,
    );
    return healthContext;
  }

  // ── Condition endpoints ──

  @Post('conditions')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a condition record' })
  @ApiBody({ type: CreateHealthContextConditionDto })
  @ApiResponse({ status: 201, type: HealthContextResponseDto })
  async createCondition(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateHealthContextConditionDto,
  ) {
    const healthContext = await this.userHealthContextService.createCondition(
      user.sub,
      dto,
    );
    return healthContext;
  }

  @Patch('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a condition record' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiBody({ type: UpdateHealthContextConditionDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateCondition(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHealthContextConditionDto,
  ) {
    const healthContext = await this.userHealthContextService.updateCondition(
      user.sub,
      id,
      dto,
    );
    return healthContext;
  }

  @Delete('conditions/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Resolve a condition record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async deleteCondition(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const healthContext = await this.userHealthContextService.deleteCondition(
      user.sub,
      id,
    );
    return healthContext;
  }

  // ── Current medicine endpoints ──

  @Post('current-medicines')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Add a current medicine record' })
  @ApiBody({ type: CreateCurrentMedicineDto })
  @ApiResponse({ status: 201, type: HealthContextResponseDto })
  async createCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateCurrentMedicineDto,
  ) {
    const healthContext =
      await this.userHealthContextService.createCurrentMedicine(user.sub, dto);
    return healthContext;
  }

  @Patch('current-medicines/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a current medicine record' })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiBody({ type: UpdateCurrentMedicineDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCurrentMedicineDto,
  ) {
    const healthContext =
      await this.userHealthContextService.updateCurrentMedicine(
        user.sub,
        id,
        dto,
      );
    return healthContext;
  }

  @Delete('current-medicines/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Deactivate a current medicine record (soft delete)',
  })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async deleteCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const healthContext =
      await this.userHealthContextService.deleteCurrentMedicine(user.sub, id);
    return healthContext;
  }
}
