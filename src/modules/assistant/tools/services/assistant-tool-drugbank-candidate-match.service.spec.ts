import type { AssistantToolExecutionContext } from '../../types/assistant.types';
import { AssistantToolDrugbankCandidateMatchService } from './assistant-tool-drugbank-candidate-match.service';

describe('AssistantToolDrugbankCandidateMatchService', () => {
  function buildContext(message: string): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: message,
      enabledContextSources: [],
      memoryEnabled: false,
    };
  }

  function buildService() {
    const cnMedicinesService = {
      search: jest.fn(),
      getDetail: jest.fn(),
    };
    const prisma = {
      drugbankDrug: {
        findMany: jest.fn(),
      },
    };

    const service = new AssistantToolDrugbankCandidateMatchService(
      cnMedicinesService as never,
      prisma as never,
    );

    return {
      service,
      deps: {
        cnMedicinesService,
        prisma,
      },
    };
  }

  it('returns one high-confidence candidate from an exact ingredient alias match', async () => {
    const { service, deps } = buildService();
    deps.cnMedicinesService.search.mockResolvedValue({
      items: [
        {
          id: 'cn-ibu',
          source: 'cn',
          name: '布洛芬缓释胶囊',
          subtitle: '0.3g*10粒 / 某某制药',
          summary: '用于缓解疼痛。',
          tags: ['OTC'],
          imageUrl: null,
          matchedBy: ['name'],
        },
      ],
      pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
    });
    deps.cnMedicinesService.getDetail.mockResolvedValue({
      id: 'cn-ibu',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      subtitle: '0.3g*10粒 / 某某制药',
      detail: {
        kind: 'cnProduct',
        ingredients: '布洛芬',
        manufacturer: '某某制药',
        packageSpec: '0.3g*10粒',
      },
    });
    deps.prisma.drugbankDrug.findMany.mockResolvedValue([
      {
        drugbankId: 'DB01050',
        name: 'Ibuprofen',
        synonyms: ['Ibuprofen'],
        searchText: 'ibuprofen pain relief nsaid',
      },
    ]);

    const result = await service.matchCandidates(
      buildContext('布洛芬缓释胶囊'),
    );

    expect(result).toMatchObject({
      result: {
        product: {
          id: 'cn-ibu',
          name: '布洛芬缓释胶囊',
        },
        normalizedIngredients: ['ibuprofen'],
        candidates: [
          {
            drugbankId: 'DB01050',
            name: 'Ibuprofen',
            confidence: 'high',
            matchType: 'ingredient_exact',
            matchedIngredients: ['ibuprofen'],
          },
        ],
      },
      coverage: {
        status: 'complete',
      },
      source: {
        tool: 'match_cn_product_to_drugbank_candidates',
      },
    });
  });

  it('returns multiple candidates for a compound ingredient list', async () => {
    const { service, deps } = buildService();
    deps.cnMedicinesService.search.mockResolvedValue({
      items: [
        {
          id: 'compound-1',
          source: 'cn',
          name: '复方感冒片',
          subtitle: '复方制剂',
          summary: '对乙酰氨基酚、咖啡因。',
          tags: [],
          imageUrl: null,
          matchedBy: ['name'],
        },
      ],
      pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
    });
    deps.cnMedicinesService.getDetail.mockResolvedValue({
      id: 'compound-1',
      source: 'cn',
      name: '复方感冒片',
      subtitle: '复方制剂',
      detail: {
        kind: 'cnProduct',
        ingredients: '对乙酰氨基酚、咖啡因',
      },
    });
    deps.prisma.drugbankDrug.findMany.mockResolvedValue([
      {
        drugbankId: 'DB00316',
        name: 'Acetaminophen',
        synonyms: ['Paracetamol'],
        searchText: 'acetaminophen paracetamol analgesic',
      },
      {
        drugbankId: 'DB00201',
        name: 'Caffeine',
        synonyms: ['1,3,7-Trimethylxanthine'],
        searchText: 'caffeine stimulant',
      },
    ]);

    const result = await service.matchCandidates(buildContext('复方感冒片'));

    expect(result.coverage.status).toBe('complete');
    expect(result.result['normalizedIngredients']).toEqual([
      'acetaminophen',
      'caffeine',
    ]);
    expect(result.result['candidates']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drugbankId: 'DB00316',
          matchedIngredients: ['acetaminophen'],
        }),
        expect.objectContaining({
          drugbankId: 'DB00201',
          matchedIngredients: ['caffeine'],
        }),
      ]),
    );
  });

  it('returns partial coverage when the CN product query is ambiguous', async () => {
    const { service, deps } = buildService();
    deps.cnMedicinesService.search.mockResolvedValue({
      items: [
        {
          id: 'cn-1',
          source: 'cn',
          name: '阿司匹林肠溶片',
          subtitle: '25mg',
          summary: null,
          tags: [],
          imageUrl: null,
          matchedBy: ['name'],
        },
        {
          id: 'cn-2',
          source: 'cn',
          name: '阿司匹林泡腾片',
          subtitle: '0.5g',
          summary: null,
          tags: [],
          imageUrl: null,
          matchedBy: ['name'],
        },
      ],
      pagination: { page: 1, pageSize: 5, total: 2, totalPages: 1 },
    });

    const result = await service.matchCandidates(buildContext('阿司匹林'));

    expect(result).toMatchObject({
      coverage: {
        status: 'partial',
      },
      result: {
        product: null,
      },
    });
    expect(result.result['productCandidates']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cn-1', name: '阿司匹林肠溶片' }),
        expect.objectContaining({ id: 'cn-2', name: '阿司匹林泡腾片' }),
      ]),
    );
    expect(deps.cnMedicinesService.getDetail).not.toHaveBeenCalled();
    expect(deps.prisma.drugbankDrug.findMany).not.toHaveBeenCalled();
  });

  it('falls back to product-name alias matching when ingredients are absent', async () => {
    const { service, deps } = buildService();
    deps.cnMedicinesService.search.mockResolvedValue({
      items: [
        {
          id: 'cn-ibu',
          source: 'cn',
          name: '布洛芬缓释胶囊',
          subtitle: '0.3g*10粒 / 某某制药',
          summary: '用于缓解疼痛。',
          tags: ['OTC'],
          imageUrl: null,
          matchedBy: ['name'],
        },
      ],
      pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
    });
    deps.cnMedicinesService.getDetail.mockResolvedValue({
      id: 'cn-ibu',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      subtitle: '0.3g*10粒 / 某某制药',
      detail: {
        kind: 'cnProduct',
        ingredients: null,
      },
    });
    deps.prisma.drugbankDrug.findMany.mockResolvedValue([
      {
        drugbankId: 'DB01050',
        name: 'Ibuprofen',
        synonyms: ['Ibuprofen'],
        searchText: 'ibuprofen pain relief nsaid',
      },
    ]);

    const result = await service.matchCandidates(
      buildContext('布洛芬缓释胶囊'),
    );

    expect(result).toMatchObject({
      result: {
        normalizedIngredients: [],
        candidates: [
          {
            drugbankId: 'DB01050',
            name: 'Ibuprofen',
            confidence: 'medium',
            matchType: 'product_name_alias',
          },
        ],
      },
      coverage: {
        status: 'complete',
      },
    });
  });
});
