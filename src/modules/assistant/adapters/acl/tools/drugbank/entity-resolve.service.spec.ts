import { AssistantToolDrugbankEntityResolveService } from './entity-resolve.service.js';

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

  it('returns partial coverage with candidates when several entities match equally well', async () => {
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

    // 前缀查询（不是任何一个药的全名）才算歧义：精确同名会被下面的用例判成 complete。
    const result = await service.resolve({
      userId: 'user-1',
      locale: 'en',
      userMessage: 'Ibupro',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.coverage.status).toBe('partial');
    expect(result.ambiguities.length).toBeGreaterThan(0);
  });

  it('prefers the exact drug name over its salt/ester variants', async () => {
    const service = new AssistantToolDrugbankEntityResolveService({
      drugbankDrug: {
        findMany: vi.fn().mockResolvedValue([
          {
            drugbankId: 'DB14649',
            name: 'Dexamethasone acetate',
            casNumber: '1177-87-3',
            unii: 'R8N31ZLQ7D',
          },
          {
            drugbankId: 'DB01234',
            name: 'Dexamethasone',
            casNumber: '50-02-2',
            unii: 'WK2XYI10QM',
          },
        ]),
      },
    } as never);

    // `contains` 会把原药与酯/盐一起带回来；旧实现一律判 partial，于是调用方
    // （search_drugbank_passages）永远拿不到作用域。精确同名是确定性判据。
    const result = await service.resolve({
      userId: 'user-1',
      locale: 'en',
      userMessage: 'dexamethasone',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.coverage.status).toBe('complete');
    expect(result.result['entities']).toEqual([
      expect.objectContaining({
        drugbankId: 'DB01234',
        name: 'Dexamethasone',
      }),
    ]);
  });

  it('reads the drug name from tool arguments instead of the whole user message', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        drugbankId: 'DB01050',
        name: 'Ibuprofen',
        casNumber: '15687-27-1',
        unii: 'WK2XYI10QM',
      },
    ]);
    const service = new AssistantToolDrugbankEntityResolveService({
      drugbankDrug: { findMany },
    } as never);

    const result = await service.resolve({
      userId: 'user-1',
      locale: 'en',
      userMessage:
        '查询地塞米松和布洛芬的相互作用，以及哪种药物不能和他们同时服用',
      enabledContextSources: [],
      memoryEnabled: false,
      toolArgs: { query: 'ibuprofen' },
    });

    // 生产实测（2026-10-07）：整句当 LIKE 模式必然 0 行，参数里的药品名才是查询词。
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            { name: { contains: 'ibuprofen', mode: 'insensitive' } },
          ]),
        },
      }),
    );
    expect(result.coverage.status).toBe('complete');
  });
});
