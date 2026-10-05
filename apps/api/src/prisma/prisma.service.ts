import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_ENV, type AppEnv } from '../config/env';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export function createPrismaClient(databaseUrl: string, poolMax = 10): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: poolMax });
  return new PrismaClient({ adapter });
}

/** Единственная точка доступа к PostgreSQL. Используется только backend-модулями. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: AppEnv) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 10 }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
