import { Injectable } from '@nestjs/common';
import type { EnvironmentSnapshotDto } from '../dto/snapshot.dto';
import type { EnvironmentSnapshotQueryDto } from '../dto/snapshot-query.dto';
import {
  type EnvironmentSnapshotLocationInput,
  getStaticEnvironmentSnapshot,
} from '../config/reference';

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
