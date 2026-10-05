'use client';

import type {
  AttemptResult,
  AttemptSummary,
  AttemptView,
  EligibilityResponse,
  OwnProfileResponse,
  QualificationsResponse,
  ReferenceCatalog,
  SkillInfo,
  SpecializationInfo,
  SurveyDefinition,
} from '@fsp/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';

const STATIC = { staleTime: 60 * 60_000, refetchOnWindowFocus: false } as const;

export const queryKeys = {
  me: ['me'] as const,
  specializations: ['catalog', 'specializations'] as const,
  skills: ['catalog', 'skills'] as const,
  reference: ['catalog', 'reference'] as const,
  survey: ['catalog', 'survey'] as const,
  ownProfile: ['candidate', 'profile'] as const,
  eligibility: (spec: string) => ['candidate', 'eligibility', spec] as const,
  attempts: ['candidate', 'attempts'] as const,
  attempt: (id: string) => ['candidate', 'attempt', id] as const,
  result: (id: string) => ['candidate', 'result', id] as const,
  qualifications: ['candidate', 'qualifications'] as const,
};

export const useSpecializations = () =>
  useQuery({ queryKey: queryKeys.specializations, queryFn: () => api.get<SpecializationInfo[]>('/catalogs/specializations'), ...STATIC });
export const useSkills = () => useQuery({ queryKey: queryKeys.skills, queryFn: () => api.get<SkillInfo[]>('/catalogs/skills'), ...STATIC });
export const useReference = () =>
  useQuery({ queryKey: queryKeys.reference, queryFn: () => api.get<ReferenceCatalog>('/catalogs/reference'), ...STATIC });
export const useSurveyDefinition = () =>
  useQuery({ queryKey: queryKeys.survey, queryFn: () => api.get<SurveyDefinition>('/catalogs/survey'), ...STATIC });

export const useOwnProfile = () =>
  useQuery({ queryKey: queryKeys.ownProfile, queryFn: () => api.get<OwnProfileResponse>('/candidate/profile') });

export const useEligibility = (specialization: string | null | undefined) =>
  useQuery({
    queryKey: queryKeys.eligibility(specialization ?? 'none'),
    queryFn: () => api.get<EligibilityResponse>(`/candidate/assessments/eligibility?specialization=${specialization}`),
    enabled: Boolean(specialization),
  });

export const useAttempts = () =>
  useQuery({ queryKey: queryKeys.attempts, queryFn: () => api.get<AttemptSummary[]>('/candidate/assessments') });

export const useAttempt = (id: string) =>
  useQuery({ queryKey: queryKeys.attempt(id), queryFn: () => api.get<AttemptView>(`/candidate/assessments/${id}`), refetchOnWindowFocus: false });

export const useAttemptResult = (id: string) =>
  useQuery({ queryKey: queryKeys.result(id), queryFn: () => api.get<AttemptResult>(`/candidate/assessments/${id}/result`) });

export const useQualifications = () =>
  useQuery({ queryKey: queryKeys.qualifications, queryFn: () => api.get<QualificationsResponse>('/candidate/qualifications') });
