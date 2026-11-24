/**
 * Integration tests for webhook templates routes.
 * Tests full HTTP request/response cycle with supertest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import templatesRouter from '../../src/routes/templates.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../../src/middleware/errorHandler.js';

vi.mock('../../src/services/template/templateService.js', () => ({
  default: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    applyTemplate: vi.fn(),
    createEndpointFromTemplate: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  apiKeyAuth: (req, res, next) => {
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  },
  TENANT_ID_ATTRIBUTE: 'tenantId',
}));

describe('Webhook Template Routes', () => {
  let app;
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockTemplateId = '987e6543-e89b-12d3-a456-426614174999';
  const systemTemplateId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/templates', templatesRouter);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /templates', () => {
    it('should create template and return 201 Created', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      const mockCreated = {
        id: mockTemplateId,
        tenantId: mockTenantId,
        name: 'Slack Alerts',
        description: 'Sends alerts to Slack',
        httpMethod: 'POST',
        url: null,
        customHeaders: { 'Content-Type': 'application/json' },
        defaultPayload: { text: 'Alert' },
        rateLimitRps: 10,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 2000,
        retryMaxDelayMs: 30000,
        retryBackoffMultiplier: 2.0,
        isSystem: false,
        createdAt: new Date().toISOString(),
      };

      templateService.create.mockResolvedValue(mockCreated);

      const response = await request(app)
        .post('/templates')
        .send({
          name: 'Slack Alerts',
          description: 'Sends alerts to Slack',
          rateLimitRps: 10,
          retryStrategy: 'EXPONENTIAL',
          retryMaxAttempts: 5,
        })
        .expect(201);

      expect(response.body.id).toBe(mockTemplateId);
      expect(response.body.name).toBe('Slack Alerts');
      expect(templateService.create).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ name: 'Slack Alerts' })
      );
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .post('/templates')
        .send({
          description: 'No name template',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('Template name is required');
    });

    it('should return 400 when rateLimitRps is out of bounds', async () => {
      const response = await request(app)
        .post('/templates')
        .send({
          name: 'Rate Limit Test',
          rateLimitRps: 600,
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('rateLimitRps');
    });

    it('should return 400 when templateService throws ValidationError', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.create.mockRejectedValue(
        new ValidationError('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs')
      );

      const response = await request(app)
        .post('/templates')
        .send({
          name: 'Invalid Delay',
          retryBaseDelayMs: 5000,
          retryMaxDelayMs: 2000,
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('retryMaxDelayMs');
    });
  });

  describe('GET /templates', () => {
    it('should return 200 OK with list of templates', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.list.mockResolvedValue([
        { id: systemTemplateId, name: 'Slack', isSystem: true },
        { id: mockTemplateId, name: 'Custom', isSystem: false },
      ]);

      const response = await request(app)
        .get('/templates')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(templateService.list).toHaveBeenCalledWith(mockTenantId, {});
    });

    it('should pass query filter parameters to templateService', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.list.mockResolvedValue([]);

      await request(app)
        .get('/templates?type=system&search=slack')
        .expect(200);

      expect(templateService.list).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ type: 'system', search: 'slack' })
      );
    });

    it('should return 400 for invalid type filter', async () => {
      const response = await request(app)
        .get('/templates?type=invalid')
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('GET /templates/:id', () => {
    it('should return 200 OK with template details', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.getById.mockResolvedValue({
        id: mockTemplateId,
        name: 'Single Template',
      });

      const response = await request(app)
        .get(`/templates/${mockTemplateId}`)
        .expect(200);

      expect(response.body.id).toBe(mockTemplateId);
      expect(templateService.getById).toHaveBeenCalledWith(mockTenantId, mockTemplateId);
    });

    it('should return 400 for non-UUID id param', async () => {
      const response = await request(app)
        .get('/templates/invalid-uuid')
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
    });

    it('should return 404 when template not found', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.getById.mockRejectedValue(new NotFoundError('Template not found'));

      const response = await request(app)
        .get(`/templates/${mockTemplateId}`)
        .expect(404);

      expect(response.body.error).toBe('Not Found');
    });
  });

  describe('PATCH /templates/:id & PUT /templates/:id', () => {
    it('should update template and return 200 OK', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.update.mockResolvedValue({
        id: mockTemplateId,
        name: 'Updated Name',
      });

      const response = await request(app)
        .patch(`/templates/${mockTemplateId}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(templateService.update).toHaveBeenCalledWith(
        mockTenantId,
        mockTemplateId,
        expect.objectContaining({ name: 'Updated Name' })
      );
    });

    it('should return 403 Forbidden when trying to update a system template', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.update.mockRejectedValue(
        new ForbiddenError('System templates cannot be modified or deleted')
      );

      const response = await request(app)
        .patch(`/templates/${systemTemplateId}`)
        .send({ name: 'Modified Slack' })
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toContain('System templates cannot be modified');
    });

    it('should return 404 when updating non-existent or other tenant template', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.update.mockRejectedValue(new NotFoundError('Template not found'));

      await request(app)
        .patch(`/templates/${mockTemplateId}`)
        .send({ name: 'New Name' })
        .expect(404);
    });
  });

  describe('DELETE /templates/:id', () => {
    it('should delete custom template and return 200 OK', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.remove.mockResolvedValue(true);

      const response = await request(app)
        .delete(`/templates/${mockTemplateId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.id).toBe(mockTemplateId);
      expect(templateService.remove).toHaveBeenCalledWith(mockTenantId, mockTemplateId);
    });

    it('should return 403 Forbidden when attempting to delete a system template', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.remove.mockRejectedValue(
        new ForbiddenError('System templates cannot be modified or deleted')
      );

      const response = await request(app)
        .delete(`/templates/${systemTemplateId}`)
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 404 when template not found', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.remove.mockRejectedValue(new NotFoundError('Template not found'));

      await request(app)
        .delete(`/templates/${mockTemplateId}`)
        .expect(404);
    });
  });

  describe('POST /templates/:id/apply & GET /templates/:id/apply', () => {
    it('should prefill endpoint configuration and return 200 OK without creating an endpoint', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      const mockApplied = {
        templateId: mockTemplateId,
        templateName: 'Slack Webhook',
        url: 'https://hooks.slack.com/services/xxx',
        httpMethod: 'POST',
        customHeaders: { 'Content-Type': 'application/json' },
        defaultPayload: { text: 'Hello' },
        rateLimitRps: 1,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
        retryBaseDelayMs: 5000,
        retryMaxDelayMs: 3600000,
        retryBackoffMultiplier: 2.0,
      };

      templateService.applyTemplate.mockResolvedValue(mockApplied);

      const response = await request(app)
        .post(`/templates/${mockTemplateId}/apply`)
        .send({ url: 'https://hooks.slack.com/services/xxx' })
        .expect(200);

      expect(response.body.templateId).toBe(mockTemplateId);
      expect(response.body.url).toBe('https://hooks.slack.com/services/xxx');
      expect(templateService.createEndpointFromTemplate).not.toHaveBeenCalled();
    });

    it('should support GET /templates/:id/apply for previewing configuration', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.applyTemplate.mockResolvedValue({
        templateId: mockTemplateId,
        url: null,
      });

      const response = await request(app)
        .get(`/templates/${mockTemplateId}/apply`)
        .expect(200);

      expect(response.body.templateId).toBe(mockTemplateId);
    });

    it('should create endpoint and return 201 when create=true query param is passed', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      const mockEndpoint = {
        id: 'new-endpoint-id',
        url: 'https://created.example.com',
        secret: 'whsec_test789',
        active: true,
        rateLimitRps: 10,
        circuitState: 'CLOSED',
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
        retryBaseDelayMs: 5000,
        retryMaxDelayMs: 3600000,
        retryBackoffMultiplier: 2.0,
        createdAt: new Date().toISOString(),
      };

      templateService.createEndpointFromTemplate.mockResolvedValue(mockEndpoint);

      const response = await request(app)
        .post(`/templates/${mockTemplateId}/apply?create=true`)
        .send({ url: 'https://created.example.com' })
        .expect(201);

      expect(response.body.id).toBe('new-endpoint-id');
      expect(response.body.secret).toBe('whsec_test789');
      expect(templateService.createEndpointFromTemplate).toHaveBeenCalledWith(
        mockTenantId,
        mockTemplateId,
        expect.objectContaining({ url: 'https://created.example.com' })
      );
    });
  });

  describe('POST /templates/:id/create-endpoint', () => {
    it('should explicitly create endpoint from template and return 201 with secret', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      const mockEndpoint = {
        id: 'new-endpoint-id-2',
        url: 'https://explicit.example.com',
        secret: 'whsec_explicit123',
        active: true,
        rateLimitRps: 25,
        circuitState: 'CLOSED',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 3,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 1000,
        retryBackoffMultiplier: 1.0,
        createdAt: new Date().toISOString(),
      };

      templateService.createEndpointFromTemplate.mockResolvedValue(mockEndpoint);

      const response = await request(app)
        .post(`/templates/${mockTemplateId}/create-endpoint`)
        .send({
          url: 'https://explicit.example.com',
          retryStrategy: 'FIXED',
        })
        .expect(201);

      expect(response.body.id).toBe('new-endpoint-id-2');
      expect(response.body.secret).toBe('whsec_explicit123');
      expect(response.body.retryStrategy).toBe('FIXED');
    });

    it('should return 400 if templateService throws ValidationError', async () => {
      const templateService = (await import('../../src/services/template/templateService.js')).default;
      templateService.createEndpointFromTemplate.mockRejectedValue(
        new ValidationError('Destination URL is required to create an endpoint from template')
      );

      const response = await request(app)
        .post(`/templates/${mockTemplateId}/create-endpoint`)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('Destination URL is required');
    });
  });
});

