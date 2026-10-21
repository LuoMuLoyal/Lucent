/**
 * Cache vocabulary shared by the application and infrastructure layers.
 * The header constant is consumed by the HTTP adapter, the key prefix by the
 * cache implementations — both live here so no direct adapters→infrastructure
 * import is needed.
 */

export const MEDICINES_BYPASS_CACHE_HEADER = 'x-bypass-cache';
export const MEDICINES_CACHE_KEY_PREFIX = 'medicines';
