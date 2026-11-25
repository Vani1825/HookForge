/**
 * Unit tests for JdbcTemplateRepository.
 * Tests template repository SQL execution and row mapping with mocked database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

describe('TemplateRepository', () => {
  let templateRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    templateRepository = (await import('../../src/repositories/jdbc/templateRepository.js')).default;
  });

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockTemplateId = '987e6543-e89b-12d3-a456-426614174999';

  describe('insert', () => {
    it('should execute INSERT query and return created template model', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockRow = {
        id: mockTemplateId,
        tenant_id: mockTenantId,
        name: 'Stripe Template',
        description: 'Processes Stripe events',
        http_method: 'POST',
        url: null,
        custom_headers: { 'X-Stripe-Version': '2022-11-15' },
        default_payload: null,
        rate_limit_rps: 50,
        retry_strategy: 'EXPONENTIAL',
        retry_max_attempts: 5,
        retry_base_delay_ms: 2000,
        retry_max_delay_ms: 30000,
        retry_backoff_multiplier: 2.0,
        is_system: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const result = await templateRepository.insert({
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'Stripe Template',
        description: 'Processes Stripe events',
        httpMethod: 'POST',
        url: null,
        customHeaders: { 'X-Stripe-Version': '2022-11-15' },
        defaultPayload: null,
        rateLimitRps: 50,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 2000,
        retryMaxDelayMs: 30000,
        retryBackoffMultiplier: 2.0,
        isSystem: false,
      });

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO webhook_templates'),
        expect.arrayContaining([
          mockTenantId,
          'Stripe Template',
          'Processes Stripe events',
          'POST',
          null,
        ])
      );
      expect(result.id).toBe(mockTemplateId);
      expect(result.name).toBe('Stripe Template');
      expect(result.rateLimitRps).toBe(50);
    });
  });

  describe('findAllByTenant', () => {
    it('should query templates for given tenant plus system templates ordered by is_system DESC, name ASC', async () => {
      const { query } = await import('../../src/config/database.js');
      const rows = [
        {
          id: '00000000-0000-0000-0000-000000000001',
          tenant_id: null,
          name: 'Slack Webhook',
          description: 'System template',
          http_method: 'POST',
          url: null,
          custom_headers: {},
          default_payload: null,
          rate_limit_rps: 1,
          retry_strategy: 'EXPONENTIAL',
          retry_max_attempts: 8,
          retry_base_delay_ms: 5000,
          retry_max_delay_ms: 3600000,
          retry_backoff_multiplier: 2.0,
          is_system: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: mockTemplateId,
          tenant_id: mockTenantId,
          name: 'Tenant Webhook',
          description: 'Custom',
          http_method: 'POST',
          url: null,
          custom_headers: {},
          default_payload: null,
          rate_limit_rps: 10,
          retry_strategy: 'EXPONENTIAL',
          retry_max_attempts: 8,
          retry_base_delay_ms: 5000,
          retry_max_delay_ms: 3600000,
          retry_backoff_multiplier: 2.0,
          is_system: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      query.mockResolvedValue({ rows });

      const result = await templateRepository.findAllByTenant(mockTenantId);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE (tenant_id = $1 OR is_system = TRUE)'),
        [mockTenantId]
      );
      expect(result).toHaveLength(2);
      expect(result[0].isSystem).toBe(true);
      expect(result[1].isSystem).toBe(false);
    });
  });

  describe('findByIdAndTenant', () => {
    it('should return template if accessible to tenant', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({
        rows: [
          {
            id: mockTemplateId,
            tenant_id: mockTenantId,
            name: 'Found Template',
            http_method: 'POST',
            url: null,
            custom_headers: {},
            default_payload: null,
            rate_limit_rps: 10,
            retry_strategy: 'EXPONENTIAL',
            retry_max_attempts: 8,
            retry_base_delay_ms: 5000,
            retry_max_delay_ms: 3600000,
            retry_backoff_multiplier: 2.0,
            is_system: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await templateRepository.findByIdAndTenant(mockTemplateId, mockTenantId);
      expect(result).not.toBeNull();
      expect(result.id).toBe(mockTemplateId);
    });

    it('should return null if template not found or inaccessible', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      const result = await templateRepository.findByIdAndTenant(mockTemplateId, mockTenantId);
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update template fields and return updated model', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({
        rows: [
          {
            id: mockTemplateId,
            tenant_id: mockTenantId,
            name: 'Updated Name',
            description: 'Updated desc',
            http_method: 'PUT',
            url: 'https://new.example.com',
            custom_headers: { 'X-Key': '123' },
            default_payload: { updated: true },
            rate_limit_rps: 100,
            retry_strategy: 'FIXED',
            retry_max_attempts: 5,
            retry_base_delay_ms: 2000,
            retry_max_delay_ms: 2000,
            retry_backoff_multiplier: 1.0,
            is_system: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await templateRepository.update(mockTenantId, mockTemplateId, {
        name: 'Updated Name',
        rateLimitRps: 100,
      });

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE webhook_templates'),
        expect.arrayContaining([mockTenantId, mockTemplateId])
      );
      expect(result.name).toBe('Updated Name');
      expect(result.rateLimitRps).toBe(100);
    });
  });

  describe('deleteByIdAndTenant', () => {
    it('should delete custom template and return true when row count is 1', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rowCount: 1 });

      const result = await templateRepository.deleteByIdAndTenant(mockTemplateId, mockTenantId);
      expect(result).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM webhook_templates\n    WHERE id = $1 AND tenant_id = $2 AND is_system = FALSE'),
        [mockTemplateId, mockTenantId]
      );
    });

    it('should return false when no row was deleted', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rowCount: 0 });

      const result = await templateRepository.deleteByIdAndTenant(mockTemplateId, mockTenantId);
      expect(result).toBe(false);
    });
  });
});

