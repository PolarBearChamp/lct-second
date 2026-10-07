'use client';

import type { CandidateTaskView, CandidateTasksResponse, EmployerTaskView, TaskSubmissionsResponse } from '@fsp/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';

export const taskKeys = {
  employerList: (status: string) => ['employer', 'tasks', status] as const,
  employerAll: ['employer', 'tasks'] as const,
  employerOne: (id: string) => ['employer', 'task', id] as const,
  submissions: (id: string, pendingOnly: boolean, page: number) => ['employer', 'task-submissions', id, pendingOnly, page] as const,
  submissionsAll: ['employer', 'task-submissions'] as const,
  overview: ['candidate', 'tasks'] as const,
  one: (id: string) => ['candidate', 'task', id] as const,
};

export const useEmployerTasks = (status: string, enabled = true) =>
  useQuery({
    queryKey: taskKeys.employerList(status),
    queryFn: () => api.get<EmployerTaskView[]>(`/employer/tasks${status !== 'ALL' ? `?status=${status}` : ''}`),
    enabled,
    refetchInterval: 30_000,
  });

export const useEmployerTask = (id: string) => useQuery({ queryKey: taskKeys.employerOne(id), queryFn: () => api.get<EmployerTaskView>(`/employer/tasks/${id}`) });

export const useTaskSubmissions = (id: string, pendingOnly: boolean, page: number, enabled = true) =>
  useQuery({
    queryKey: taskKeys.submissions(id, pendingOnly, page),
    queryFn: () => api.get<TaskSubmissionsResponse>(`/employer/tasks/${id}/submissions?page=${page}&pageSize=20${pendingOnly ? '&pendingOnly=true' : ''}`),
    enabled,
    refetchInterval: 30_000,
  });

/** Открытие раздела может предложить новое задание (не чаще раза в неделю), поэтому это не «чистый» GET — кэш недолговечен. */
export const useCandidateTasks = () => useQuery({ queryKey: taskKeys.overview, queryFn: () => api.get<CandidateTasksResponse>('/candidate/tasks'), staleTime: 0 });

export const useCandidateTask = (id: string, enabled = true) =>
  useQuery({ queryKey: taskKeys.one(id), queryFn: () => api.get<CandidateTaskView>(`/candidate/tasks/${id}`), enabled });
