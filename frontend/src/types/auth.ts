export interface User {
  id: string
  fullName: string
  email: string
  status: 'ACTIVE' | 'SUSPENDED'
  emailVerifiedAt?: string | null
  createdAt?: string
}

export interface Workspace {
  id: string
  name: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  createdAt?: string
}

export interface ApiKeyItem {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt?: string | null
  revokedAt?: string | null
}

export interface AuthSession {
  user: User
  currentWorkspace: Workspace
  workspaces: Workspace[]
  sessionToken?: string
  apiKey?: string
}

export interface RegisterInput {
  fullName: string
  email: string
  password: string
  workspaceName?: string
}

export interface LoginInput {
  email: string
  password: string
}
