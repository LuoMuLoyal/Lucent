import { Injectable } from '@nestjs/common';
import type {
  ReportDashboardDataDto,
  ReportFindingDto,
  ReportPatternDto,
} from './dto';
import type { MetricStatus } from './reports.types';

@Injectable()
export class ReportsPresenterService {
  buildScore(statuses: MetricStatus[]): ReportDashboardDataDto['score'] {
    const scoreParts = statuses.map((status) => {
      switch (status) {
        case 'good':
          return 35;
        case 'stable':
          return 25;
        case 'needs_attention':
          return 15;
        case 'insufficient_data':
          return 18;
      }
    });

    const value = Math.min(
      100,
      Math.max(
        0,
        scoreParts.reduce((sum, part) => sum + part, 0),
      ),
    );

    let status: MetricStatus = 'stable';
    if (value >= 85) {
      status = 'good';
    } else if (value < 65) {
      status = 'needs_attention';
    }

    return {
      value,
      maxValue: 100,
      status,
      summary: this.buildScoreSummary(statuses),
    };
  }

  buildFindings(input: {
    medicationSeries: number[];
    waterSeries: number[];
    sleepStatus: MetricStatus;
  }): ReportFindingDto[] {
    const findings: ReportFindingDto[] = [];

    const lowWaterDays = input.waterSeries.filter(
      (value) => value < 1.5,
    ).length;
    if (lowWaterDays >= 4) {
      findings.push({
        kind: 'hydration',
        title: '饮水仍偏少',
        body: `近 7 天中有 ${String(lowWaterDays)} 天饮水低于 1.5L。`,
      });
    }

    const medicationStrongDays = input.medicationSeries.filter(
      (value) => value >= 80,
    ).length;
    if (medicationStrongDays >= 5) {
      findings.push({
        kind: 'medication',
        title: '用药执行较稳定',
        body: `近 7 天中有 ${String(medicationStrongDays)} 天用药完成率达到 80% 以上。`,
      });
    }

    if (input.sleepStatus === 'insufficient_data') {
      findings.push({
        kind: 'sleep',
        title: '睡眠数据不足',
        body: '当前还没有稳定的睡眠合同数据，暂不展示真实睡眠趋势。',
      });
    }

    return findings.slice(0, 3);
  }

  buildPatterns(input: {
    medicationSeries: number[];
    waterSeries: number[];
    sleepSeries: number[];
  }): ReportPatternDto[] {
    return [
      {
        kind: 'medication',
        title: '用药依从性',
        status: input.medicationSeries.some((value) => value > 0)
          ? 'good'
          : 'insufficient_data',
        body: input.medicationSeries.some((value) => value > 0)
          ? '本周可见用药计划执行情况，适合继续保持固定节奏。'
          : '当前暂无足够用药计划数据来判断依从性趋势。',
        sparkline: input.medicationSeries,
      },
      {
        kind: 'hydration',
        title: '饮水趋势',
        status:
          input.waterSeries.filter((value) => value >= 1.5).length >= 4
            ? 'stable'
            : 'needs_attention',
        body:
          input.waterSeries.filter((value) => value >= 1.5).length >= 4
            ? '本周饮水有一定连续性，但仍建议继续巩固。'
            : '近 7 天饮水连续性不足，建议先稳定日常补水节奏。',
        sparkline: input.waterSeries,
      },
      {
        kind: 'sleep',
        title: '睡眠趋势',
        status: 'insufficient_data',
        body: '睡眠合同尚未接入真实持久化数据，当前仅保留缺失状态。',
        sparkline: input.sleepSeries,
      },
    ];
  }

  private buildScoreSummary(statuses: MetricStatus[]): string {
    const medicationStatus = statuses[0];
    const waterStatus = statuses[1];
    const sleepStatus = statuses[2];
    const parts: string[] = [];

    if (medicationStatus === 'good') {
      parts.push('本周用药完成较稳');
    }
    if (waterStatus === 'needs_attention') {
      parts.push('饮水仍有提升空间');
    }
    if (sleepStatus === 'insufficient_data') {
      parts.push('睡眠数据暂不足');
    }

    return parts.length > 0 ? `${parts.join('，')}。` : '本周报告数据已更新。';
  }
}
