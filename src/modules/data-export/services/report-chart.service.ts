import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import QuickChart from 'quickchart-js';
import type { ReportDashboardDataDto } from '../../reports/dto';

@Injectable()
export class ReportChartService {
  private readonly logger = new Logger(ReportChartService.name);

  constructor(
    readonly configService: ConfigService = void 0 as unknown as ConfigService,
  ) {}

  /**
   * Generate a trend chart PNG for the given metric data.
   * Returns a Buffer containing the PNG image, or null if chart generation fails.
   */
  async buildTrendChart(
    metric: ReportDashboardDataDto['metrics'][number],
    _locale: string,
  ): Promise<Buffer | null> {
    try {
      const chart = new QuickChart();
      chart.setWidth(600);
      chart.setHeight(200);
      chart.setBackgroundColor('transparent');

      const points = metric.sparkline;
      const labels: string[] = points.map((_, i: number) => String(i + 1));
      const dataValues: number[] = points.map((v: number) => v);
      const metricLabel = metric.kind;

      chart.setConfig({
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: metricLabel,
              data: dataValues,
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34,197,94,0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 3,
            },
          ],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#6b7280', font: { size: 10 } },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(107,114,128,0.15)' },
              ticks: { color: '#6b7280', font: { size: 10 } },
            },
          },
        },
      });

      const url = chart.getUrl();
      if (!url) return null;

      const response = await fetch(url);
      if (!response.ok) return null;

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      this.logger.warn(`Failed to build trend chart: ${String(error)}`);
      return null;
    }
  }

  /**
   * Generate a score gauge/summary chart.
   */
  async buildScoreChart(
    score: number,
    statusLabel: string,
  ): Promise<Buffer | null> {
    try {
      const chart = new QuickChart();
      chart.setWidth(300);
      chart.setHeight(200);
      chart.setBackgroundColor('transparent');

      const color =
        score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

      chart.setConfig({
        type: 'doughnut',
        data: {
          datasets: [
            {
              data: [score, 100 - score],
              backgroundColor: [color, 'rgba(107,114,128,0.1)'],
              borderWidth: 0,
            },
          ],
        },
        options: {
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: [String(score), statusLabel],
              color: '#374151',
              font: { size: 28 },
              position: 'bottom',
            },
          },
        },
      });

      const url = chart.getUrl();
      if (!url) return null;

      const response = await fetch(url);
      if (!response.ok) return null;

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }

  get isConfigured(): boolean {
    return true; // QuickChart uses a free public API by default
  }
}
