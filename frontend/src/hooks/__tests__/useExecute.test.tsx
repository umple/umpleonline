// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useExecute } from '../useExecute'

const initialSession = useSessionStore.getState()
const initialEphemeral = useEphemeralStore.getState()

describe('useExecute', () => {
  beforeEach(() => {
    useSessionStore.setState({
      ...initialSession,
      modelId: null,
      generateTargetId: 'classDiagram',
      code: 'use Helper.ump; class Main {}',
      activeTabId: 'main',
      tabs: [
        { ...initialSession.tabs[0]!, id: 'main', name: 'Main.ump', code: 'old active code' },
        { ...initialSession.tabs[0]!, id: 'helper', name: 'Helper.ump', code: 'class Helper {}' },
      ],
    })
    useEphemeralStore.setState({ ...initialEphemeral, rightPanelView: 'diagram', generatedLanguage: 'Python' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('executes Java directly from a diagram with all current tabs and retains the new model ID', async () => {
    const execute = vi.spyOn(api, 'execute').mockResolvedValue({ output: 'Hello', modelId: 'new-model' })
    const { result } = renderHook(() => useExecute())
    await act(() => result.current.execute())
    expect(execute).toHaveBeenCalledWith({
      code: 'use Helper.ump; class Main {}',
      language: 'Java',
      activeTabId: 'main',
      modelId: undefined,
      tabs: [
        { id: 'main', name: 'Main.ump', code: 'use Helper.ump; class Main {}' },
        { id: 'helper', name: 'Helper.ump', code: 'class Helper {}' },
      ],
    })
    expect(useSessionStore.getState().modelId).toBe('new-model')
    expect(useSessionStore.getState().generateTargetId).toBe('classDiagram')
    expect(useEphemeralStore.getState()).toMatchObject({ rightPanelView: 'diagram', outputView: 'panel', executionOutput: 'Hello', executing: false })
  })

  it.each(['Java', 'Python'])('executes a selected %s target', async (language) => {
    useSessionStore.setState({ generateTargetId: language })
    const execute = vi.spyOn(api, 'execute').mockResolvedValue({ output: 'Done', modelId: 'model' })
    const { result } = renderHook(() => useExecute())
    await act(() => result.current.execute())
    expect(execute.mock.calls[0]?.[0].language).toBe(language)
  })

  it('allows explicit Python execution without changing the visible diagram', async () => {
    const execute = vi.spyOn(api, 'execute').mockResolvedValue({ output: 'Python output', modelId: 'model' })
    useEphemeralStore.getState().setDiagramOnly(true)
    const { result } = renderHook(() => useExecute())
    await act(() => result.current.execute('Python'))
    expect(execute.mock.calls[0]?.[0].language).toBe('Python')
    expect(useEphemeralStore.getState()).toMatchObject({ rightPanelView: 'diagram', showEditor: true, diagramOnly: false, outputView: 'panel' })
  })

  it('reports failures and allows another execution', async () => {
    const execute = vi.spyOn(api, 'execute').mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValueOnce({ output: 'Recovered', modelId: 'model' })
    const { result } = renderHook(() => useExecute())
    await act(() => result.current.execute())
    expect(useEphemeralStore.getState()).toMatchObject({ executing: false, executionErrors: 'Service unavailable' })
    await act(() => result.current.execute())
    expect(execute).toHaveBeenCalledTimes(2)
    expect(useEphemeralStore.getState().executionOutput).toBe('Recovered')
  })
})
