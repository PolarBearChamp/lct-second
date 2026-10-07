'use client';

import type {
  ApplicationBase,
  CandidateApplicationDetail,
  CandidateVacancyDetail,
  CandidateVacancyItem,
  EmployerApplicationDetail,
  EmployerApplicationList,
  EmployerVacancyView,
  Paginated,
} from '@fsp/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';

export const vacancyKeys = {
  employerList: (status: string) => ['employer', 'vacancies', status] as const,
  employerAll: ['employer', 'vacancies'] as const,
  employerOne: (id: string) => ['employer', 'vacancy', id] as const,
  applications: (vacancyId: string, status: string, sort: string, page: number) => ['employer', 'vacancy-applications', vacancyId, status, sort, page] as const,
  applicationsAll: ['employer', 'vacancy-applications'] as const,
  employerApplication: (id: string) => ['employer', 'application', id] as const,
  candidateList: (query: string) => ['candidate', 'vacancies', query] as const,
  candidateOne: (id: string) => ['candidate', 'vacancy', id] as const,
  myApplications: (status: string) => ['candidate', 'applications', status] as const,
  myApplication: (id: string) => ['candidate', 'application', id] as const,
};

export const useEmployerVacancies = (status: string, enabled = true) =>
  useQuery({
    queryKey: vacancyKeys.employerList(status),
    queryFn: () => api.get<EmployerVacancyView[]>(`/employer/vacancies${status !== 'ALL' ? `?status=${status}` : ''}`),
    enabled,
    refetchInterval: 30_000,
  });

export const useEmployerVacancy = (id: string) =>
  useQuery({ queryKey: vacancyKeys.employerOne(id), queryFn: () => api.get<EmployerVacancyView>(`/employer/vacancies/${id}`), refetchInterval: 30_000 });

export const useVacancyApplications = (vacancyId: string, status: string, sort: string, page: number) =>
  useQuery({
    queryKey: vacancyKeys.applications(vacancyId, status, sort, page),
    queryFn: () =>
      api.get<EmployerApplicationList>(
        `/employer/vacancies/${vacancyId}/applications?page=${page}&pageSize=20&sort=${sort}${status !== 'ALL' ? `&status=${status}` : ''}`,
      ),
    refetchInterval: 30_000,
  });

export const useEmployerApplication = (id: string) =>
  useQuery({ queryKey: vacancyKeys.employerApplication(id), queryFn: () => api.get<EmployerApplicationDetail>(`/employer/applications/${id}`) });

export const useCandidateVacancies = (query: string) =>
  useQuery({ queryKey: vacancyKeys.candidateList(query), queryFn: () => api.get<Paginated<CandidateVacancyItem>>(`/candidate/vacancies?${query}`) });

export const useCandidateVacancy = (id: string) =>
  useQuery({ queryKey: vacancyKeys.candidateOne(id), queryFn: () => api.get<CandidateVacancyDetail>(`/candidate/vacancies/${id}`) });

export const useMyApplications = (status: string) =>
  useQuery({
    queryKey: vacancyKeys.myApplications(status),
    queryFn: () => api.get<Paginated<ApplicationBase>>(`/candidate/applications?pageSize=50${status === 'ACTIVE' ? '&status=ACTIVE' : ''}`),
    refetchInterval: 30_000,
  });

export const useMyApplication = (id: string) =>
  useQuery({ queryKey: vacancyKeys.myApplication(id), queryFn: () => api.get<CandidateApplicationDetail>(`/candidate/applications/${id}`), refetchInterval: 30_000 });
