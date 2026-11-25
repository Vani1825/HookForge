/**
 * Unit tests for TemplateService.
 * Tests template business logic, validation, ownership isolation, and template application.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import templateService from '../../src/services/template/templateService.js';
import templateRepository from '../../src/repositories/jdbc/templateRepository.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../../src/middleware/errorHandler.js';

vi.mock('../../src/repositories/jdbc/templateRepository.js', () => ({
  default: {
    insert: vi.fn(),
    findAllByTenant: vi.fn(),
    findByIdAndTenant: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    deleteByIdAndTenant: vi.fn(),
  },
}));

vi.mock('../../src/services/endpoint/endpointService.js', () => ({
  default: {
    create: vi.fn(),
  },
}));

describe('TemplateService', () => {
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockTemplateId = '987e6543-e89b-12d3-a456-426614174999';
  const systemTemplateId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create template with valid fields and defaults', async () => {
      const inserted = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'Order Webhook',
        description: 'Processes incoming orders',
        httpMethod: 'POST',
        url: 'https://orders.example.com/webhook',
        customHeaders: { 'X-Custom': 'val' },
        defaultPayload: { event: 'order.created' },
        rateLimitRps: 20,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 2000,
        retryMaxDelayMs: 30000,
        retryBackoffMultiplier: 2.0,
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      templateRepository.insert.mockResolvedValue(inserted);

      const result = await templateService.create(mockTenantId, {
        name: 'Order Webhook',
        description: 'Processes incoming orders',
        url: 'https://orders.example.com/webhook',
        customHeaders: { 'X-Custom': 'val' },
        defaultPayload: { event: 'order.created' },
        rateLimitRps: 20,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 2000,
        retryMaxDelayMs: 30000,
        retryBackoffMultiplier: 2.0,
      });

      expect(templateRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Order Webhook',
          tenantId: mockTenantId,
          description: 'Processes incoming orders',
          httpMethod: 'POST',
          rateLimitRps: 20,
          retryStrategy: 'EXPONENTIAL',
          retryMaxAttempts: 5,
          retryBaseDelayMs: 2000,
          retryMaxDelayMs: 30000,
          retryBackoffMultiplier: 2.0,
        })
      );
      expect(result.id).toBe(mockTemplateId);
      expect(result.name).toBe('Order Webhook');
      expect(result.isSystem).toBe(false);
      expect(result.retryPolicy.strategy).toBe('EXPONENTIAL');
    });

    it('should support nested retryPolicy object on create', async () => {
      const inserted = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'Fixed Retry Template',
        httpMethod: 'POST',
        url: null,
        customHeaders: {},
        defaultPayload: null,
        rateLimitRps: 10,
        retryStrategy: 'FIXED',
        retryMaxAttempts: 4,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 1000,
        retryBackoffMultiplier: 1.0,
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      templateRepository.insert.mockResolvedValue(inserted);

      const result = await templateService.create(mockTenantId, {
        name: 'Fixed Retry Template',
        retryPolicy: {
          strategy: 'FIXED',
          maxAttempts: 4,
          baseDelayMs: 1000,
          maxDelayMs: 1000,
          backoffMultiplier: 1.0,
        },
      });

      expect(templateRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Fixed Retry Template',
          tenantId: mockTenantId,
          retryStrategy: 'FIXED',
          retryMaxAttempts: 4,
          retryBaseDelayMs: 1000,
        })
      );
      expect(result.retryStrategy).toBe('FIXED');
    });

    it('should reject missing or empty template name', async () => {
      await expect(
        templateService.create(mockTenantId, { name: '' })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, { name: '   ' })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, {})
      ).rejects.toThrow(ValidationError);
    });

    it('should reject template name exceeding 100 characters', async () => {
      await expect(
        templateService.create(mockTenantId, { name: 'A'.repeat(101) })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject invalid HTTP method', async () => {
      await expect(
        templateService.create(mockTenantId, {
          name: 'Invalid Method',
          httpMethod: 'INVALID',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject invalid customHeaders (non-object or illegal keys)', async () => {
      await expect(
        templateService.create(mockTenantId, {
          name: 'Bad Headers',
          customHeaders: 'not-an-object',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, {
          name: 'Bad Header Key',
          customHeaders: { 'Bad Key Space': 'value' },
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, {
          name: 'CRLF Header',
          customHeaders: { 'X-Injected': 'line1\r\nline2' },
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject invalid rateLimitRps out of bounds', async () => {
      await expect(
        templateService.create(mockTenantId, {
          name: 'Zero Rate',
          rateLimitRps: 0,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, {
          name: 'High Rate',
          rateLimitRps: 501,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject invalid retry settings', async () => {
      await expect(
        templateService.create(mockTenantId, {
          name: 'Bad Strategy',
          retryStrategy: 'RANDOM',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, {
          name: 'Negative Attempts',
          retryMaxAttempts: 0,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, {
          name: 'Low Delay',
          retryBaseDelayMs: 50,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        templateService.create(mockTenantId, {
          name: 'Max Delay Less Than Base Delay',
          retryBaseDelayMs: 5000,
          retryMaxDelayMs: 2000,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('list', () => {
    const systemTemplate = {
      id: systemTemplateId,
      tenantId: null,
      name: 'Slack Webhook',
      description: 'Slack incoming webhook format',
      httpMethod: 'POST',
      url: null,
      customHeaders: { 'Content-Type': 'application/json' },
      defaultPayload: { text: 'Hello from HookForge!' },
      rateLimitRps: 1,
      retryStrategy: 'EXPONENTIAL',
      retryMaxAttempts: 8,
      retryBaseDelayMs: 5000,
      retryMaxDelayMs: 3600000,
      retryBackoffMultiplier: 2.0,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const customTemplate = {
      id: mockTemplateId,
      tenantId: mockTenantId,
      name: 'Custom Billing',
      description: 'Internal billing notifications',
      httpMethod: 'POST',
      url: 'https://billing.example.com',
      customHeaders: {},
      defaultPayload: {},
      rateLimitRps: 50,
      retryStrategy: 'FIXED',
      retryMaxAttempts: 3,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 1000,
      retryBackoffMultiplier: 1.0,
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should list all accessible templates (system + custom)', async () => {
      templateRepository.findAllByTenant.mockResolvedValue([systemTemplate, customTemplate]);

      const list = await templateService.list(mockTenantId, {});
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(systemTemplateId);
      expect(list[0].isSystem).toBe(true);
      expect(list[1].id).toBe(mockTemplateId);
      expect(list[1].isSystem).toBe(false);
    });

    it('should filter by type=system', async () => {
      templateRepository.findAllByTenant.mockResolvedValue([systemTemplate, customTemplate]);

      const list = await templateService.list(mockTenantId, { type: 'system' });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(systemTemplateId);
    });

    it('should filter by type=custom', async () => {
      templateRepository.findAllByTenant.mockResolvedValue([systemTemplate, customTemplate]);

      const list = await templateService.list(mockTenantId, { type: 'custom' });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(mockTemplateId);
    });

    it('should filter by search keyword matching name or description', async () => {
      templateRepository.findAllByTenant.mockResolvedValue([systemTemplate, customTemplate]);

      const list = await templateService.list(mockTenantId, { search: 'billing' });
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Custom Billing');
    });
  });

  describe('getById', () => {
    it('should return template if owned by tenant', async () => {
      const template = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'My Template',
        httpMethod: 'POST',
        url: null,
        customHeaders: {},
        defaultPayload: null,
        rateLimitRps: 10,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
        retryBaseDelayMs: 5000,
        retryMaxDelayMs: 3600000,
        retryBackoffMultiplier: 2.0,
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      templateRepository.findByIdAndTenant.mockResolvedValue(template);

      const result = await templateService.getById(mockTenantId, mockTemplateId);
      expect(result.id).toBe(mockTemplateId);
    });

    it('should return system template', async () => {
      const systemTemplate = {
        id: systemTemplateId,
        tenantId: null,
        name: 'System Template',
        httpMethod: 'POST',
        url: null,
        customHeaders: {},
        defaultPayload: null,
        rateLimitRps: 10,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
        retryBaseDelayMs: 5000,
        retryMaxDelayMs: 3600000,
        retryBackoffMultiplier: 2.0,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      templateRepository.findByIdAndTenant.mockResolvedValue(systemTemplate);

      const result = await templateService.getById(mockTenantId, systemTemplateId);
      expect(result.id).toBe(systemTemplateId);
      expect(result.isSystem).toBe(true);
    });

    it('should throw NotFoundError if template does not exist or belongs to another tenant', async () => {
      templateRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(
        templateService.getById(mockTenantId, 'non-existent-id')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('should update custom template owned by tenant', async () => {
      const existing = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'Old Name',
        description: 'Old desc',
        httpMethod: 'POST',
        url: 'https://old.example.com',
        customHeaders: {},
        defaultPayload: null,
        rateLimitRps: 10,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
        retryBaseDelayMs: 5000,
        retryMaxDelayMs: 3600000,
        retryBackoffMultiplier: 2.0,
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updated = {
        ...existing,
        name: 'New Name',
        rateLimitRps: 50,
        updatedAt: new Date(),
      };

      templateRepository.findByIdAndTenant.mockResolvedValue(existing);
      templateRepository.update.mockResolvedValue(updated);

      const result = await templateService.update(mockTenantId, mockTemplateId, {
        name: 'New Name',
        rateLimitRps: 50,
      });

      expect(templateRepository.update).toHaveBeenCalledWith(
        mockTemplateId,
        mockTenantId,
        expect.objectContaining({
          name: 'New Name',
          rateLimitRps: 50,
        })
      );
      expect(result.name).toBe('New Name');
      expect(result.rateLimitRps).toBe(50);
    });

    it('should throw ForbiddenError when attempting to update a system template', async () => {
      const systemTemplate = {
        id: systemTemplateId,
        tenantId: null,
        name: 'Slack System Template',
        isSystem: true,
      };

      templateRepository.findByIdAndTenant.mockResolvedValue(systemTemplate);

      await expect(
        templateService.update(mockTenantId, systemTemplateId, { name: 'New Slack' })
      ).rejects.toThrow(ForbiddenError);
      expect(templateRepository.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when attempting to update another tenant template', async () => {
      templateRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(
        templateService.update(mockTenantId, mockTemplateId, { name: 'Hacked' })
      ).rejects.toThrow(NotFoundError);
      expect(templateRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete custom template owned by tenant', async () => {
      const existing = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'Delete Me',
        isSystem: false,
      };

      templateRepository.findByIdAndTenant.mockResolvedValue(existing);
      templateRepository.deleteByIdAndTenant.mockResolvedValue(true);

      const result = await templateService.remove(mockTenantId, mockTemplateId);
      expect(result.success).toBe(true);
      expect(result.id).toBe(mockTemplateId);
      expect(templateRepository.deleteByIdAndTenant).toHaveBeenCalledWith(
        mockTemplateId,
        mockTenantId
      );
    });

    it('should throw ForbiddenError when attempting to delete a system template', async () => {
      const systemTemplate = {
        id: systemTemplateId,
        tenantId: null,
        name: 'System Template',
        isSystem: true,
      };

      templateRepository.findByIdAndTenant.mockResolvedValue(systemTemplate);

      await expect(
        templateService.remove(mockTenantId, systemTemplateId)
      ).rejects.toThrow(ForbiddenError);
      expect(templateRepository.deleteByIdAndTenant).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when attempting to delete another tenant template', async () => {
      templateRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(
        templateService.remove(mockTenantId, mockTemplateId)
      ).rejects.toThrow(NotFoundError);
      expect(templateRepository.deleteByIdAndTenant).not.toHaveBeenCalled();
    });
  });

  describe('applyTemplate', () => {
    const template = {
      id: mockTemplateId,
      tenantId: mockTenantId,
      name: 'Base Template',
      httpMethod: 'POST',
      url: 'https://default.example.com',
      customHeaders: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret_token',
      },
      defaultPayload: { defaultKey: 'defaultValue' },
      rateLimitRps: 15,
      retryStrategy: 'EXPONENTIAL',
      retryMaxAttempts: 6,
      retryBaseDelayMs: 3000,
      retryMaxDelayMs: 60000,
      retryBackoffMultiplier: 2.0,
      isSystem: false,
    };

    it('should prefill endpoint configuration and redact sensitive headers', async () => {
      templateRepository.findByIdAndTenant.mockResolvedValue(template);

      const applied = await templateService.applyTemplate(mockTenantId, mockTemplateId);

      expect(applied.templateId).toBe(mockTemplateId);
      expect(applied.templateName).toBe('Base Template');
      expect(applied.url).toBe('https://default.example.com');
      expect(applied.httpMethod).toBe('POST');
      expect(applied.rateLimitRps).toBe(15);
      expect(applied.customHeaders['Content-Type']).toBe('application/json');
      expect(applied.customHeaders.Authorization).toBe('[REDACTED]');
      expect(applied.defaultPayload).toEqual({ defaultKey: 'defaultValue' });
      expect(applied.retryStrategy).toBe('EXPONENTIAL');
      expect(applied.retryMaxAttempts).toBe(6);
    });

    it('should merge user overrides without creating an endpoint', async () => {
      templateRepository.findByIdAndTenant.mockResolvedValue(template);

      const applied = await templateService.applyTemplate(mockTenantId, mockTemplateId, {
        url: 'https://overridden.example.com/hook',
        httpMethod: 'PUT',
        rateLimitRps: 30,
        customHeaders: { 'X-Extra': '123' },
        retryStrategy: 'FIXED',
        retryMaxAttempts: 3,
        retryBaseDelayMs: 1500,
        retryMaxDelayMs: 1500,
        retryBackoffMultiplier: 1.0,
      });

      expect(applied.url).toBe('https://overridden.example.com/hook');
      expect(applied.httpMethod).toBe('PUT');
      expect(applied.rateLimitRps).toBe(30);
      expect(applied.customHeaders['X-Extra']).toBe('123');
      expect(applied.retryStrategy).toBe('FIXED');
      expect(applied.retryMaxAttempts).toBe(3);
    });
  });

  describe('createEndpointFromTemplate', () => {
    it('should create endpoint by applying template and invoking endpointService', async () => {
      const template = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'Template',
        httpMethod: 'POST',
        url: null,
        customHeaders: {},
        defaultPayload: null,
        rateLimitRps: 10,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
        retryBaseDelayMs: 5000,
        retryMaxDelayMs: 3600000,
        retryBackoffMultiplier: 2.0,
        isSystem: false,
      };
      templateRepository.findByIdAndTenant.mockResolvedValue(template);

      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      endpointService.create.mockResolvedValue({
        id: 'new-endpoint-id',
        url: 'https://applied.example.com',
        secret: 'whsec_applied123',
        active: true,
      });

      const endpoint = await templateService.createEndpointFromTemplate(
        mockTenantId,
        mockTemplateId,
        { url: 'https://applied.example.com' }
      );

      expect(endpointService.create).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          url: 'https://applied.example.com',
          templateId: mockTemplateId,
        })
      );
      expect(endpoint.id).toBe('new-endpoint-id');
      expect(endpoint.secret).toBe('whsec_applied123');
    });

    it('should throw ValidationError if neither template nor overrides provide URL', async () => {
      const template = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'No URL Template',
        url: null,
        isSystem: false,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
        retryBaseDelayMs: 5000,
        retryMaxDelayMs: 3600000,
        retryBackoffMultiplier: 2.0,
        customHeaders: {},
        rateLimitRps: 10,
      };
      templateRepository.findByIdAndTenant.mockResolvedValue(template);

      await expect(
        templateService.createEndpointFromTemplate(mockTenantId, mockTemplateId, {})
      ).rejects.toThrow(ValidationError);
    });
  });
});

