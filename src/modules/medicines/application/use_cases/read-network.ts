/**
 * 单药邻域图用例（`application/use_cases`）。
 *
 * 职责边界很窄，但三条都不能省：
 *
 * 1. **只对 DrugBank 有图**：中文说明书没有靶点/相互作用边，`source=cn` 时
 *    图是空的而不是错误——错误会让人以为服务挂了；
 * 2. **上限钳制在应用层**：DTO 已经 `.max(100)`，这里再钳一次是因为用例也
 *    会被内部调用方使用，而不是只走 HTTP；
 * 3. **中心不存在 → `not_found`**：与详情端点保持同一错误码，客户端只需处理
 *    一套。
 *
 * 判定（截断数、排序声明）全部委托给 `domain/relations/network.ts`，
 * 这里不做算术——那正是单测锁住的地方。
 */

import { Inject, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  buildNetworkGraph,
  MAX_NEIGHBOUR_LIMIT,
  type NetworkDepth,
  type NetworkGraph,
} from '../../domain/relations/network.js';
import {
  MEDICINES_NETWORK_READER,
  type MedicinesNetworkReader,
} from '../ports/network.js';
import {
  CN_MEDICINES_READER,
  type MedicinesSourceReader,
} from '../ports/knowledge.js';
import type { MedicineDetailView } from '../ports/knowledge-view.js';
import { resolveMedicineSource } from '../read_models/medicine-detail.js';
import type { MedicineKnowledgeSource } from '../../domain/medicine/medicine-source.js';

/** 事务边界之外的一次邻域读取。 */
export interface ReadNetworkCommand {
  readonly id: string;
  readonly source: string | undefined;
  readonly depth: NetworkDepth;
  readonly limit: number;
}

@Injectable()
export class ReadMedicineNetwork {
  constructor(
    @Inject(MEDICINES_NETWORK_READER)
    private readonly reader: MedicinesNetworkReader,
    @Inject(CN_MEDICINES_READER)
    private readonly cnReader: MedicinesSourceReader<MedicineDetailView>,
    private readonly i18n: I18nService,
  ) {}

  execute(
    request: ReadNetworkCommand,
  ): ResultAsync<NetworkGraph, DomainFailure> {
    return resolveMedicineSource(request.source, this.i18n).andThen((source) =>
      this.read(request, source),
    );
  }

  private read(
    request: ReadNetworkCommand,
    source: MedicineKnowledgeSource,
  ): ResultAsync<NetworkGraph, DomainFailure> {
    const id = request.id.trim();

    if (id === '') {
      return errAsync(
        createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
          detail: this.i18n.t('medicine.id_required'),
        }),
      );
    }

    if (source !== 'drugbank') {
      // 中文说明书没有靶点/相互作用边，所以图恒为空——但**仍然要确认药品存在**：
      // 对一个不存在的 id 返回 200 空图，等于告诉客户端「这个药存在且没有关系」，
      // 那是撒谎。存在性用与详情端点同一个 reader，错误码也保持一致。
      return fromPromise(this.cnReader.getDetail(id), (error) =>
        createDomainFailure({
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          cause: error instanceof Error ? error : undefined,
        }),
      ).andThen((detail) =>
        detail === null
          ? errAsync(
              createDomainFailure({
                kind: 'not_found',
                code: 'RESOURCE_NOT_FOUND',
                detail: this.i18n.t('medicine.not_found'),
              }),
            )
          : okAsync(emptyGraph({ id, name: detail.name })),
      );
    }

    const limit = Math.min(
      Math.max(1, Math.trunc(request.limit)),
      MAX_NEIGHBOUR_LIMIT,
    );

    return fromPromise(
      this.reader.read({ drugbankId: id, depth: request.depth, limit }),
      (error) =>
        createDomainFailure({
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          cause: error instanceof Error ? error : undefined,
        }),
    ).andThen((facts) =>
      facts.center === null
        ? errAsync(
            createDomainFailure({
              kind: 'not_found',
              code: 'RESOURCE_NOT_FOUND',
              detail: this.i18n.t('medicine.not_found'),
            }),
          )
        : okAsync(
            buildNetworkGraph({
              center: facts.center,
              degree: facts.degree,
              neighbours: facts.neighbours,
              edges: facts.edges,
            }),
          ),
    );
  }
}

/** 无图的源（中文说明书）返回的空图。 */
function emptyGraph(center: NetworkGraph['center']): NetworkGraph {
  return {
    center,
    degree: { interactions: 0, targets: 0 },
    neighbours: [],
    edges: [],
    truncated: 0,
    ordering: 'drugbank_id_asc',
  };
}
