import { Logger } from '@nestjs/common';
import { CatalogSyncService } from './catalog-sync.service';

/** Подмена Prisma: первые `failures` транзакций завершаются ошибкой, как при перезапуске PostgreSQL (57P03). */
function fakePrisma(failures: number) {
  let calls = 0;
  const upsert = jest.fn().mockResolvedValue({});
  const tx = { specialization: { upsert }, competencyGroup: { upsert }, skill: { upsert } };
  return {
    upsert,
    transactions: () => calls,
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => {
      calls += 1;
      if (calls <= failures) throw new Error('Database error. Code: 57P03. the database system is not yet accepting connections');
      await callback(tx);
    }),
  };
}

describe('CatalogSyncService: временная недоступность базы при старте', () => {
  beforeEach(() => {
    process.env.SKIP_CATALOG_SYNC = 'false';
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('сбой первой попытки не оставляет справочники несинхронизированными: следующая попытка проходит', async () => {
    const prisma = fakePrisma(1);
    const service = new CatalogSyncService(prisma as never);
    expect(await service.ensureSynced()).toBe(false);
    expect(service.isSynced).toBe(false);
    expect(await service.ensureSynced()).toBe(true);
    expect(service.isSynced).toBe(true);
    expect(prisma.upsert).toHaveBeenCalled();
  });

  it('после успеха новые попытки не выполняются', async () => {
    const prisma = fakePrisma(0);
    const service = new CatalogSyncService(prisma as never);
    await service.ensureSynced();
    await service.ensureSynced();
    expect(prisma.transactions()).toBe(1);
  });

  it('параллельные вызовы делят одну попытку', async () => {
    const prisma = fakePrisma(0);
    const service = new CatalogSyncService(prisma as never);
    const results = await Promise.all([service.ensureSynced(), service.ensureSynced(), service.ensureSynced()]);
    expect(results).toEqual([true, true, true]);
    expect(prisma.transactions()).toBe(1);
  });

  it('при старте с недоступной базой повтор по таймеру (2 с, затем 4 с) приводит к синхронизации', async () => {
    const prisma = fakePrisma(2);
    const service = new CatalogSyncService(prisma as never);
    await service.onApplicationBootstrap(); // 1-я попытка неудачна, запланирован повтор
    expect(service.isSynced).toBe(false);
    await jest.advanceTimersByTimeAsync(2_000); // 2-я попытка неудачна, задержка удваивается
    expect(service.isSynced).toBe(false);
    await jest.advanceTimersByTimeAsync(3_000); // 4-секундная задержка ещё не истекла
    expect(service.isSynced).toBe(false);
    await jest.advanceTimersByTimeAsync(1_000); // 3-я попытка успешна
    expect(service.isSynced).toBe(true);
    service.onModuleDestroy();
  });

  it('при отключённой синхронизации (SKIP_CATALOG_SYNC) попыток нет', async () => {
    process.env.SKIP_CATALOG_SYNC = 'true';
    const prisma = fakePrisma(0);
    const service = new CatalogSyncService(prisma as never);
    await service.onApplicationBootstrap();
    expect(await service.ensureSynced()).toBe(false);
    expect(prisma.transactions()).toBe(0);
    process.env.SKIP_CATALOG_SYNC = 'false';
  });
});
