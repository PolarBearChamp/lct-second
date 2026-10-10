// Схемы ответов и ошибок для OpenAPI-документа.
//
// Контроллеры возвращают обычные объекты, поэтому схемы успешных ответов строятся из TypeScript-контрактов
// packages/contracts (те же типы использует веб-клиент) и привязываются к операциям таблицей RESPONSES.
// Контрактный тест (test/openapi.int-spec.ts) проверяет реальные ответы API по этим схемам.
import path from 'node:path';
import { createGenerator } from 'ts-json-schema-generator';

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items: Schema): Schema => ({ type: 'array', items });
const str: Schema = { type: 'string' };
const int: Schema = { type: 'integer' };
const literal = (value: string | boolean): Schema => ({ type: typeof value === 'boolean' ? 'boolean' : 'string', enum: [value] });
const obj = (properties: Record<string, Schema>, required: string[] = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const nullable = (schema: Schema): Schema => ({ nullable: true, allOf: [schema] });
const paginated = (items: Schema): Schema => obj({ items: arrayOf(items), total: int, page: int, pageSize: int });

export interface ResponseSpec {
  status: number;
  description: string;
  /** JSON-схема тела (null — тело отсутствует). */
  schema?: Schema;
  /** Бинарный ответ (например, application/pdf). */
  binary?: string;
  /** Дополнительные успешные статусы с той же схемой (например, повтор идемпотентного запроса). */
  alsoStatus?: Array<{ status: number; description: string }>;
}

const ok = (schema: Schema, description = 'Успешный ответ'): ResponseSpec => ({ status: 200, description, schema });
const created = (schema: Schema, description = 'Создано'): ResponseSpec => ({ status: 201, description, schema });
const pdf = (description: string): ResponseSpec => ({ status: 200, description, binary: 'application/pdf' });

/** Ключ: «МЕТОД /путь без префикса /api/v1». Операции, у которых схема ответа уже описана DTO-классом, здесь не перечислены. */
export const RESPONSES: Record<string, ResponseSpec> = {
  'POST /auth/logout': { status: 204, description: 'Сессия отозвана, cookie очищены' },
  'POST /auth/verify-email': ok(obj({ verified: literal(true) }), 'Email подтверждён'),
  'POST /auth/resend-verification': { status: 202, description: 'Письмо отправлено', schema: obj({ sent: literal(true) }) },
  'GET /health/live': ok(obj({ status: literal('ok') }), 'Процесс жив'),
  'GET /health/ready': {
    ...ok(obj({ status: { type: 'string', enum: ['ok', 'unavailable'] }, checks: obj({ database: { type: 'string', enum: ['ok', 'fail'] }, catalog: { type: 'string', enum: ['ok', 'fail'] } }) }), 'Готов'),
    alsoStatus: [{ status: 503, description: 'Недоступна БД или справочники не синхронизированы' }],
  },

  'GET /catalogs/specializations': ok(arrayOf(ref('SpecializationDto'))),
  'GET /catalogs/skills': ok(arrayOf(ref('SkillDto'))),
  'GET /catalogs/reference': ok(ref('ReferenceDto')),
  'GET /catalogs/survey': ok(ref('SurveyDto')),

  'GET /candidate/profile': ok(ref('OwnProfileResponse')),
  'PATCH /candidate/profile': ok(ref('OwnProfileResponse')),
  'GET /candidate/profile/preview': ok(ref('CandidateProfileView'), 'Обезличенная карточка так, как её видит работодатель без доступа'),
  'PUT /candidate/survey': ok(obj({ survey: obj({ version: str, answers: { type: 'object', additionalProperties: true }, completedAt: str }), recommendation: ref('SurveyRecommendation') })),
  'PUT /candidate/consents': ok(ref('OwnProfileResponse')),
  'PUT /candidate/consents/guardian': ok(ref('OwnProfileResponse')),
  'GET /candidate/qualifications': ok(ref('QualificationsResponse')),
  'POST /candidate/profile/resume': ok(ref('ResumeAnalysisResponse'), 'Предложения для профиля по PDF-резюме (файл не сохраняется, ничего не применено)'),
  'GET /candidate/profile/pdf': pdf('PDF собственного профиля (вложение, Cache-Control: private, no-store)'),

  'GET /candidate/assessments/eligibility': ok(ref('EligibilityResponse')),
  'POST /candidate/assessments': { ...created(ref('AttemptView'), 'Попытка создана'), alsoStatus: [{ status: 200, description: 'Попытка с этим Idempotency-Key уже создана' }] },
  'GET /candidate/assessments': ok(arrayOf(ref('AttemptSummary'))),
  'GET /candidate/assessments/{id}': ok(ref('AttemptView')),
  'PUT /candidate/assessments/{id}/answers/{itemId}': ok(ref('SavedAnswer')),
  'POST /candidate/assessments/{id}/signals': { status: 204, description: 'Сигналы приняты (счётчики добавлены к активной попытке)' },
  'POST /candidate/assessments/{id}/submit': ok(ref('AttemptResult')),
  'POST /candidate/assessments/{id}/abandon': ok(ref('AttemptSummary')),
  'GET /candidate/assessments/{id}/result': ok(ref('AttemptResult')),

  'GET /candidate/fsp-link': ok(ref('FspStateResponse')),
  'POST /candidate/fsp-link': created(ref('FspStateResponse'), 'ФСП ID привязан, история загружена (или SYNC_ERROR при недоступном реестре)'),
  'DELETE /candidate/fsp-link': ok(ref('FspStateResponse')),
  'POST /candidate/fsp-link/sync': ok(ref('FspStateResponse')),

  'GET /candidate/invitations': ok(paginated(ref('InvitationBase'))),
  'GET /candidate/invitations/{id}': ok(ref('CandidateInvitationDetail')),
  'POST /candidate/invitations/{id}/view': ok(ref('CandidateInvitationDetail')),
  'POST /candidate/invitations/{id}/accept': ok(ref('CandidateInvitationDetail')),
  'POST /candidate/invitations/{id}/decline': ok(ref('CandidateInvitationDetail')),
  'GET /candidate/contact-access': ok(arrayOf(ref('ContactAccessItem'))),
  'DELETE /candidate/contact-access/{companyId}': ok(arrayOf(ref('ContactAccessItem')), 'Актуальный список доступов после отзыва'),

  'GET /employer/company': ok(obj({ company: nullable(ref('CompanyView')) })),
  'PUT /employer/company': ok(obj({ company: ref('CompanyView') })),
  'POST /employer/company/verification': ok(obj({ company: ref('CompanyView') })),
  'POST /employer/needs': created(ref('HiringNeedView')),
  'GET /employer/needs': ok(arrayOf(ref('HiringNeedView'))),
  'GET /employer/needs/{id}': ok(ref('HiringNeedView')),
  'PATCH /employer/needs/{id}': ok(ref('HiringNeedView')),
  'POST /employer/needs/{id}/assessment-preview': ok(ref('AssessmentPreviewResponse')),

  'GET /employer/candidates': ok(ref('BankResponse')),
  'GET /employer/candidates/{id}': ok(ref('EmployerCandidateResponse')),
  'GET /employer/candidates/{id}/pdf': pdf('PDF в объёме прав компании: обезличенный или с раскрытыми контактами (вложение, Cache-Control: private, no-store)'),

  'POST /employer/needs/{id}/selections': created(ref('SelectionRunView'), 'Подборка построена и сохранена'),
  'GET /employer/needs/{id}/selections': ok(arrayOf(ref('SelectionRunSummary'))),
  'GET /employer/selections/{id}': ok(ref('SelectionRunView')),
  'POST /employer/bookmarks/{candidateId}': created(obj({ candidateId: str, bookmarked: literal(true) })),
  'DELETE /employer/bookmarks/{candidateId}': ok(obj({ candidateId: str, bookmarked: literal(false) })),
  'GET /employer/bookmarks': ok(arrayOf(ref('BookmarkItem'))),

  'POST /employer/invitations': { ...created(ref('EmployerInvitationDetail'), 'Приглашение отправлено'), alsoStatus: [{ status: 200, description: 'Повтор с тем же Idempotency-Key: возвращено прежнее приглашение' }] },
  'GET /employer/invitations': ok(paginated(ref('EmployerInvitationItem'))),
  'GET /employer/invitations/{id}': ok(ref('EmployerInvitationDetail')),
  'POST /employer/invitations/{id}/withdraw': ok(ref('EmployerInvitationDetail')),

  'POST /employer/vacancies': created(ref('EmployerVacancyView'), 'Вакансия создана (черновик или опубликована)'),
  'GET /employer/vacancies': ok(arrayOf(ref('EmployerVacancyView'))),
  'GET /employer/vacancies/{id}': ok(ref('EmployerVacancyView')),
  'PATCH /employer/vacancies/{id}': ok(ref('EmployerVacancyView')),
  'POST /employer/vacancies/{id}/publish': ok(ref('EmployerVacancyView')),
  'POST /employer/vacancies/{id}/close': ok(ref('EmployerVacancyView')),
  'GET /employer/vacancies/{id}/applications': ok(ref('EmployerApplicationList')),
  'GET /employer/applications/{id}': ok(ref('EmployerApplicationDetail')),
  'POST /employer/applications/{id}/view': ok(ref('EmployerApplicationDetail')),
  'POST /employer/applications/{id}/shortlist': ok(ref('EmployerApplicationDetail')),
  'POST /employer/applications/{id}/reject': ok(ref('EmployerApplicationDetail')),

  'GET /candidate/vacancies': ok(paginated(ref('CandidateVacancyItem'))),
  'GET /candidate/vacancies/{id}': ok(ref('CandidateVacancyDetail')),
  'POST /candidate/vacancies/{id}/applications': created(ref('CandidateApplicationDetail'), 'Отклик отправлен, выбранные контакты раскрыты этой компании'),
  'GET /candidate/applications': ok(paginated(ref('ApplicationBase'))),
  'GET /candidate/applications/{id}': ok(ref('CandidateApplicationDetail')),
  'POST /candidate/applications/{id}/withdraw': ok(ref('CandidateApplicationDetail')),

  'POST /employer/tasks': created(ref('EmployerTaskView'), 'Задание создано (черновик или активно)'),
  'GET /employer/tasks': ok(arrayOf(ref('EmployerTaskView'))),
  'GET /employer/tasks/{id}': ok(ref('EmployerTaskView')),
  'PATCH /employer/tasks/{id}': ok(ref('EmployerTaskView')),
  'POST /employer/tasks/{id}/publish': ok(ref('EmployerTaskView')),
  'POST /employer/tasks/{id}/close': ok(ref('EmployerTaskView')),
  'GET /employer/tasks/{id}/submissions': ok(ref('TaskSubmissionsResponse')),
  'POST /employer/tasks/{id}/assign': created(ref('TaskAssignmentReceipt'), 'Задание отправлено кандидату'),
  'POST /employer/task-submissions/{id}/review': ok(ref('TaskSubmissionItem')),

  'GET /candidate/tasks': ok(ref('CandidateTasksResponse')),
  'GET /candidate/tasks/{id}': ok(ref('CandidateTaskView')),
  'POST /candidate/tasks/{id}/submit': ok(ref('CandidateTaskView')),
  'POST /candidate/tasks/{id}/skip': ok(ref('CandidateTaskView')),
};

// ───────────────────────────── Схемы из контрактов ─────────────────────────────

/** Приводит схему JSON Schema (draft-07) к диалекту OpenAPI 3.0: nullable вместо null, enum вместо const. */
export function toOpenApi30(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toOpenApi30);
  if (!node || typeof node !== 'object') return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) result[key] = toOpenApi30(value);

  if ('const' in result) {
    const value = result.const;
    delete result.const;
    result.enum = [value];
    result.type ??= typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
  }
  if (Array.isArray(result.type)) {
    const types = (result.type as string[]).filter((t) => t !== 'null');
    if (types.length !== (result.type as string[]).length) result.nullable = true;
    result.type = types.length === 1 ? types[0] : undefined;
    if (result.type === undefined) delete result.type;
  }
  for (const combiner of ['anyOf', 'oneOf'] as const) {
    const variants = result[combiner];
    if (!Array.isArray(variants)) continue;
    const withoutNull = variants.filter((v) => !(v && typeof v === 'object' && (v as Schema).type === 'null' && Object.keys(v as Schema).length === 1));
    if (withoutNull.length === variants.length) continue;
    result.nullable = true;
    if (withoutNull.length === 1) {
      delete result[combiner];
      const only = withoutNull[0] as Schema;
      if ('$ref' in only) result.allOf = [only];
      else Object.assign(result, only);
    } else {
      result[combiner] = withoutNull;
    }
  }
  return result;
}

/** Обратное преобразование для валидаторов JSON Schema (Ajv): nullable → type: [..., 'null'] или anyOf с null. */
export function toJsonSchemaDraft7(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchemaDraft7);
  if (!node || typeof node !== 'object') return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) result[key] = toJsonSchemaDraft7(value);
  if (result.nullable === true) {
    delete result.nullable;
    const composed = ['allOf', 'anyOf', 'oneOf', '$ref'].some((keyword) => keyword in result);
    if (typeof result.type === 'string' && !composed) {
      result.type = [result.type, 'null'];
      if (Array.isArray(result.enum) && !result.enum.includes(null)) result.enum = [...result.enum, null];
      return result;
    }
    return { anyOf: [result, { type: 'null' }] };
  }
  delete result.nullable;
  return result;
}

export function contractSchemas(root: string): Record<string, Schema> {
  const generator = createGenerator({
    path: path.join(root, 'packages', 'contracts', 'src', '*.ts').split(path.sep).join('/'),
    tsconfig: path.join(root, 'packages', 'contracts', 'tsconfig.json'),
    expose: 'export',
    topRef: true,
    skipTypeCheck: true,
    encodeRefs: false,
    additionalProperties: false,
  });
  // Генерация по одному типу: '*' не включает корневые типы, на которые ничто не ссылается.
  const wanted = new Set<string>(['ApiErrorBody']);
  for (const match of JSON.stringify(RESPONSES).matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)) wanted.add(match[1]);
  const definitions: Record<string, Schema> = {};
  for (const name of wanted) {
    // Имена Nest-DTO (…Dto) описаны самим документом, а не контрактами.
    if (name.endsWith('Dto')) continue;
    const schema = generator.createSchema(name) as { definitions?: Record<string, Schema> };
    Object.assign(definitions, schema.definitions ?? {});
  }
  const text = JSON.stringify(definitions).replace(/#\/definitions\//g, '#/components/schemas/');
  return toOpenApi30(JSON.parse(text)) as Record<string, Schema>;
}

// ───────────────────────────── Применение к документу ─────────────────────────────

interface OpenApiOperation {
  summary?: string;
  security?: unknown[];
  parameters?: Array<{ in: string; name: string }>;
  requestBody?: unknown;
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation | unknown>>;
  components?: { schemas?: Record<string, Schema> } & Record<string, unknown>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const ERROR_EXAMPLE = { code: 'FORBIDDEN_ROLE', message: 'Раздел недоступен для вашей роли', requestId: 'c3f2a9e0-6c0a-4d8e-9a77-0d6e5b3b8a11' };

/**
 * Дополняет документ: схемы контрактов → components.schemas, схемы ответов → операции, единый формат ошибок
 * (ApiErrorBody) → типовые коды 400/401/403/404/409/422/429 с пояснениями.
 */
export function applyResponseSchemas(document: OpenApiDocument, schemas: Record<string, Schema>): { unmapped: string[]; unused: string[] } {
  document.components ??= {};
  document.components.schemas ??= {};
  for (const [name, schema] of Object.entries(schemas)) document.components.schemas[name] ??= schema;
  const errorSchema = ref('ApiErrorBody');
  if (document.components.schemas.ApiErrorBody) (document.components.schemas.ApiErrorBody as Schema).example = ERROR_EXAMPLE;

  const used = new Set<string>();
  const unmapped: string[] = [];
  for (const [rawPath, item] of Object.entries(document.paths)) {
    const template = rawPath.replace(/^\/api\/v1/, '');
    for (const method of METHODS) {
      const operation = (item as Record<string, OpenApiOperation | undefined>)[method];
      if (!operation) continue;
      const key = `${method.toUpperCase()} ${template}`;
      operation.responses ??= {};
      const responses = operation.responses;
      const spec = RESPONSES[key];
      const hasDocumentedSuccess = Object.entries(responses).some(([code, r]) => code.startsWith('2') && r.content?.['application/json']?.schema);
      if (spec) {
        used.add(key);
        const content = spec.binary ? { [spec.binary]: { schema: { type: 'string', format: 'binary' } } } : spec.schema ? { 'application/json': { schema: spec.schema } } : undefined;
        for (const entry of [{ status: spec.status, description: spec.description }, ...(spec.alsoStatus ?? [])]) {
          // 503 у /health/ready описывает тот же JSON.
          responses[String(entry.status)] = { ...(responses[String(entry.status)] ?? {}), description: entry.description, ...(content ? { content } : {}) };
        }
        // Стандартный успешный статус Nest мог быть добавлен автоматически — не оставляем дубликат с пустым описанием.
        for (const code of Object.keys(responses)) {
          if (code.startsWith('2') && ![spec.status, ...(spec.alsoStatus ?? []).map((a) => a.status)].map(String).includes(code) && !responses[code].content) delete responses[code];
        }
      } else if (!hasDocumentedSuccess) {
        unmapped.push(key);
      }

      const secured = Array.isArray(operation.security) && operation.security.length > 0;
      const hasPathParams = (operation.parameters ?? []).some((p) => p.in === 'path');
      const hasBody = Boolean(operation.requestBody);
      const mutating = method !== 'get';
      const errors: Record<string, string> = {};
      if (hasBody) errors['422'] = 'VALIDATION_FAILED — поля не прошли проверку (details.fields); 400 MALFORMED_JSON — тело не является JSON';
      if (hasPathParams) {
        errors['400'] = 'INVALID_ID — идентификатор в пути имеет неверный формат';
        errors['404'] = 'Объект не найден или недоступен (одинаково для чужого и несуществующего)';
      }
      if (secured) {
        errors['401'] = 'UNAUTHENTICATED — нет действующей сессии';
        errors['403'] = 'FORBIDDEN_ROLE | EMAIL_NOT_VERIFIED' + (mutating ? ' | CSRF_TOKEN_INVALID | CSRF_ORIGIN_MISMATCH' : '');
      } else if (mutating) {
        errors['403'] = 'CSRF_TOKEN_INVALID | CSRF_ORIGIN_MISMATCH — изменяющий запрос без CSRF-токена или с чужим Origin';
      }
      if (!secured && mutating) errors['429'] = 'RATE_LIMITED — ограничение частоты (заголовок Retry-After)';
      for (const [code, text] of Object.entries(errors)) {
        const existing = responses[code];
        responses[code] = {
          description: existing?.description ? `${existing.description}. ${text}` : text,
          content: { 'application/json': { schema: errorSchema } },
        };
      }
      for (const code of Object.keys(responses)) {
        if (!code.startsWith('2') && !responses[code].content) responses[code].content = { 'application/json': { schema: errorSchema } };
      }
    }
  }
  const unused = Object.keys(RESPONSES).filter((key) => !used.has(key));
  return { unmapped, unused };
}
