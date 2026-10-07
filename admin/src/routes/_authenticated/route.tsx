import { createFileRoute, redirect } from '@tanstack/react-router'
import { authProvider } from '@/providers/auth-provider'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const result = await authProvider.check()
    if (!result.authenticated) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      })
    }
  },
  component: AuthenticatedLayout,
})
