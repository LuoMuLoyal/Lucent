import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { successEnvelope } from '../../common/api-envelope';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { UserPayload } from '../auth/auth.service';
import {
  CreateCurrentMedicineDto,
  CreateHealthContextAllergyDto,
  CreateHealthContextConditionDto,
  HealthContextResponseDto,
  UpdateCurrentMedicineDto,
  UpdateHealthContextAllergyDto,
  UpdateHealthContextConditionDto,
  UpdateHealthContextProfileDto,
} from './dto';
import { UserHealthContextService } from './user-health-context.service';

@ApiTags('User Health Context')
@Controller('me/health-context')
export class UserHealthContextController {
  constructor(
    private readonly userHealthContextService: UserHealthContextService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the current user health context aggregate' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async getMeHealthContext(@CurrentUser() user: UserPayload) {
    const healthContext = await this.userHealthContextService.getForUser(
      user.sub,
    );

    return successEnvelope(healthContext);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update the current user health-context profile',
  })
  @ApiBody({ type: UpdateHealthContextProfileDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateMeHealthContextProfile(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateHealthContextProfileDto,
  ) {
    const healthContext = await this.userHealthContextService.updateProfile(
      user.sub,
      dto,
    );

    return successEnvelope(healthContext);
  }

  // ── Allergy endpoints ──

  @Post('allergies')
  @UseGuards(JwtAuthGuard)
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
    return successEnvelope(healthContext);
  }

  @Patch('allergies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update an allergy record' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiBody({ type: UpdateHealthContextAllergyDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateHealthContextAllergyDto,
  ) {
    const healthContext = await this.userHealthContextService.updateAllergy(
      user.sub,
      id,
      dto,
    );
    return successEnvelope(healthContext);
  }

  @Delete('allergies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Deactivate an allergy record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Allergy id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async deleteAllergy(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    const healthContext = await this.userHealthContextService.deleteAllergy(
      user.sub,
      id,
    );
    return successEnvelope(healthContext);
  }

  // ── Condition endpoints ──

  @Post('conditions')
  @UseGuards(JwtAuthGuard)
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
    return successEnvelope(healthContext);
  }

  @Patch('conditions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a condition record' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiBody({ type: UpdateHealthContextConditionDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateCondition(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateHealthContextConditionDto,
  ) {
    const healthContext = await this.userHealthContextService.updateCondition(
      user.sub,
      id,
      dto,
    );
    return successEnvelope(healthContext);
  }

  @Delete('conditions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Resolve a condition record (soft delete)' })
  @ApiParam({ name: 'id', description: 'Condition id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async deleteCondition(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    const healthContext = await this.userHealthContextService.deleteCondition(
      user.sub,
      id,
    );
    return successEnvelope(healthContext);
  }

  // ── Current medicine endpoints ──

  @Post('current-medicines')
  @UseGuards(JwtAuthGuard)
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
    return successEnvelope(healthContext);
  }

  @Patch('current-medicines/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a current medicine record' })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiBody({ type: UpdateCurrentMedicineDto })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async updateCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCurrentMedicineDto,
  ) {
    const healthContext =
      await this.userHealthContextService.updateCurrentMedicine(
        user.sub,
        id,
        dto,
      );
    return successEnvelope(healthContext);
  }

  @Delete('current-medicines/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Deactivate a current medicine record (soft delete)',
  })
  @ApiParam({ name: 'id', description: 'Current medicine id' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async deleteCurrentMedicine(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    const healthContext =
      await this.userHealthContextService.deleteCurrentMedicine(user.sub, id);
    return successEnvelope(healthContext);
  }
}
