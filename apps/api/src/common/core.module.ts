import { Global, Module, type Provider } from '@nestjs/common';
import { APP_ENV, parseEnv } from '../config/env';
import { Clock, SystemClock } from './clock';
import { PolicyService } from './policy.service';
import { RateLimitService } from './rate-limit.service';

const envProvider: Provider = {
  provide: APP_ENV,
  useFactory: () => parseEnv(process.env),
};

/** Глобальные инфраструктурные сервисы: конфигурация, часы, политики, rate limit. */
@Global()
@Module({
  providers: [envProvider, { provide: Clock, useClass: SystemClock }, PolicyService, RateLimitService],
  exports: [APP_ENV, Clock, PolicyService, RateLimitService],
})
export class CoreModule {}
