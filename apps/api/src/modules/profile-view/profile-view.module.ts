import { Global, Module } from '@nestjs/common';
import { ProfileViewService } from './profile-view.service';

@Global()
@Module({
  providers: [ProfileViewService],
  exports: [ProfileViewService],
})
export class ProfileViewModule {}
