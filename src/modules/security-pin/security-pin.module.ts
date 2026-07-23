import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SecurityPinService } from './services';
import { SecurityElevationGuard } from './guards/elevation.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [SecurityPinService, SecurityElevationGuard],
  exports: [SecurityPinService, SecurityElevationGuard],
})
export class SecurityPinModule {}
