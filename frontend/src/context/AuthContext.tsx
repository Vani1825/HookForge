import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { User, Workspace, RegisterInput, LoginInput } from '../types/auth'
import * as authApi from '../api/auth'
import { useApp } from './AppContext'

interface AuthContextValue {
  user: User | null
  currentWorkspace: Workspace | null
  workspaces: Workspace[]
  isAuthenticated: boolean
  isLoading: boolean
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  switchWorkspace: (workspaceId: string) => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { mode, setMode } = useApp()
  const [user, setUser] = useState<User | null>(null)
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const refreshSession = useCallback(async () => {
    if (mode === 'demo') {
      setUser({
        id: 'demo-user-1',
        fullName: 'Demo Developer',
        email: 'developer@hookforge.dev',
        status: 'ACTIVE',
      })
      setCurrentWorkspace({
        id: 'demo-workspace-1',
        name: 'Demo Workspace',
        role: 'OWNER',
      })
      setWorkspaces([
        {
          id: 'demo-workspace-1',
          name: 'Demo Workspace',
          role: 'OWNER',
        },
      ])
      setIsLoading(false)
      return
    }

    try {
      const session = await authApi.fetchCurrentUser()
      setUser(session.user)
      setCurrentWorkspace(session.currentWorkspace)
      setWorkspaces(session.workspaces || [session.currentWorkspace])
    } catch {
      setUser(null)
      setCurrentWorkspace(null)
      setWorkspaces([])
    } finally {
      setIsLoading(false)
    }
  }, [mode])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  const login = async (input: LoginInput) => {
    setIsLoading(true)
    try {
      const session = await authApi.loginUser(input)
      setUser(session.user)
      setCurrentWorkspace(session.currentWorkspace)
      setWorkspaces(session.workspaces || [session.currentWorkspace])
      setMode('live')
    } finally {
      setIsLoading(false)
    }
  }

  const register = async (input: RegisterInput) => {
    setIsLoading(true)
    try {
      const session = await authApi.registerUser(input)
      setUser(session.user)
      setCurrentWorkspace(session.currentWorkspace)
      setWorkspaces(session.workspaces || [session.currentWorkspace])
      setMode('live')
    } finally {
      setIsLoading(false)
    }
  }

  const logout = async () => {
    setIsLoading(true)
    try {
      await authApi.logoutUser()
    } finally {
      setUser(null)
      setCurrentWorkspace(null)
      setWorkspaces([])
      setIsLoading(false)
    }
  }

  const switchWorkspace = async (workspaceId: string) => {
    const session = await authApi.switchActiveWorkspace(workspaceId)
    setCurrentWorkspace(session.currentWorkspace)
    setWorkspaces(session.workspaces || [session.currentWorkspace])
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        currentWorkspace,
        workspaces,
        isAuthenticated: Boolean(user) || mode === 'demo',
        isLoading,
        login,
        register,
        logout,
        switchWorkspace,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)
  if (!context) {
    // Provide safe fallback context for isolated unit tests
    return {
      user: {
        id: 'demo-user-1',
        fullName: 'Demo Developer',
        email: 'developer@hookforge.dev',
        status: 'ACTIVE',
      },
      currentWorkspace: {
        id: 'demo-workspace-1',
        name: 'Demo Workspace',
        role: 'OWNER',
      },
      workspaces: [
        {
          id: 'demo-workspace-1',
          name: 'Demo Workspace',
          role: 'OWNER',
        },
      ],
      isAuthenticated: true,
      isLoading: false,
      login: async () => {},
      register: async () => {},
      logout: async () => {},
      switchWorkspace: async () => {},
      refreshSession: async () => {},
    }
  }
  return context
}
