import { Module } from '@nestjs/common';
import {
  InternalPermissionsController,
  PermissionsController,
} from './permissions.controller';
import { PermissionsCache } from './permissions.cache';
import { PermissionsService } from './permissions.service';
import { RolePermissionsConsumer } from './role-permissions.consumer';

@Module({
  controllers: [PermissionsController, InternalPermissionsController],
  providers: [PermissionsService, PermissionsCache, RolePermissionsConsumer],
})
export class PermissionsModule {}
