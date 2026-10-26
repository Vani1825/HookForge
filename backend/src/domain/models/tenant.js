/**
 * Tenant domain model.
 * Immutable POJO representing a tenant.
 */

import { v4 as uuidv4 } from 'uuid';

export function createTenant(data = {}) {
  return Object.freeze({
    id: data.id || uuidv4(),
    name: data.name,
  });
}

export default { createTenant };
