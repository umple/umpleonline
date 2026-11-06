/**
 * Loads a teaching task when the URL is /tasks/:name or a response id.
 * AppShell calls this on every page. A task name creates a response and redirects to it.
 */

import { useEffect, useRef } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/sessionStore'
import { useTaskStore } from '../stores/taskStore'
import { useEphemeralStore } from '../stores/ephemeralStore'
import { taskApi } from '../api/taskApi'
import type { ApiTab } from '../api/types'

/**
 * Detects task-related routes and loads data into stores.
 *
 * /tasks/:name         → creates a response, navigates to /tasks/responses/:id
 * /tasks/responses/:id → loads response + parent task into stores
 *
 * Called unconditionally in AppShell.
 */
export function useTaskRoute() {
  const taskMatch = useMatch('/tasks/:name')
  const responseMatch = useMatch('/tasks/responses/:id')
  const navigate = useNavigate()
  const loadedRef = useRef<string | null>(null)

  const taskName = taskMatch?.params.name
  const responseId = responseMatch?.params.id

  // /tasks/:name → create response and redirect
  useEffect(() => {
    if (!taskName) return
    // Don't match /tasks/new or /tasks/responses (those are other patterns)
    if (taskName === 'new' || taskName === 'responses') return

    const { setLoading, setError } = useTaskStore.getState()
    setLoading(true)

    taskApi.createResponse(taskName)
      .then((resp) => {
        navigate(`/tasks/responses/${resp.responseId}`, { replace: true })
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Task not found')
        setLoading(false)
      })
  }, [taskName, navigate])

  // /tasks/responses/:id → load response data
  useEffect(() => {
    if (!responseId || loadedRef.current === responseId) return
    loadedRef.current = responseId

    const { setLoading, setError, loadResponse, loadTask, reset } = useTaskStore.getState()
    reset()
    setLoading(true)

    async function load() {
      try {
        const resp = await taskApi.getResponse(responseId!)
        const task = await taskApi.getTask(resp.taskName)

        // Load model into session store
        if (resp.tabs && resp.tabs.length > 0) {
          const apiTabs: ApiTab[] = resp.tabs.map((t, i) => ({
            id: `tab-${i}`,
            name: t.name,
            code: t.code,
          }))
          useSessionStore.getState().restoreTabs(apiTabs, apiTabs[0].id)
        } else {
          useSessionStore.getState().setCode(resp.modelCode)
        }

        // Load task metadata
        loadTask(task)
        loadResponse(resp, task.instructions)

        // Set read-only if already submitted
        useEphemeralStore.getState().setReadOnly(!!resp.submittedAt)
      } catch (err) {
        useTaskStore.getState().setError(
          err instanceof Error ? err.message : 'Failed to load response',
        )
      } finally {
        useTaskStore.getState().setLoading(false)
      }
    }

    load()

    return () => {
      // Clean up read-only state when leaving task route
      useEphemeralStore.getState().setReadOnly(false)
    }
  }, [responseId])

  // Clean up task state when navigating away from task routes
  useEffect(() => {
    if (!taskName && !responseId && useTaskStore.getState().responseId) {
      useTaskStore.getState().reset()
      useEphemeralStore.getState().setReadOnly(false)
    }
  }, [taskName, responseId])
}
