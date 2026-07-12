import { AssistantToolDrugbankEntityResolveService } from './entity-resolve.service';

describe('AssistantToolDrugbankEntityResolveService', () => {
  it('returns a single DrugBank entity when one clear candidate matches', async () => {
    const service = new AssistantToolDrugbankEntityResolveService({
      drugbankDrug: {
        findMany: vi.fn().mockResolvedValue([
          {
            drugbankId: 'DB01050',
            name: 'Ibuprofen',
            casNumber: '15687-27-1',
            unii: 'WK2XYI10QM',
          },
        ]),
      },
    } as never);

    const result = await service.resolve({
      userId: 'user-1',
      locale: 'en',
      userMessage: 'Ibuprofen',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.coverage.status).toBe('complete');
    expect(result.result['entities']).toHaveLength(1);
  });

  it('returns partial coverage with candidates when multiple entities remain ambiguous', async () => {
    const service = new AssistantToolDrugbankEntityResolveService({
      drugbankDrug: {
        findMany: vi.fn().mockResolvedValue([
          {
            drugbankId: 'DB01050',
            name: 'Ibuprofen',
            casNumber: '15687-27-1',
            unii: 'WK2XYI10QM',
          },
          {
            drugbankId: 'DB99999',
            name: 'Ibuprofen Lysine',
            casNumber: '57469-78-0',
            unii: 'R8N31ZLQ7D',
          },
        ]),
      },
    } as never);

    const result = await service.resolve({
      userId: 'user-1',
      locale: 'en',
      userMessage: 'Ibuprofen',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.coverage.status).toBe('partial');
    expect(result.ambiguities.length).toBeGreaterThan(0);
  });
});
