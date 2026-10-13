/**
 * The teaching task and response loaded from the URL, and whether the task sheet is open.
 * useTaskRoute fills this in. TaskSheet and the sidebar section render it.
 */

import { create } from 'zustand'
import type { TaskView, ResponseView } from '../api/types'

type SheetMode = 'closed' | 'create' | 'manage'

interface TaskState {
  // Task metadata (populated when in response mode)
  taskName: string | null
  requestorName: string | null
  instructions: string | null
  completionURL: string | null
  isExperiment: boolean

  // Response state (populated when editing a response)
  responseId: string | null
  submittedAt: string | null

  // Loading
  loading: boolean
  error: string | null

  // Sheet UI
  sheetMode: SheetMode

  // Actions
  loadTask: (view: TaskView) => void
  loadResponse: (resp: ResponseView, instructions: string) => void
  setSubmitted: (submittedAt: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  openSheet: (mode: 'create' | 'manage') => void
  closeSheet: () => void
  reset: () => void
}

const initialState = {
  taskName: null,
  requestorName: null,
  instructions: null,
  completionURL: null,
  isExperiment: false,
  responseId: null,
  submittedAt: null,
  loading: false,
  error: null,
  sheetMode: 'closed' as SheetMode,
}

export const useTaskStore = create<TaskState>()((set) => ({
  ...initialState,

  loadTask: (view) => set({
    taskName: view.taskName,
    requestorName: view.requestorName,
    instructions: view.instructions,
    completionURL: view.completionURL ?? null,
    isExperiment: view.isExperiment,
  }),

  loadResponse: (resp, instructions) => set({
    taskName: resp.taskName,
    responseId: resp.responseId,
    submittedAt: resp.submittedAt ?? null,
    instructions,
  }),

  setSubmitted: (submittedAt) => set({ submittedAt }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  openSheet: (mode) => set({ sheetMode: mode }),
  closeSheet: () => set({ sheetMode: 'closed' }),
  reset: () => set(initialState),
}))
