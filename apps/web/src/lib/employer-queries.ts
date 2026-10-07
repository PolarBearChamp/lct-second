'use client';

import type {
  BookmarkItem,
  CompanyView,
  EmployerInvitationDetail,
  EmployerInvitationItem,
  HiringNeedView,
  Paginated,
  SelectionRunSummary,
  SelectionRunView,
} from '@fsp/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';

export const employerKeys = {
  company: ['employer', 'company'] as const,
  needs: ['employer', 'needs'] as const,
  need: (id: string) => ['employer', 'need', id] as const,
  selections: (needId: string) => ['employer', 'selections', needId] as const,
  selection: (id: string, page: number) => ['employer', 'selection', id, page] as const,
  bookmarks: ['employer', 'bookmarks'] as const,
  invitations: (status: string, page: number) => ['employer', 'invitations', status, page] as const,
  invitation: (id: string) => ['employer', 'invitation', id] as const,
};

export const useCompany = () => useQuery({ queryKey: employerKeys.company, queryFn: () => api.get<{ company: CompanyView | null }>('/employer/company') });
export const useNeeds = (enabled = true) =>
  useQuery({ queryKey: employerKeys.needs, queryFn: () => api.get<HiringNeedView[]>('/employer/needs'), enabled });
export const useNeed = (id: string, enabled = true) =>
  useQuery({ queryKey: employerKeys.need(id), queryFn: () => api.get<HiringNeedView>(`/employer/needs/${id}`), enabled });
export const useSelections = (needId: string) =>
  useQuery({ queryKey: employerKeys.selections(needId), queryFn: () => api.get<SelectionRunSummary[]>(`/employer/needs/${needId}/selections`) });
export const useSelection = (id: string, page: number) =>
  useQuery({ queryKey: employerKeys.selection(id, page), queryFn: () => api.get<SelectionRunView>(`/employer/selections/${id}?page=${page}&pageSize=20`) });
export const useBookmarks = () => useQuery({ queryKey: employerKeys.bookmarks, queryFn: () => api.get<BookmarkItem[]>('/employer/bookmarks') });
export const useEmployerInvitations = (status: string, page: number) =>
  useQuery({
    queryKey: employerKeys.invitations(status, page),
    queryFn: () => api.get<Paginated<EmployerInvitationItem>>(`/employer/invitations?page=${page}&pageSize=20${status !== 'ALL' ? `&status=${status}` : ''}`),
    refetchInterval: 30_000,
  });
export const useEmployerInvitation = (id: string) =>
  useQuery({ queryKey: employerKeys.invitation(id), queryFn: () => api.get<EmployerInvitationDetail>(`/employer/invitations/${id}`), refetchInterval: 30_000 });
