import { apiClient } from './client'
import type { ApiKeyItem, AuthSession, RegisterInput, LoginInput } from '../types/auth'

export async function registerUser(input: RegisterInput): Promise<AuthSession> {
  const res = await apiClient.post<AuthSession>('/auth/register', input)
  if (res.sessionToken) {
    localStorage.setItem('hookforge_session_token', res.sessionToken)
  }
  if (res.currentWorkspace?.id) {
    localStorage.setItem('hookforge_workspace_id', res.currentWorkspace.id)
  }
  if (res.apiKey) {
    localStorage.setItem('hookforge_api_key', res.apiKey)
  }
  return res
}

export async function loginUser(input: LoginInput): Promise<AuthSession> {
  const res = await apiClient.post<AuthSession>('/auth/login', input)
  if (res.sessionToken) {
    localStorage.setItem('hookforge_session_token', res.sessionToken)
  }
  if (res.currentWorkspace?.id) {
    localStorage.setItem('hookforge_workspace_id', res.currentWorkspace.id)
  }
  return res
}

export async function logoutUser(): Promise<{ success: boolean }> {
  try {
    await apiClient.post<{ success: boolean }>('/auth/logout', {})
  } catch {
    // Graceful fallback if network drops
  } finally {
    localStorage.removeItem('hookforge_session_token')
    localStorage.removeItem('hookforge_workspace_id')
    localStorage.removeItem('hookforge_api_key')
  }
  return { success: true }
}

export async function fetchCurrentUser(): Promise<AuthSession> {
  return apiClient.get<AuthSession>('/auth/me')
}

export async function switchActiveWorkspace(workspaceId: string): Promise<AuthSession> {
  const res = await apiClient.post<AuthSession>('/auth/switch-workspace', { workspaceId })
  if (res.currentWorkspace?.id) {
    localStorage.setItem('hookforge_workspace_id', res.currentWorkspace.id)
  }
  return res
}

export async function fetchApiKeys(): Promise<ApiKeyItem[]> {
  const res = await apiClient.get<{ apiKeys: ApiKeyItem[] }>('/auth/api-keys')
  return res.apiKeys || []
}

export async function createApiKey(name: string): Promise<{ apiKey: string; keyItem: ApiKeyItem }> {
  return apiClient.post<{ apiKey: string; keyItem: ApiKeyItem }>('/auth/api-keys', { name })
}

export async function revokeApiKey(keyId: string): Promise<{ success: boolean; id: string }> {
  return apiClient.delete<{ success: boolean; id: string }>(`/auth/api-keys/${keyId}`)
}
