import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

const apiUrl =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '/api/v1'

export const api = axios.create({ baseURL: apiUrl })

let refreshRequest: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = useAuthStore.getState().auth.refreshToken
  if (!refreshToken) throw new Error('Admin session is not available')

  if (!refreshRequest) {
    refreshRequest = axios
      .post<{ accessToken: string; refreshToken: string; expiresIn: number }>(
        `${apiUrl}/auth/refresh`,
        { refreshToken }
      )
      .then(({ data }) => {
        useAuthStore
          .getState()
          .auth.setTokens(data.accessToken, data.refreshToken)
        return data.accessToken
      })
      .finally(() => {
        refreshRequest = null
      })
  }

  return refreshRequest
}

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as
      | (InternalAxiosRequestConfig & { _adminRetried?: boolean })
      | undefined
    const url = request?.url ?? ''

    if (
      error.response?.status !== 401 ||
      !request ||
      request._adminRetried ||
      url.includes('/auth/login') ||
      url.includes('/auth/refresh')
    ) {
      return Promise.reject(error)
    }

    request._adminRetried = true
    try {
      const token = await refreshAccessToken()
      request.headers.Authorization = `Bearer ${token}`
      return await api(request)
    } catch (refreshError) {
      useAuthStore.getState().auth.reset()
      return Promise.reject(refreshError)
    }
  }
)

export type AdminIdentity = AuthUser

export async function getAdminIdentity(): Promise<AdminIdentity> {
  const { data } = await api.get<AdminIdentity>('/admin/me')
  return data
}

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      | { detail?: string; message?: string; title?: string }
      | undefined
    return body?.detail ?? body?.message ?? body?.title ?? error.message
  }
  return error instanceof Error ? error.message : 'Request failed'
}
