import { ApiProperty } from '@nestjs/swagger';
import {
  ASSISTANT_CONTEXT_SOURCES,
  ASSISTANT_TOOL_NAMES,
  type AssistantContextSource,
  type AssistantToolDisabledReason,
  type AssistantToolName,
} from '../tools/types';
import { AssistantContextSettingsDto } from '../../user-settings/dto';

export class AssistantToolCapabilityDto {
  @ApiProperty({
    description: 'Stable tool identifier exposed to the client.',
    enum: ASSISTANT_TOOL_NAMES,
  })
  name!: AssistantToolName;

  @ApiProperty({
    description: `Context sources this tool requires before it may run. Allowed values: ${ASSISTANT_CONTEXT_SOURCES.join(', ')}.`,
    type: [String],
    example: ['health_profile'],
  })
  requiredContextSources!: AssistantContextSource[];

  @ApiProperty({
    description:
      'Whether the current user settings permit this tool in principle.',
  })
  permittedByUser!: boolean;

  @ApiProperty({
    description: 'Whether this tool is currently executable for this user.',
  })
  enabled!: boolean;

  @ApiProperty({
    description:
      'Whether the server has already implemented this tool beyond planning/foundation wiring.',
  })
  implemented!: boolean;

  @ApiProperty({
    description: 'Why the tool is currently disabled, or null when enabled.',
    nullable: true,
    enum: [
      'chat_disabled',
      'context_disabled',
      'model_not_configured',
      'not_implemented',
    ],
  })
  disabledReason!: AssistantToolDisabledReason | null;
}

export class AssistantCapabilitiesDataDto {
  @ApiProperty({
    description: 'Current backend rollout phase for the assistant.',
    example: 'foundation',
  })
  phase!: 'foundation';

  @ApiProperty({
    description: 'Whether the user has left the assistant enabled in settings.',
  })
  assistantEnabled!: boolean;

  @ApiProperty({
    description:
      'Whether cross-conversation assistant memory reuse is enabled for this user.',
  })
  assistantMemoryEnabled!: boolean;

  @ApiProperty({
    description:
      'Fine-grained assistant context permissions from user settings.',
    type: () => AssistantContextSettingsDto,
  })
  assistantContext!: AssistantContextSettingsDto;

  @ApiProperty({
    description: 'Whether the configured chat model role exists server-side.',
  })
  chatModelConfigured!: boolean;

  @ApiProperty({
    description:
      'Whether an actual end-user chat interaction route is ready to be exposed.',
  })
  interactiveChatReady!: boolean;

  @ApiProperty({
    description: 'Whether the LangGraph orchestration foundation is active.',
  })
  langGraphReady!: boolean;

  @ApiProperty({
    description: 'Whether the current backend intends to stream responses.',
  })
  streamingSupported!: boolean;

  @ApiProperty({
    description:
      'Recommended streaming transport for the current chat contract.',
    example: 'sse',
  })
  streamingTransport!: 'sse';

  @ApiProperty({
    description:
      'Whether the frontend should expect Markdown output and render it faithfully.',
  })
  markdownRenderingRecommended!: boolean;

  @ApiProperty({
    description:
      'Whether medicine-leaflet retrieval augmentation is currently enabled.',
  })
  ragEnabled!: boolean;

  @ApiProperty({
    description:
      'Tool-by-tool capability breakdown after combining system state and user permissions.',
    type: () => [AssistantToolCapabilityDto],
  })
  tools!: AssistantToolCapabilityDto[];

  @ApiProperty({
    type: String,
    description: 'ISO-8601 timestamp of the latest related settings update.',
    nullable: true,
  })
  updatedAt!: string | null;
}

export class AssistantCapabilitiesResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => AssistantCapabilitiesDataDto })
  data!: AssistantCapabilitiesDataDto;
}
