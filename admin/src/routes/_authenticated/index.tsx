import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { Dashboard } from '@/features/dashboard'

export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: () => {
    const permissions = useAuthStore.getState().auth.user?.permissions ?? []
    if (!permissions.includes('metrics:read')) {
      throw redirect({ to: '/403' })
    }
  },
  component: Dashboard,
})
