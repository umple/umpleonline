/**
 * React hook that runs an Umple AI chat.
 * AgentPanel calls this. Messages stream from the provider and tool calls edit the editor through tools.ts.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Chat, useChat } from '@ai-sdk/react'
import {
  DirectChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type InferUITools,
  type UIMessage,
} from 'ai'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useSessionStore, type ChatMessage } from '@/stores/sessionStore'
import { useEphemeralStore } from '@/stores/ephemeralStore'
import { createAgent } from './agent'
import { agentTools } from './tools'

type AgentUIMessage = UIMessage<unknown, never, InferUITools<typeof agentTools>>
type Agent = Awaited<ReturnType<typeof createAgent>>

/**
 * Hook that connects the AI agent to the chat UI.
 * Creates a ToolLoopAgent with DirectChatTransport (in-process, no HTTP).
 *
 * Provider SDKs are dynamically imported — only the selected provider's
 * code is loaded, and agent creation is async as a result. The agent is
 * stored in state, then the transport is derived synchronously. The chat
 * instance must be recreated when transport changes or useChat keeps the
 * initial default HTTP transport to `/api/chat`.
 *
 * DirectChatTransport cannot handle the SDK's built-in approval→execute
 * flow (it converts approval responses but never executes the tool).
 * So we execute approved tools manually and inject results via addToolOutput.
 */
export function useAgent() {
  const provider = usePreferencesStore((state) => state.activeProvider)
  const { model, apiKey } = usePreferencesStore((state) => state.configs[state.activeProvider])
  const clearDiffPreview = useEphemeralStore((state) => state.clearDiffPreview)

  const [agent, setAgent] = useState<Agent | null>(null)

  useEffect(() => {
    if (!apiKey.trim() || !model.trim()) {
      setAgent(null)
      return
    }

    let cancelled = false
    createAgent(provider, model, apiKey).then((a) => {
      if (!cancelled) setAgent(a)
    })

    return () => {
      cancelled = true
    }
  }, [provider, model, apiKey])

  // Derive transport synchronously so DirectChatTransport preserves the
  // agent's tool generics — useState would erase them.
  const transport = useMemo(
    () => (agent ? new DirectChatTransport({ agent }) : undefined),
    [agent],
  )

  /**
   * Guard flag — only allow auto-resubmit right after we manually
   * inject a tool result. Prevents infinite loops when the SDK also
   * checks sendAutomaticallyWhen after every stream completion.
   */
  const pendingExec = useRef(false)
  const chat = useMemo(
    () =>
      new Chat<AgentUIMessage>({
        transport,
        sendAutomaticallyWhen: ({ messages }) => {
          if (!pendingExec.current) return false
          pendingExec.current = false

          return (
            lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
            lastAssistantMessageIsCompleteWithApprovalResponses({ messages })
          )
        },
      }),
    [transport],
  )

  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    setMessages,
    addToolOutput,
    addToolApprovalResponse,
  } = useChat<AgentUIMessage>({ chat, experimental_throttle: 16 })

  // Restore chat history from session store whenever the chat instance is recreated
  const restoredChatRef = useRef<typeof chat | null>(null)
  useEffect(() => {
    if (restoredChatRef.current === chat) return
    restoredChatRef.current = chat
    const saved = useSessionStore.getState().chatMessages
    if (saved.length > 0) {
      setMessages(saved as AgentUIMessage[])
    }
  }, [chat, setMessages])

  // Sync messages to session store on change
  useEffect(() => {
    const serializable: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: '',
      parts: m.parts as unknown[],
    }))
    useSessionStore.getState().setChatMessages(serializable)
  }, [messages])

  const send = useCallback(
    (text: string) => {
      if (!transport) return
      sendMessage({ text })
    },
    [transport, sendMessage],
  )

  const reset = useCallback(() => {
    clearDiffPreview()
    setMessages([])
    useSessionStore.getState().setChatMessages([])
  }, [clearDiffPreview, setMessages])

  /** Approve a tool call — execute the tool ourselves, then inject the result. */
  const approveToolCall = useCallback(
    async (
      approvalId: string,
      toolCallId: string,
      toolName: string,
      input: any,
    ) => {
      const tool = (agentTools as Record<string, any>)[toolName]
      if (!tool?.execute) return

      try {
        clearDiffPreview(toolCallId)
        await addToolApprovalResponse({ id: approvalId, approved: true })
        const result = await tool.execute(input, { messages: [], toolCallId })
        pendingExec.current = true
        addToolOutput({ tool: toolName as any, toolCallId, output: result })
      } catch (err) {
        pendingExec.current = true
        addToolOutput({
          tool: toolName as any,
          toolCallId,
          state: 'output-error',
          errorText: String(err),
        })
      }
    },
    [addToolApprovalResponse, addToolOutput, clearDiffPreview],
  )

  /** Reject a tool call — inject an error so the agent can adjust. */
  const rejectToolCall = useCallback(
    (approvalId: string, _toolCallId: string, _toolName: string, reason?: string) => {
      clearDiffPreview(_toolCallId)
      pendingExec.current = true
      addToolApprovalResponse({
        id: approvalId,
        approved: false,
        reason: reason ?? 'User rejected this change',
      })
    },
    [addToolApprovalResponse, clearDiffPreview],
  )

  return {
    messages,
    status,
    error: error ?? undefined,
    send,
    stop,
    reset,
    approveToolCall,
    rejectToolCall,
  }
}
