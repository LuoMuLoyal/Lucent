import { redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Guards a route against the permissions Lucent returned from `GET /admin/me`.
 *
 * This only keeps unavailable screens out of the navigation; every admin API
 * enforces the same permission on the server.
 */
export function requirePermission(permission: string): void {
  const permissions = useAuthStore.getState().auth.user?.permissions ?? []
  if (!permissions.includes(permission)) {
    throw redirect({ to: '/403' })
  }
}
