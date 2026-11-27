import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import * as authService from '../../src/services/auth/authService.js';
import userRepository from '../../src/repositories/jdbc/userRepository.js';
import pool from '../../src/config/database.js';
import { ConflictError, ValidationError } from '../../src/middleware/errorHandler.js';

vi.mock('../../src/repositories/jdbc/userRepository.js', () => ({
  default: {
    findByEmail: vi.fn(),
  },
  findByEmail: vi.fn(),
}));

vi.mock('../../src/repositories/jdbc/tenantRepository.js', () => ({
  default: {
    invalidateCache: vi.fn(),
  },
  invalidateCache: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

describe('AuthService - Registration & Account Lifecycle', () => {
  let mockClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('register()', () => {
    it('creates user, tenant, membership, api key, and session in an atomic transaction', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      mockClient.query.mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.trim() === 'BEGIN') {
          return { rowCount: 0 };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO users')) {
          return {
            rows: [
              {
                id: 'new-user-123',
                full_name: params[0],
                email: params[1],
                status: 'ACTIVE',
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO tenants')) {
          return {
            rows: [
              {
                id: 'new-tenant-456',
                name: params[0],
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO workspace_memberships')) {
          return { rowCount: 1 };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO api_keys')) {
          return { rowCount: 1 };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO user_sessions')) {
          return { rowCount: 1 };
        }
        if (typeof sql === 'string' && sql.trim() === 'COMMIT') {
          return { rowCount: 0 };
        }
        return { rows: [] };
      });

      const result = await authService.register({
        fullName: 'Alice Developer',
        email: 'alice@example.com',
        password: 'Password123!',
        workspaceName: 'Acme Corp',
      });

      expect(userRepository.findByEmail).toHaveBeenCalledWith('alice@example.com');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();

      expect(result.user.id).toBe('new-user-123');
      expect(result.user.email).toBe('alice@example.com');
      expect(result.currentWorkspace.name).toBe('Acme Corp');
      expect(result.currentWorkspace.role).toBe('OWNER');
      expect(result.workspaces).toHaveLength(1);
      expect(result.apiKey).toMatch(/^whkey_[a-f0-9]{48}$/);
      expect(result.sessionToken).toBeDefined();
    });

    it('rejects duplicate email and does not start transaction', async () => {
      userRepository.findByEmail.mockResolvedValue({
        id: 'existing-user-1',
        email: 'duplicate@example.com',
      });

      await expect(
        authService.register({
          fullName: 'Duplicate Name',
          email: 'duplicate@example.com',
          password: 'Password123!',
        })
      ).rejects.toThrow(ConflictError);

      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rolls back transaction if database insert fails', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      mockClient.query.mockImplementation(async (sql) => {
        if (typeof sql === 'string' && sql.trim() === 'BEGIN') {
          return { rowCount: 0 };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO users')) {
          const err = new Error('Database connection lost');
          throw err;
        }
        if (typeof sql === 'string' && sql.trim() === 'ROLLBACK') {
          return { rowCount: 0 };
        }
        return { rows: [] };
      });

      await expect(
        authService.register({
          fullName: 'Failed User',
          email: 'fail@example.com',
          password: 'Password123!',
        })
      ).rejects.toThrow('Database connection lost');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('validates input fields and rejects invalid values', async () => {
      await expect(
        authService.register({
          fullName: '',
          email: 'test@example.com',
          password: 'Password123!',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        authService.register({
          fullName: 'Test User',
          email: 'not-an-email',
          password: 'Password123!',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        authService.register({
          fullName: 'Test User',
          email: 'test@example.com',
          password: 'short',
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Security & Hashing', () => {
    it('generates raw API key with whkey_ prefix and stores SHA-256 hash', () => {
      const { rawApiKey, keyPrefix, keyHash } = authService.generateApiKey();
      expect(rawApiKey.startsWith('whkey_')).toBe(true);
      expect(keyPrefix).toBe('whkey_');
      expect(keyHash).toBe(authService.hashToken(rawApiKey));
    });
  });
});
