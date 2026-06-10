import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { DataExportRequestDataDto } from './dto';
import type { DataExportRequest } from '../../generated/prisma/client';

@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(userId: string): Promise<DataExportRequestDataDto> {
    const row = await this.prisma.dataExportRequest.create({
      data: {
        userId,
        status: 'requested',
      },
    });

    return this.toDto(row);
  }

  async getLatestRequest(
    userId: string,
  ): Promise<DataExportRequestDataDto | null> {
    const row = await this.prisma.dataExportRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return row ? this.toDto(row) : null;
  }

  private toDto(row: DataExportRequest): DataExportRequestDataDto {
    return {
      id: row.id,
      status: row.status as DataExportRequestDataDto['status'],
      requestedAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      downloadUrl: row.downloadUrl,
      errorMessage: row.errorMessage,
    };
  }
}
