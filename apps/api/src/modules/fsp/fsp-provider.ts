/**
 * Контракт провайдера данных ФСП. Модель платформы (FspAchievement) не зависит от внешнего JSON:
 * провайдер отвечает за преобразование формата источника.
 *
 * Идентификация пользователя через будущий ФСП ID (Keycloak, OIDC: issuer + subject → локальный userId)
 * и получение достижений через API реестра — разные интеграции; здесь описана только вторая.
 */
export interface FspAchievementRecord {
  externalId: string;
  eventId: string | null;
  eventTitle: string | null;
  discipline: string | null;
  eventLevel: string | null;
  /** YYYY-MM-DD */
  eventDate: string | null;
  participationType: string | null;
  place: number | null;
  teamRole: string | null;
  skillTags: string[];
  source: string;
  verifiedAt: string | null;
}

export class FspProviderError extends Error {
  constructor(
    public readonly code: 'FSP_UNAVAILABLE' | 'FSP_NOT_FOUND' | 'FSP_BAD_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'FspProviderError';
  }
}

export interface FspProvider {
  readonly name: string;
  /** Демонстрационные данные помечаются в интерфейсе и не называются подтверждёнными федерацией. */
  readonly isDemo: boolean;
  /** Проверка, что пользователь владеет ФСП ID (в деморежиме — одноразовый код из фикстуры). */
  verifyLinkCode(externalId: string, code: string): Promise<boolean>;
  fetchAchievements(externalId: string): Promise<FspAchievementRecord[]>;
}

export const FSP_PROVIDER = Symbol('FSP_PROVIDER');
