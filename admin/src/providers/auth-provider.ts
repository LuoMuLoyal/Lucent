import type { AuthProvider } from '@refinedev/core'
import { useAuthStore } from '@/stores/auth-store'
import { api, getAdminIdentity, getApiErrorMessage } from '@/lib/lucent-api'

interface LoginParams {
  email: string
  password: string
}

interface LoginResponse {
  user: { id: string }
  tokens: { accessToken: string; refreshToken: string }
}

export const authProvider: AuthProvider = {
  login: async ({ email, password }: LoginParams) => {
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', {
        email,
        password,
      })
      useAuthStore
        .getState()
        .auth.setTokens(data.tokens.accessToken, data.tokens.refreshToken)

      const identity = await getAdminIdentity()
      useAuthStore.getState().auth.setUser(identity)
      return {
        success: true,
        redirectTo: '/',
        successNotification: {
          message: 'Signed in',
          description: `Welcome, ${identity.email}`,
        },
      }
    } catch (error) {
      useAuthStore.getState().auth.reset()
      return {
        success: false,
        error: new Error(getApiErrorMessage(error)),
      }
    }
  },
  logout: async () => {
    const { refreshToken } = useAuthStore.getState().auth
    try {
      if (refreshToken) {
        const { data } = await api.post<{
          accessToken: string
          refreshToken: string
        }>('/auth/refresh', { refreshToken })
        useAuthStore
          .getState()
          .auth.setTokens(data.accessToken, data.refreshToken)
        await api.post('/auth/logout', { refreshToken: data.refreshToken })
      }
    } catch {
      // Clear the local session even when the server cannot be reached.
    }
    useAuthStore.getState().auth.reset()
    return { success: true, redirectTo: '/sign-in' }
  },
  check: async () => {
    const { accessToken, refreshToken } = useAuthStore.getState().auth
    if (!accessToken && !refreshToken) {
      return { authenticated: false, redirectTo: '/sign-in' }
    }

    try {
      const identity = await getAdminIdentity()
      useAuthStore.getState().auth.setUser(identity)
      return { authenticated: true }
    } catch {
      useAuthStore.getState().auth.reset()
      return {
        authenticated: false,
        logout: true,
        redirectTo: '/sign-in',
      }
    }
  },
  onError: async (error) => {
    if (error?.response?.status === 401) {
      useAuthStore.getState().auth.reset()
      return { logout: true, redirectTo: '/sign-in' }
    }
    if (error?.response?.status === 403) {
      return { redirectTo: '/403' }
    }
    return {}
  },
  getIdentity: async () => {
    const identity = await getAdminIdentity()
    useAuthStore.getState().auth.setUser(identity)
    return identity
  },
  getPermissions: async () =>
    useAuthStore.getState().auth.user?.permissions ?? [],
}
