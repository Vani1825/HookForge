/**
 * SessionAuth - Browser session authentication middleware for SaaS dashboard.
 * Supports HttpOnly cookies and X-Session-Token headers.
 */

import { hashToken } from '../services/auth/authService.js';
import sessionRepository from '../repositories/jdbc/sessionRepository.js';
import workspaceMembershipRepository from '../repositories/jdbc/workspaceMembershipRepository.js';
import { UnauthorizedError, ForbiddenError } from './errorHandler.js';
import logger from '../utils/logger.js';
import { TENANT_ID_ATTRIBUTE } from './auth.js';

export const SESSION_COOKIE_NAME = 'hookforge_session';
export const WORKSPACE_COOKIE_NAME = 'hookforge_workspace_id';

/**
 * Extract session token from cookie, Authorization header, or X-Session-Token.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function extractSessionToken(req) {
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Session ')) {
      return authHeader.substring(8).trim();
    }
    // Also support Bearer tokens if they match a 32-byte session token length (43+ chars)
    if (authHeader.startsWith('Bearer ') && !authHeader.substring(7).trim().startsWith('whkey_')) {
      return authHeader.substring(7).trim();
    }
  }
  if (req.headers['x-session-token']) {
    return req.headers['x-session-token'];
  }
  return null;
}

/**
 * Optional session authenticator - attaches user/tenant if valid session present, doesn't throw if absent.
 */
export async function optionalSessionAuth(req, res, next) {
  const token = extractSessionToken(req);
  if (!token) {
    return next();
  }

  try {
    const tokenHash = hashToken(token);
    const session = await sessionRepository.findActiveSession(tokenHash);
    if (!session || session.user_status === 'SUSPENDED') {
      return next();
    }

    req.user = {
      id: session.user_id,
      fullName: session.full_name,
      email: session.email,
      status: session.user_status,
    };

    // Determine target workspace
    const requestedTenantId =
      req.headers['x-tenant-id'] ||
      (req.cookies && req.cookies[WORKSPACE_COOKIE_NAME]) ||
      null;

    const workspaces = await workspaceMembershipRepository.findWorkspacesByUserId(session.user_id);
    if (workspaces.length > 0) {
      let targetWorkspace = workspaces[0];
      if (requestedTenantId) {
        const match = workspaces.find((w) => w.id === requestedTenantId);
        if (match) {
          targetWorkspace = match;
        }
      }
      req.tenantId = targetWorkspace.id;
      req[TENANT_ID_ATTRIBUTE] = targetWorkspace.id;
      req.tenant = { id: targetWorkspace.id, name: targetWorkspace.name };
      req.workspaceRole = targetWorkspace.role;
    }

    next();
  } catch (err) {
    logger.error('Error in optionalSessionAuth', { error: err.message });
    next();
  }
}

/**
 * Required session authenticator - enforces active browser session.
 */
export async function requireSessionAuth(req, res, next) {
  const token = extractSessionToken(req);
  if (!token) {
    return next(new UnauthorizedError('Authentication session required'));
  }

  try {
    const tokenHash = hashToken(token);
    const session = await sessionRepository.findActiveSession(tokenHash);

    if (!session) {
      return next(new UnauthorizedError('Session has expired or is invalid'));
    }

    if (session.user_status === 'SUSPENDED') {
      return next(new ForbiddenError('Account is suspended'));
    }

    req.user = {
      id: session.user_id,
      fullName: session.full_name,
      email: session.email,
      status: session.user_status,
    };

    // Resolve tenant/workspace
    const requestedTenantId =
      req.headers['x-tenant-id'] ||
      (req.cookies && req.cookies[WORKSPACE_COOKIE_NAME]) ||
      null;

    const workspaces = await workspaceMembershipRepository.findWorkspacesByUserId(session.user_id);
    if (workspaces.length === 0) {
      return next(new ForbiddenError('User has no authorized workspaces'));
    }

    let targetWorkspace = workspaces[0];
    if (requestedTenantId) {
      const match = workspaces.find((w) => w.id === requestedTenantId);
      if (!match) {
        return next(new ForbiddenError('Access to the requested workspace is unauthorized'));
      }
      targetWorkspace = match;
    }

    req.tenantId = targetWorkspace.id;
    req[TENANT_ID_ATTRIBUTE] = targetWorkspace.id;
    req.tenant = { id: targetWorkspace.id, name: targetWorkspace.name };
    req.workspaceRole = targetWorkspace.role;

    next();
  } catch (err) {
    next(err);
  }
}

export default {
  optionalSessionAuth,
  requireSessionAuth,
  extractSessionToken,
  SESSION_COOKIE_NAME,
  WORKSPACE_COOKIE_NAME,
};
