/**
 * Collaboration session: the room, whether the socket is up, and who else is here.
 * CollabButton writes it. useCollab reads it to open and close the WebSocket.
 */

import { create } from 'zustand'

export interface CollabUser {
  clientId: number
  name: string
  color: string
}

interface CollabState {
  isCollaborating: boolean
  roomId: string | null
  connected: boolean
  ready: boolean
  connectedUsers: CollabUser[]

  startCollab: (roomId: string) => void
  stopCollab: () => void
  setConnected: (v: boolean) => void
  setReady: (v: boolean) => void
  setConnectedUsers: (users: CollabUser[]) => void
}

export const useCollabStore = create<CollabState>()((set) => ({
  isCollaborating: false,
  roomId: null,
  connected: false,
  ready: false,
  connectedUsers: [],

  startCollab: (roomId) => set({
    isCollaborating: true,
    roomId,
    connected: false,
    ready: false,
    connectedUsers: [],
  }),
  stopCollab: () => set({
    isCollaborating: false,
    roomId: null,
    connected: false,
    ready: false,
    connectedUsers: [],
  }),
  setConnected: (connected) => set({ connected }),
  setReady: (ready) => set({ ready }),
  setConnectedUsers: (connectedUsers) => set({ connectedUsers }),
}))
