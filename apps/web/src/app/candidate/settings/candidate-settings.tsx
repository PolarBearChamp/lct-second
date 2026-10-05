'use client';

import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNELS,
  type CandidateProfileView,
  type ContactChannel,
  type OwnProfileResponse,
  type ProfileUpdate,
} from '@fsp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CandidateCard } from '@/components/profile/candidate-card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, ChoiceGroup } from '@/components/ui/field';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import { queryKeys, useOwnProfile } from '@/lib/queries';
import { ContactAccessSection } from './contact-access-section';
import { FspSection } from './fsp-section';
import { PdfSection } from './pdf-section';

export function CandidateSettings() {
  const profile = useOwnProfile();
  if (profile.isPending) return <LoadingBlock lines={6} />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  return (
    <>
      <PageHeader
        title="Приватность и ФСП"
        description="Вы управляете тем, видят ли вас работодатели и какие контакты раскрываются после принятия приглашения."
      />
      <div className="space-y-6">
        <PublicationSection data={profile.data} />
        <ChannelsSection data={profile.data} />
        <ContactAccessSection />
        <FspSection />
        <PdfSection />
        <PreviewSection />
      </div>
    </>
  );
}

function useProfilePatch() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: (update: ProfileUpdate) => api.patch<OwnProfileResponse>('/candidate/profile', update),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.ownProfile, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'preview'] });
      notify('Настройки сохранены');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
}

function PublicationSection({ data }: { data: OwnProfileResponse }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const patch = useProfilePatch();
  const [consentChecked, setConsentChecked] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const consent = data.consents.profilePublication;
  const p = data.profile;

  const consentMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const updated = await api.put<OwnProfileResponse>('/candidate/consents', { profilePublication: value });
      if (value) return api.patch<OwnProfileResponse>('/candidate/profile', { isDiscoverable: true });
      return updated;
    },
    onSuccess: (updated, value) => {
      queryClient.setQueryData(queryKeys.ownProfile, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      if (!value) notify('Согласие отозвано, профиль скрыт из поиска');
      else if (updated.discoverability.discoverable) notify('Согласие дано, профиль опубликован');
      else notify('Согласие дано, но профиль пока не виден работодателям: устраните замечания в блоке «Публикация профиля»', 'info');
      setConfirmWithdraw(false);
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  return (
    <Card id="publication">
      <CardHeader
        title="Публикация профиля"
        description="Работодатели видят только обезличенную карточку: без ФИО, контактов, ссылок и свободного текста."
      />
      <div className="space-y-4">
        {data.discoverability.discoverable ? (
          <Alert tone="success" title="Профиль виден работодателям в поиске" />
        ) : (
          <Alert tone="warning" title="Профиль не виден в поиске">
            <ul className="mt-1 list-disc pl-5">
              {data.discoverability.issues.map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          </Alert>
        )}

        {consent.active ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
            <div>
              <div className="font-medium">Согласие на публикацию дано</div>
              <div className="text-sm text-muted">
                {formatDateTime(consent.acceptedAt)} · версия {consent.policyVersion}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setConfirmWithdraw(true)}>
              Отозвать согласие
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
            <Checkbox
              checked={consentChecked}
              onChange={(event) => setConsentChecked(event.target.checked)}
              label="Я согласен(на) на публикацию обезличенного профиля работодателям платформы"
              description={`Версия документа: ${consent.currentPolicyVersion}. Согласие можно отозвать в любой момент.`}
            />
            {consent.withdrawnAt ? <p className="mt-2 text-sm text-muted">Предыдущее согласие отозвано {formatDateTime(consent.withdrawnAt)}.</p> : null}
            <Button className="mt-3" disabled={!consentChecked} loading={consentMutation.isPending} onClick={() => consentMutation.mutate(true)}>
              Дать согласие и опубликовать
            </Button>
          </div>
        )}

        {consent.active ? (
          <Checkbox
            checked={p.isDiscoverable}
            disabled={patch.isPending}
            onChange={(event) => patch.mutate({ isDiscoverable: event.target.checked })}
            label="Показывать профиль в поиске работодателей"
            description="Скрытие убирает вас из новых подборок, но не отзывает уже выданные доступы к контактам — для этого есть отдельное действие ниже."
          />
        ) : null}

        <ChoiceGroup
          legend="Готовность рассматривать предложения"
          name="availability"
          value={[p.availability]}
          onChange={(next) => patch.mutate({ availability: next[0] as 'ACTIVE' | 'PAUSED' })}
          options={[
            { value: 'ACTIVE', label: 'Рассматриваю предложения' },
            { value: 'PAUSED', label: 'Поиск на паузе', description: 'Вы не попадаете в новые подборки' },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox
            checked={p.showSalaryToEmployers}
            onChange={(event) => patch.mutate({ showSalaryToEmployers: event.target.checked })}
            label="Показывать зарплатные ожидания"
            description="Если скрыть, ожидания не показываются работодателям и не используются как фильтр подбора."
          />
          <Checkbox
            checked={p.showFspToEmployers}
            onChange={(event) => patch.mutate({ showFspToEmployers: event.target.checked })}
            label="Показывать достижения ФСП"
            description="Обезличенно: тип, уровень, место, год."
          />
        </div>
      </div>
      <ConfirmDialog
        open={confirmWithdraw}
        title="Отозвать согласие на публикацию?"
        tone="danger"
        confirmLabel="Отозвать"
        loading={consentMutation.isPending}
        onClose={() => setConfirmWithdraw(false)}
        onConfirm={() => consentMutation.mutate(false)}
      >
        <p>Профиль сразу исчезнет из поиска и новых подборок. Уже выданные доступы к контактам отзываются отдельно в разделе ниже.</p>
      </ConfirmDialog>
    </Card>
  );
}

function ChannelsSection({ data }: { data: OwnProfileResponse }) {
  const patch = useProfilePatch();
  const p = data.profile;
  const values: Record<ContactChannel, string | null> = { EMAIL: p.contactEmail, PHONE: p.phone, MESSENGER: p.messenger };
  return (
    <Card id="channels">
      <CardHeader
        title="Каналы связи для раскрытия"
        description="Эти контакты получит только компания, чьё приглашение вы примете. Нужен хотя бы один заполненный канал."
      />
      <ChoiceGroup
        legend="Какие каналы раскрывать после принятия приглашения"
        name="channels"
        multiple
        columns={3}
        value={p.disclosureChannels}
        onChange={(next) => patch.mutate({ disclosureChannels: next as ContactChannel[] })}
        options={CONTACT_CHANNELS.map((channel) => ({
          value: channel,
          label: CONTACT_CHANNEL_LABELS[channel],
          description: values[channel] ? values[channel]! : 'не заполнено в профиле',
        }))}
      />
      {p.disclosureChannels.some((c) => !values[c]) ? (
        <Alert tone="warning" className="mt-3">
          Некоторые выбранные каналы не заполнены — заполните их в профиле, иначе они не будут раскрыты.
        </Alert>
      ) : null}
      <p className="mt-3 text-sm text-muted">
        Сейчас будет раскрыто:{' '}
        {p.disclosureChannels.filter((c) => values[c]).map((c) => <Badge key={c} className="mr-1">{CONTACT_CHANNEL_LABELS[c]}</Badge>)}
        {p.disclosureChannels.filter((c) => values[c]).length === 0 ? 'ничего' : null}
      </p>
    </Card>
  );
}

function PreviewSection() {
  const preview = useQuery({ queryKey: ['candidate', 'preview'], queryFn: () => api.get<CandidateProfileView>('/candidate/profile/preview') });
  return (
    <section id="preview" aria-labelledby="preview-title" className="space-y-3">
      <h2 id="preview-title" className="text-lg font-bold">
        Как вас видит работодатель без доступа к контактам
      </h2>
      {preview.isPending ? <LoadingBlock /> : preview.isError ? <ErrorState error={preview.error} /> : <CandidateCard view={preview.data} />}
      <p className="text-xs text-muted">
        Обезличивание снижает прямую идентифицируемость, но не гарантирует анонимность по совокупности признаков (город, стек, достижения).
      </p>
    </section>
  );
}
