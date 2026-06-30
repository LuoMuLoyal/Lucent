import { Injectable } from '@nestjs/common';
import type {
  EnvironmentSnapshotDto,
  EnvironmentSnapshotQueryDto,
} from '../dto';
import {
  type EnvironmentSnapshotLocationInput,
  getStaticEnvironmentSnapshot,
} from '../config/environment-reference';

@Injectable()
export class EnvironmentService {
  getSnapshot(query: EnvironmentSnapshotQueryDto): EnvironmentSnapshotDto {
    const location: EnvironmentSnapshotLocationInput = {};

    if (query.lat !== undefined) {
      location.lat = query.lat;
    }
    if (query.lon !== undefined) {
      location.lon = query.lon;
    }

    return getStaticEnvironmentSnapshot(location);
  }
}
