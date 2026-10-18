import { createDomainFailure, errAsync, okAsync } from '../../../common/result/index.js';
import { responseSchemaRegistrations } from '../../../common/api/response-schema.registry.js';
import { funnelResponseSchema } from '../../product-events/index.js';
import type { ProductFunnelService } from '../../product-events/index.js';
import type { FunnelDataDto } from '../../product-events/index.js';
import { AdminMetricsController } from './metrics.controller.js';

const funnel: FunnelDataDto = {
  daily: [],
  optional: {
    visitSummaryPreviewed: 0,
    visitSummaryExported: 0,
    visitSummaryShareCreated: 0,
    visitSummaryShareOpened: 0,
  },
  totals: {
    eventStarted: 0,
    suggestionImpression: 0,
    suggestionActioned: 0,
    eventEndedOrOutcome: 0,
    reviewOpened: 0,
  },
  window: {
    dateFrom: '2026-01-01',
    dateTo: '2026-01-30',
    generatedAt: '2026-01-31T00:00:00.000Z',
    detailsSuppressed: true,
  },
};

function makeController(funnelService: Partial<ProductFunnelService>) {
  return new AdminMetricsController(
    funnelService as unknown as ProductFunnelService,
  );
}

describe('AdminMetricsController', () => {
  it('delegates the window to the product-events funnel service', async () => {
    const getFunnel = vi.fn().mockReturnValue(okAsync(funnel));
    const controller = makeController({ getFunnel });

    await expect(
      controller.getFunnel({ dateFrom: '2026-01-01' }),
    ).resolves.toEqual(funnel);
    expect(getFunnel).toHaveBeenCalledWith({ dateFrom: '2026-01-01' });
  });

  it('folds an invalid window into a DomainFailureException', async () => {
    const controller = makeController({
      getFunnel: vi.fn().mockReturnValue(
        errAsync(
          createDomainFailure({ kind: 'validation', code: 'VALIDATION_FAILED' }),
        ),
      ),
    });

    await expect(controller.getFunnel({})).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'VALIDATION_FAILED' },
    });
  });

  it('documents the admin path with the shared funnel response component', () => {
    expect(responseSchemaRegistrations).toContainEqual({
      path: '/api/v1/admin/metrics/funnel',
      method: 'get',
      componentName: 'FunnelResponse',
      schema: funnelResponseSchema,
      description: 'Aggregated funnel counts for the requested window.',
    });
  });
});
