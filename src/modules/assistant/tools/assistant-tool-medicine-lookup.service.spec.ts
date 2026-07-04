import type { AssistantToolExecutionContext } from '../types/assistant.types';
import { AssistantToolMedicineLookupService } from './assistant-tool-medicine-lookup.service';

describe('AssistantToolMedicineLookupService', () => {
  function buildContext(message: string): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: message,
      enabledContextSources: ['current_medicines'],
      memoryEnabled: false,
    };
  }

  function buildService() {
    const cnMedicinesService = {
      search: jest.fn(),
      getDetail: jest.fn(),
    };
    const drugbankMedicinesService = {
      search: jest.fn(),
      getDetail: jest.fn(),
    };

    const service = new AssistantToolMedicineLookupService(
      cnMedicinesService as never,
      drugbankMedicinesService as never,
    );

    return {
      service,
      deps: {
        cnMedicinesService,
        drugbankMedicinesService,
      },
    };
  }

  it('searches structured CN medicine products with a bounded limit', async () => {
    const { service, deps } = buildService();
    deps.cnMedicinesService.search.mockResolvedValue({
      items: [
        {
          id: 'cn-1',
          source: 'cn',
          name: '布洛芬缓释胶囊',
          subtitle: '0.3g*10粒 / 某某制药',
          summary: '用于缓解疼痛。',
          tags: ['OTC'],
          imageUrl: null,
          matchedBy: ['name'],
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    });

    const result = await service.searchCnMedicineProducts(
      buildContext(JSON.stringify({ query: '布洛芬缓释胶囊', limit: 1 })),
    );

    expect(deps.cnMedicinesService.search).toHaveBeenCalledWith({
      q: '布洛芬缓释胶囊',
      page: 1,
      pageSize: 1,
    });
    expect(result).toMatchObject({
      query: {
        query: '布洛芬缓释胶囊',
        matchedSource: 'cn',
      },
      result: {
        products: [
          {
            id: 'cn-1',
            name: '布洛芬缓释胶囊',
          },
        ],
      },
      coverage: {
        status: 'complete',
      },
      source: {
        tool: 'search_cn_medicine_products',
      },
    });
  });

  it('returns partial coverage when CN medicine detail resolution finds multiple candidates', async () => {
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
      pagination: {
        page: 1,
        pageSize: 5,
        total: 2,
        totalPages: 1,
      },
    });

    const result = await service.getCnMedicineDetail(buildContext('阿司匹林'));

    expect(result).toMatchObject({
      result: {
        product: null,
        candidates: [
          { id: 'cn-1', name: '阿司匹林肠溶片' },
          { id: 'cn-2', name: '阿司匹林泡腾片' },
        ],
      },
      coverage: {
        status: 'partial',
      },
      source: {
        tool: 'get_cn_medicine_detail',
      },
    });
  });

  it('loads CN medicine detail directly from a structured product id payload', async () => {
    const { service, deps } = buildService();
    deps.cnMedicinesService.getDetail.mockResolvedValue({
      id: 'cn-1',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      subtitle: '0.3g*10粒 / 某某制药',
      detail: {
        kind: 'cnProduct',
        approvalNumber: '国药准字H10900089',
        manufacturer: '某某制药',
        packageSpec: '0.3g*10粒',
        brandName: null,
        ingredients: '布洛芬',
      },
    });

    const result = await service.getCnMedicineDetail(
      buildContext(JSON.stringify({ id: 'cn-1', query: '布洛芬缓释胶囊' })),
    );

    expect(deps.cnMedicinesService.getDetail).toHaveBeenCalledWith('cn-1');
    expect(result).toMatchObject({
      query: {
        query: '布洛芬缓释胶囊',
        matchedSource: 'cn',
        productId: 'cn-1',
      },
      result: {
        product: {
          id: 'cn-1',
          name: '布洛芬缓释胶囊',
          detail: {
            approvalNumber: '国药准字H10900089',
          },
        },
      },
      coverage: {
        status: 'complete',
      },
    });
  });

  it('resolves one DrugBank detail from a plain-text query when search returns a single candidate', async () => {
    const { service, deps } = buildService();
    deps.drugbankMedicinesService.search.mockResolvedValue({
      items: [
        {
          id: 'DB01050',
          source: 'drugbank',
          name: 'Ibuprofen',
          subtitle: 'CAS 15687-27-1',
          summary: 'A non-steroidal anti-inflammatory drug.',
          tags: ['approved'],
          imageUrl: null,
          matchedBy: ['name'],
        },
      ],
      pagination: {
        page: 1,
        pageSize: 5,
        total: 1,
        totalPages: 1,
      },
    });
    deps.drugbankMedicinesService.getDetail.mockResolvedValue({
      id: 'DB01050',
      source: 'drugbank',
      name: 'Ibuprofen',
      subtitle: 'CAS 15687-27-1',
      detail: {
        kind: 'drugbank',
        description: 'A non-steroidal anti-inflammatory drug.',
        indication: 'Used for pain, fever, and inflammation.',
        mechanismOfAction: 'Inhibits prostaglandin synthesis.',
      },
    });

    const result = await service.getDrugbankDetail(
      buildContext('ibuprofen mechanism'),
    );

    expect(deps.drugbankMedicinesService.search).toHaveBeenCalledWith({
      q: 'ibuprofen mechanism',
      page: 1,
      pageSize: 5,
    });
    expect(deps.drugbankMedicinesService.getDetail).toHaveBeenCalledWith(
      'DB01050',
    );
    expect(result).toMatchObject({
      result: {
        drug: {
          id: 'DB01050',
          name: 'Ibuprofen',
        },
      },
      coverage: {
        status: 'complete',
      },
      source: {
        tool: 'get_drugbank_detail',
      },
    });
  });
});
