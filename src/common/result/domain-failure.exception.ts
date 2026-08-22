import type { DomainFailure } from './domain-failure';

export class DomainFailureException extends Error {
  constructor(readonly failure: DomainFailure) {
    super(`Domain failure: ${failure.code}`);
    this.name = DomainFailureException.name;
  }
}
