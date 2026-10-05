import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, opt, text } from '../helpers';

/**
 * M1. Утечки данных при подготовке и валидации.
 * Junior — явные утечки: масштабирование до разбиения, признаки из будущего, целевая переменная в признаках.
 * Middle — target encoding, оверсэмплинг до разбиения, пересечение групп; порядок шагов корректного пайплайна.
 * Senior — утечки в коде scikit-learn (cross_val_score на заранее преобразованных данных, отбор признаков вне фолдов);
 *          направление смещения оценки.
 */

interface Step {
  key: string;
  label: string;
  leak: boolean;
  grades: GradeCode[];
}

const DOMAINS = [
  { task: 'прогноз дефолта по кредиту в следующем месяце', future: 'число дней просрочки в следующем месяце', id: 'client_id', target: 'default' },
  { task: 'прогноз оттока абонентов', future: 'дата расторжения договора', id: 'subscriber_id', target: 'churn' },
  { task: 'прогноз повторной покупки в течение 30 дней', future: 'сумма покупок за следующие 30 дней', id: 'customer_id', target: 'repeat' },
  { task: 'прогноз отмены бронирования', future: 'статус возврата денег по брони', id: 'booking_id', target: 'cancelled' },
];

const STEPS: Step[] = [
  { key: 'scaler-all', label: 'StandardScaler обучается на всём датасете, затем данные делятся на train/test', leak: true, grades: ['JUNIOR', 'MIDDLE'] },
  { key: 'future-feature', label: 'В признаки включено «{future}»', leak: true, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'] },
  { key: 'target-copy', label: 'Признак «{target}_flag» скопирован из целевой переменной для удобства анализа', leak: true, grades: ['JUNIOR'] },
  { key: 'corr-select-all', label: 'Признаки отобраны по корреляции с целевой переменной на всём датасете до разбиения', leak: true, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'] },
  { key: 'imputer-train', label: 'SimpleImputer обучается только на train и применяется к test', leak: false, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'] },
  { key: 'log-transform', label: 'Признак income логарифмируется: np.log1p(income) (без обучаемых параметров)', leak: false, grades: ['JUNIOR', 'MIDDLE'] },
  { key: 'dedupe-before', label: 'Точные дубликаты строк удаляются до разбиения', leak: false, grades: ['JUNIOR', 'MIDDLE'] },
  { key: 'ohe-pipeline', label: 'OneHotEncoder(handle_unknown="ignore") внутри Pipeline, обучаемого на train', leak: false, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'] },
  { key: 'target-encoding-all', label: 'Target encoding города посчитан по всем строкам до разбиения', leak: true, grades: ['MIDDLE', 'SENIOR'] },
  { key: 'smote-before', label: 'Оверсэмплинг SMOTE применён ко всему датасету до разбиения', leak: true, grades: ['MIDDLE', 'SENIOR'] },
  { key: 'random-split-groups', label: 'Случайное разбиение строк, хотя у одного {id} много строк', leak: true, grades: ['MIDDLE', 'SENIOR'] },
  { key: 'group-kfold', label: 'Разбиение GroupKFold по {id}', leak: false, grades: ['MIDDLE', 'SENIOR'] },
  { key: 'pca-in-pipeline', label: 'PCA внутри Pipeline, который передаётся в cross_val_score', leak: false, grades: ['MIDDLE', 'SENIOR'] },
  { key: 'rolling-centered', label: 'Скользящее среднее по 7 дням с center=True (окно включает будущие дни)', leak: true, grades: ['SENIOR'] },
  { key: 'rolling-past', label: 'Скользящее среднее по 7 предыдущим дням: shift(1).rolling(7)', leak: false, grades: ['SENIOR'] },
];

const SNIPPETS = [
  {
    key: 'cv-prescaled',
    leak: true,
    code: 'X_scaled = StandardScaler().fit_transform(X)\nscores = cross_val_score(LogisticRegression(), X_scaled, y, cv=5)',
  },
  {
    key: 'cv-pipeline',
    leak: false,
    code: 'pipe = make_pipeline(StandardScaler(), LogisticRegression())\nscores = cross_val_score(pipe, X, y, cv=5)',
  },
  {
    key: 'select-before-cv',
    leak: true,
    code: 'X_sel = SelectKBest(f_classif, k=20).fit_transform(X, y)\nscores = cross_val_score(GradientBoostingClassifier(), X_sel, y, cv=5)',
  },
  {
    key: 'select-in-pipeline',
    leak: false,
    code: 'pipe = make_pipeline(SelectKBest(f_classif, k=20), GradientBoostingClassifier())\nscores = cross_val_score(pipe, X, y, cv=5)',
  },
  {
    key: 'impute-train-only',
    leak: false,
    code: 'imp = SimpleImputer(strategy="median").fit(X_train)\nX_test_f = imp.transform(X_test)',
  },
  {
    key: 'te-full',
    leak: true,
    code: 'df["city_te"] = df.groupby("city")["target"].transform("mean")\nX_train, X_test = train_test_split(df, test_size=0.2)',
  },
];

interface Params {
  domain: number;
  steps: string[];
  snippets?: string[];
}

const fill = (label: string, d: (typeof DOMAINS)[number]) => label.replace('{future}', d.future).replace('{target}', d.target).replace('{id}', d.id);

export const leakageFamily: FamilyDefinition<Params> = {
  id: 'ml.leakage',
  version: 1,
  specialization: 'ML_ENGINEER',
  group: 'ML_DATA',
  title: 'Утечки данных',
  description: 'Поиск утечек целевой информации и информации из test при подготовке данных и валидации.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['data-preparation', 'scikit-learn', 'pandas', 'python'],
  gradeNotes: {
    JUNIOR: 'Явные утечки: обучение преобразований на всех данных, признаки из будущего, копия целевой переменной.',
    MIDDLE: 'Target encoding и SMOTE до разбиения, пересечение групп; порядок шагов корректного пайплайна.',
    SENIOR: 'Утечки в коде scikit-learn и pandas вне фолдов кросс-валидации, направление смещения оценки.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    const pool = STEPS.filter((s) => s.grades.includes(grade));
    let steps: Step[];
    do steps = rng.sample(pool, grade === 'JUNIOR' ? 5 : 6);
    while (steps.filter((s) => s.leak).length < 2 || steps.every((s) => s.leak));
    const params: Params = { domain: rng.int(0, DOMAINS.length - 1), steps: steps.map((s) => s.key).sort() };
    if (grade === 'SENIOR') {
      let snippets: typeof SNIPPETS;
      do snippets = rng.sample(SNIPPETS, 4);
      while (!snippets.some((s) => s.leak) || snippets.every((s) => s.leak));
      params.snippets = snippets.map((s) => s.key).sort();
    }
    return params;
  },
  complexity(params) {
    return params.steps.length + (params.snippets?.length ?? 0);
  },
  build(params, grade) {
    const d = DOMAINS[params.domain];
    const steps = params.steps.map((key) => STEPS.find((s) => s.key === key)!);
    const parts: AuthoredPart[] = [
      {
        id: 'p1',
        format: 'MULTI_SELECT',
        prompt: 'Какие шаги приводят к утечке данных (оценка качества на test станет нечестной)?',
        options: steps.map((s) => opt(s.key, fill(s.label, d))),
        correct: steps.filter((s) => s.leak).map((s) => s.key),
        skillTags: grade === 'JUNIOR' ? ['data-preparation'] : ['data-preparation', 'scikit-learn'],
      },
    ];
    if (grade === 'JUNIOR') {
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: 'Как правильно применить StandardScaler при разбиении train/test?',
        options: [
          opt('fit-train', 'fit на train, затем transform для train и для test'),
          opt('fit-all', 'fit_transform на всём датасете, затем разбиение'),
          opt('fit-each', 'fit_transform отдельно на train и отдельно на test'),
          opt('fit-test', 'fit на test, затем transform для train'),
        ],
        correct: 'fit-train',
        skillTags: ['scikit-learn', 'data-preparation'],
      });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: `Какой фрагмент pandas готовит признак без утечки для задачи «${d.task}»?`,
        options: [
          opt('past', "df['spend_prev_30d'] = df.groupby('" + d.id + "')['spend'].shift(1).rolling(30, min_periods=1).sum()"),
          opt('future', "df['spend_next_30d'] = df.groupby('" + d.id + "')['spend'].shift(-30)"),
          opt('target-mean', "df['target_mean'] = df['" + d.target + "'].mean()"),
          opt('row-target', "df['" + d.target + "_copy'] = df['" + d.target + "']"),
        ],
        correct: 'past',
        skillTags: ['pandas', 'python'],
      });
      return { title: `Утечки: ${d.task}`, context: [text(`Команда готовит данные для задачи «${d.task}». План подготовки:`)], parts };
    }
    if (grade === 'MIDDLE') {
      parts.push({
        id: 'p2',
        format: 'ORDERING',
        prompt: 'Расположите шаги корректного процесса оценки модели по порядку.',
        items: [
          opt('split', 'Разделить данные на train и test (с учётом групп и времени)'),
          opt('fit-prep', 'Обучить преобразования (импутация, кодирование, масштабирование) на train'),
          opt('transform', 'Применить обученные преобразования к train и test'),
          opt('fit-model', 'Обучить модель на преобразованном train'),
          opt('evaluate', 'Один раз оценить модель на test'),
        ],
        correct: ['split', 'fit-prep', 'transform', 'fit-model', 'evaluate'],
        skillTags: ['data-preparation', 'scikit-learn'],
      });
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: `В данных несколько строк на каждый ${d.id}. Как разбить данные, чтобы избежать утечки?`,
        options: [
          opt('group', `GroupShuffleSplit / GroupKFold по ${d.id}`),
          opt('random', 'train_test_split(shuffle=True)'),
          opt('stratify', `train_test_split(stratify=${d.target})`),
          opt('dedupe', `Оставить только первую строку каждого ${d.id} в train`),
        ],
        correct: 'group',
        skillTags: ['scikit-learn', 'python'],
      });
      parts.push({
        id: 'p4',
        format: 'SINGLE_CHOICE',
        prompt: 'Какой код pandas считает target encoding города без утечки?',
        options: [
          opt('train-map', "te = train.groupby('city')['target'].mean(); train['city_te'] = train['city'].map(te); test['city_te'] = test['city'].map(te)"),
          opt('all-rows', "df['city_te'] = df.groupby('city')['target'].transform('mean')  # затем train_test_split"),
          opt('test-own', "test['city_te'] = test.groupby('city')['target'].transform('mean')"),
          opt('target-copy', "train['city_te'] = train['target']"),
        ],
        correct: 'train-map',
        skillTags: ['pandas', 'data-preparation'],
      });
      return { title: `Утечки: ${d.task}`, context: [text(`Команда готовит данные для задачи «${d.task}». В пайплайне есть шаги:`)], parts };
    }
    const snippets = params.snippets!.map((key) => SNIPPETS.find((s) => s.key === key)!);
    parts.push({
      id: 'p2',
      format: 'MULTI_SELECT',
      prompt: 'Какие фрагменты кода дают завышенную (утёкшую) оценку качества?',
      options: snippets.map((s, i) => opt(s.key, `Фрагмент ${String.fromCharCode(65 + i)}`)),
      correct: snippets.filter((s) => s.leak).map((s) => s.key),
      skillTags: ['scikit-learn', 'pandas', 'python'],
    });
    parts.push({
      id: 'p3',
      format: 'SINGLE_CHOICE',
      prompt: 'Как утечка через отбор признаков или target encoding на всех данных обычно влияет на оценку в кросс-валидации?',
      options: [
        opt('optimistic', 'Оценка становится завышенной (слишком оптимистичной)'),
        opt('pessimistic', 'Оценка становится заниженной'),
        opt('variance', 'Меняется только разброс между фолдами, среднее не смещается'),
        opt('none', 'Не влияет, если фолдов больше трёх'),
      ],
      correct: 'optimistic',
      skillTags: ['data-preparation'],
    });
    return {
      title: `Утечки в коде: ${d.task}`,
      context: [
        text(`Задача: «${d.task}». План подготовки содержит шаги (см. часть 1). Также проверьте фрагменты кода scikit-learn / pandas:`),
        ...snippets.map((s, i) => code('python', `# Фрагмент ${String.fromCharCode(65 + i)}\n${s.code}`)),
      ],
      parts,
    };
  },
};
