/**
 * Browser client for the teaching-task routes.
 * The task sheet and useTaskRoute call taskApi. Responses match the types in types.ts.
 */

import { request } from './client'
import type {
  TaskView, CreateTaskRequest, UpdateTaskRequest,
  ResponseView, ResponseSummary,
} from './types'

export const taskApi = {
  createTask(req: CreateTaskRequest): Promise<TaskView> {
    return request('/tasks', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  },

  getTask(name: string): Promise<TaskView> {
    return request(`/tasks/${encodeURIComponent(name)}`)
  },

  updateTask(name: string, req: UpdateTaskRequest): Promise<TaskView> {
    return request(`/tasks/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    })
  },

  createResponse(taskName: string): Promise<ResponseView> {
    return request(`/tasks/${encodeURIComponent(taskName)}/responses`, {
      method: 'POST',
    })
  },

  getResponse(id: string): Promise<ResponseView> {
    return request(`/tasks/responses/${encodeURIComponent(id)}`)
  },

  submitResponse(id: string): Promise<ResponseView> {
    return request(`/tasks/responses/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
    })
  },

  listResponses(taskName: string): Promise<ResponseSummary[]> {
    return request(`/tasks/${encodeURIComponent(taskName)}/responses`)
  },
}
