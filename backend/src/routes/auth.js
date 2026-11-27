/**
 * Auth Router - SaaS user registration, login, session inspection, password recovery,
 * workspace switching, and API key management.
 */

import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import authService from '../services/auth/authService.js';
import {
  requireSessionAuth,
  extractSessionToken,
  SESSION_COOKIE_NAME,
  WORKSPACE_COOKIE_NAME,
} from '../middleware/sessionAuth.js';
import { ValidationError, ForbiddenError } from '../middleware/errorHandler.js';

const router = Router();

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Standard cookie configuration
 */
function getCookieOptions(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

/**
 * POST /auth/register
 * Self-service registration for new customers.
 */
router.post(
  '/register',
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    body('workspaceName').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError(errors.array().map((e) => e.msg).join(', '));
      }

      const { fullName, email, password, workspaceName } = req.body;
      const result = await authService.register({
        fullName,
        email,
        password,
        workspaceName,
      });

      // Set session cookie
      res.cookie(SESSION_COOKIE_NAME, result.sessionToken, getCookieOptions());
      if (result.currentWorkspace?.id) {
        res.cookie(WORKSPACE_COOKIE_NAME, result.currentWorkspace.id, {
          ...getCookieOptions(),
          httpOnly: false, // Accessible to frontend script for header sync if desired
        });
      }

      res.status(201).json({
        user: result.user,
        currentWorkspace: result.currentWorkspace,
        workspaces: result.workspaces,
        apiKey: result.apiKey,
        sessionToken: result.sessionToken,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/login
 * User login with email and password.
 */
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError(errors.array().map((e) => e.msg).join(', '));
      }

      const { email, password } = req.body;
      const result = await authService.login({ email, password });

      // Set session cookie
      res.cookie(SESSION_COOKIE_NAME, result.sessionToken, getCookieOptions());
      if (result.currentWorkspace?.id) {
        res.cookie(WORKSPACE_COOKIE_NAME, result.currentWorkspace.id, {
          ...getCookieOptions(),
          httpOnly: false,
        });
      }

      res.status(200).json({
        user: result.user,
        currentWorkspace: result.currentWorkspace,
        workspaces: result.workspaces,
        sessionToken: result.sessionToken,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/logout
 * Revoke session and clear cookies.
 */
router.post('/logout', async (req, res, next) => {
  try {
    const token = extractSessionToken(req);
    if (token) {
      await authService.logout(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.clearCookie(WORKSPACE_COOKIE_NAME, { path: '/' });
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/me
 * Restore session and return authorized workspaces.
 */
router.get('/me', async (req, res, next) => {
  try {
    const token = extractSessionToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No active session token provided',
      });
    }

    const requestedTenantId =
      req.headers['x-tenant-id'] ||
      (req.cookies && req.cookies[WORKSPACE_COOKIE_NAME]) ||
      null;

    const me = await authService.getMe(token, requestedTenantId);
    if (!me) {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.clearCookie(WORKSPACE_COOKIE_NAME, { path: '/' });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Session is invalid or has expired',
      });
    }

    res.status(200).json(me);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/switch-workspace
 * Switch the active workspace for the current session.
 */
router.post('/switch-workspace', requireSessionAuth, async (req, res, next) => {
  try {
    const { workspaceId } = req.body;
    if (!workspaceId) {
      throw new ValidationError('workspaceId is required');
    }

    const token = extractSessionToken(req);
    const me = await authService.getMe(token, workspaceId);

    if (!me || me.currentWorkspace?.id !== workspaceId) {
      throw new ForbiddenError('Unauthorized workspace switch');
    }

    res.cookie(WORKSPACE_COOKIE_NAME, workspaceId, {
      ...getCookieOptions(),
      httpOnly: false,
    });

    res.status(200).json({
      currentWorkspace: me.currentWorkspace,
      workspaces: me.workspaces,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/password-reset/request
 * Request password recovery.
 */
router.post(
  '/password-reset/request',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email is required')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError(errors.array().map((e) => e.msg).join(', '));
      }
      const result = await authService.requestPasswordReset(req.body.email);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/password-reset/confirm
 * Complete password reset with token.
 */
router.post(
  '/password-reset/confirm',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError(errors.array().map((e) => e.msg).join(', '));
      }
      const { token, newPassword } = req.body;
      await authService.resetPassword(token, newPassword);
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.clearCookie(WORKSPACE_COOKIE_NAME, { path: '/' });
      res.status(200).json({ success: true, message: 'Password has been reset successfully' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /auth/api-keys
 * List API keys for the user's active workspace.
 */
router.get('/api-keys', requireSessionAuth, async (req, res, next) => {
  try {
    const keys = await authService.listApiKeysForTenant(req.tenantId);
    if (keys && typeof keys === 'object' && Array.isArray(keys.apiKeys)) {
      return res.status(200).json(keys);
    }
    const apiKeysList = Array.isArray(keys) ? keys : [];
    res.status(200).json({ apiKeys: apiKeysList });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/api-keys
 * Generate a new API key for the user's active workspace.
 * Requires OWNER or ADMIN role.
 */
router.post(
  '/api-keys',
  requireSessionAuth,
  [body('name').optional().trim()],
  async (req, res, next) => {
    try {
      if (req.workspaceRole !== 'OWNER' && req.workspaceRole !== 'ADMIN') {
        throw new ForbiddenError('Only workspace Owners and Admins can create API keys');
      }

      const { name } = req.body;
      const created = await authService.createApiKeyForTenant(req.tenantId, name || 'API Key');
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /auth/api-keys/:id
 * Revoke an existing API key.
 * Requires OWNER or ADMIN role.
 */
router.delete('/api-keys/:id', requireSessionAuth, async (req, res, next) => {
  try {
    if (req.workspaceRole !== 'OWNER' && req.workspaceRole !== 'ADMIN') {
      throw new ForbiddenError('Only workspace Owners and Admins can revoke API keys');
    }

    const { id } = req.params;
    const revoked = await authService.revokeApiKeyForTenant(id, req.tenantId);
    if (!revoked) {
      return res.status(404).json({ error: 'Not Found', message: 'API key not found or already revoked' });
    }

    res.status(200).json({ success: true, message: 'API key revoked successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
