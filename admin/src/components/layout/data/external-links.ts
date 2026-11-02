import type { NavItem } from '../types'

/**
 * Resolves the href for an `external` nav entry.
 *
 * The queue panel (`/admin/queues`, bull-board) serves its own UI and API calls,
 * so it cannot attach the SPA's `Authorization` header. The backend accepts
 * `?access_token=<jwt>` once and immediately swaps it for a `Path=/admin/queues`
 * HttpOnly cookie (see `src/modules/admin/README.md`, 队列面板), which is the
 * only way that panel can authenticate. Entries declaring
 * `externalAuth: 'accessToken'` get the token appended.
 *
 * The token handed over is the one currently in memory. Admin API calls refresh
 * it on a 401, so the handshake only misses for a console tab that sat idle past
 * `JWT_ACCESS_TTL` — reopening the panel after any page interaction works.
 */
export function externalNavHref(
  item: NavItem,
  accessToken: string
): string | undefined {
  if (item.external === undefined) return undefined
  if (item.externalAuth !== 'accessToken' || accessToken === '') {
    return item.external
  }
  const separator = item.external.includes('?') ? '&' : '?'
  return `${item.external}${separator}access_token=${encodeURIComponent(accessToken)}`
}
