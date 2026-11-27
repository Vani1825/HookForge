import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRouter from '../../src/routes/auth.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

const { mockService } = vi.hoisted(() => {
  const service = {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
    switchWorkspace: vi.fn(),
    listApiKeysForTenant: vi.fn(),
    createApiKeyForTenant: vi.fn(),
    revokeApiKeyForTenant: vi.fn(),
    hashToken: vi.fn((token) => `hashed_${token}`),
    generateToken: vi.fn(() => 'mock-generated-token'),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    verifyEmail: vi.fn(),
  };
  return { mockService: service };
});

vi.mock('../../src/services/auth/authService.js', () => ({
  ...mockService,
  default: mockService,
}));

vi.mock('../../src/repositories/jdbc/sessionRepository.js', () => ({
  default: {
    findActiveSession: vi.fn(),
    touchSession: vi.fn(),
    revokeSession: vi.fn(),
  },
}));

vi.mock('../../src/repositories/jdbc/workspaceMembershipRepository.js', () => ({
  default: {
    findWorkspacesByUserId: vi.fn(),
  },
}));

vi.mock('../../src/repositories/jdbc/apiKeyRepository.js', () => ({
  default: {
    listByTenant: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  },
}));

describe('Auth Routes (SaaS)', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', authRouter);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockUser = {
    id: 'user-uuid-1',
    fullName: 'Test User',
    email: 'test@example.com',
    status: 'ACTIVE',
  };

  const mockWorkspace = {
    id: 'workspace-uuid-1',
    name: 'Test Workspace',
    role: 'OWNER',
  };

  describe('POST /auth/register', () => {
    it('should register a customer and return 201 with session and key', async () => {
      mockService.register.mockResolvedValue({
        user: mockUser,
        currentWorkspace: mockWorkspace,
        workspaces: [mockWorkspace],
        sessionToken: 'sess_token_123',
        apiKey: 'whkey_secret123',
      });

      const res = await request(app)
        .post('/auth/register')
        .send({
          fullName: 'Test User',
          email: 'test@example.com',
          password: 'Password123!',
          workspaceName: 'Test Workspace',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('test@example.com');
      expect(res.body.currentWorkspace.name).toBe('Test Workspace');
      expect(res.body.sessionToken).toBe('sess_token_123');
      expect(res.body.apiKey).toBe('whkey_secret123');
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject registration with invalid email', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          fullName: 'Test User',
          email: 'not-an-email',
          password: 'Password123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('validation_error');
    });

    it('should reject registration with short password', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          fullName: 'Test User',
          email: 'valid@example.com',
          password: '123',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('validation_error');
    });
  });

  describe('POST /auth/login', () => {
    it('should authenticate user and return 200 with session', async () => {
      mockService.login.mockResolvedValue({
        user: mockUser,
        currentWorkspace: mockWorkspace,
        workspaces: [mockWorkspace],
        sessionToken: 'sess_login_456',
      });

      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('test@example.com');
      expect(res.body.sessionToken).toBe('sess_login_456');
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should return 400 when email or password is missing', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/logout', () => {
    it('should log out and clear cookies', async () => {
      mockService.logout.mockResolvedValue(true);

      const res = await request(app)
        .post('/auth/logout')
        .set('Cookie', ['hookforge_session=active_token']);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /auth/me', () => {
    it('should return 401 when no session provided', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 200 with user info when session valid', async () => {
      mockService.getMe.mockResolvedValue({
        user: mockUser,
        currentWorkspace: mockWorkspace,
        workspaces: [mockWorkspace],
      });

      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', ['hookforge_session=mock_cookie_token']);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('test@example.com');
      expect(res.body.currentWorkspace.name).toBe('Test Workspace');
    });
  });

  describe('API Key Endpoints', () => {
    it('should list API keys for authenticated workspace', async () => {
      const sessionRepo = (await import('../../src/repositories/jdbc/sessionRepository.js')).default;
      const membershipRepo = (await import('../../src/repositories/jdbc/workspaceMembershipRepository.js')).default;

      sessionRepo.findActiveSession.mockResolvedValue({
        session_id: 's-1',
        user_id: 'u-1',
        full_name: 'Test User',
        email: 'test@example.com',
        user_status: 'ACTIVE',
      });

      membershipRepo.findWorkspacesByUserId.mockResolvedValue([
        { id: 'w-1', name: 'My Workspace', role: 'OWNER' },
      ]);

      mockService.listApiKeysForTenant.mockResolvedValue({
        apiKeys: [
          {
            id: 'k-1',
            name: 'Prod Key',
            keyPrefix: 'whkey_123',
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            revokedAt: null,
          },
        ],
      });

      const res = await request(app)
        .get('/auth/api-keys')
        .set('Cookie', ['hookforge_session=mock_cookie_token']);

      expect(res.status).toBe(200);
      expect(res.body.apiKeys).toHaveLength(1);
      expect(res.body.apiKeys[0].name).toBe('Prod Key');
    });

    it('should generate a new API key', async () => {
      const sessionRepo = (await import('../../src/repositories/jdbc/sessionRepository.js')).default;
      const membershipRepo = (await import('../../src/repositories/jdbc/workspaceMembershipRepository.js')).default;

      sessionRepo.findActiveSession.mockResolvedValue({
        session_id: 's-1',
        user_id: 'u-1',
        full_name: 'Test User',
        email: 'test@example.com',
        user_status: 'ACTIVE',
      });

      membershipRepo.findWorkspacesByUserId.mockResolvedValue([
        { id: 'w-1', name: 'My Workspace', role: 'OWNER' },
      ]);

      mockService.createApiKeyForTenant.mockResolvedValue({
        apiKey: 'whkey_new1234567890abcdef',
        keyItem: {
          id: 'k-new',
          name: 'Backend Service Key',
          key_prefix: 'whkey_new123',
          created_at: new Date().toISOString(),
        },
      });

      const res = await request(app)
        .post('/auth/api-keys')
        .set('Cookie', ['hookforge_session=mock_cookie_token'])
        .send({ name: 'Backend Service Key' });

      expect(res.status).toBe(201);
      expect(res.body.apiKey).toBeDefined();
      expect(res.body.apiKey.startsWith('whkey_')).toBe(true);
      expect(res.body.keyItem.name).toBe('Backend Service Key');
    });
  });
});
