import { LinkButton } from '@/components/ui/button';

const roles = [
  { role: 'CANDIDATE', title: 'Для кандидатов', description: 'Подтвердите навыки и получайте предложения. Контакты раскрываются только с вашего согласия.', action: 'Я ищу работу' },
  { role: 'EMPLOYER', title: 'Для работодателей', description: 'Найдите специалиста с проверенным грейдом и отправьте предложение с условиями и зарплатой.', action: 'Я ищу специалиста' },
] as const;

export function RoleActions() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {roles.map((item) => (
        <div key={item.role} className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{item.title}</h2>
          <p className="mb-5 mt-2 text-sm text-muted">{item.description}</p>
          <LinkButton href={`/register?role=${item.role}`} size="lg" variant={item.role === 'CANDIDATE' ? 'primary' : 'outline'} className="mt-auto w-full px-3">
            {item.action}
          </LinkButton>
        </div>
      ))}
    </div>
  );
}
