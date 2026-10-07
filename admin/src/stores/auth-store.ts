import { create } from 'zustand'

const REFRESH_TOKEN = 'lucent_admin_refresh_token'

export interface AuthUser {
  id: string
  email: string
  nickname: string | null
  avatar: string | null
  role: string
  permissions: string[]
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    refreshToken: string
    setAccessToken: (accessToken: string) => void
    setTokens: (accessToken: string, refreshToken: string) => void
    resetAccessToken: () => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => {
  const refreshToken =
    typeof sessionStorage === 'undefined'
      ? ''
      : (sessionStorage.getItem(REFRESH_TOKEN) ?? '')

  return {
    auth: {
      user: null,
      setUser: (user) =>
        set((state) => ({ ...state, auth: { ...state.auth, user } })),
      accessToken: '',
      refreshToken,
      setAccessToken: (accessToken) =>
        set((state) => ({
          ...state,
          auth: { ...state.auth, accessToken },
        })),
      setTokens: (accessToken, refreshToken) =>
        set((state) => {
          sessionStorage.setItem(REFRESH_TOKEN, refreshToken)
          return {
            ...state,
            auth: { ...state.auth, accessToken, refreshToken },
          }
        }),
      resetAccessToken: () =>
        set((state) => ({
          ...state,
          auth: { ...state.auth, accessToken: '' },
        })),
      reset: () =>
        set((state) => {
          sessionStorage.removeItem(REFRESH_TOKEN)
          return {
            ...state,
            auth: {
              ...state.auth,
              user: null,
              accessToken: '',
              refreshToken: '',
            },
          }
        }),
    },
  }
})
