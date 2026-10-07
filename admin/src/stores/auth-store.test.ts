import { clearCookies } from '@/test-utils/cookies'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function importAuthStore() {
  const { useAuthStore } = await import('./auth-store')
  return useAuthStore
}

const sampleUser = {
  id: 'admin-1',
  email: 'user@example.com',
  nickname: 'Admin',
  avatar: null,
  role: 'ADMIN',
  permissions: ['metrics:read'],
}

describe('useAuthStore', () => {
  beforeEach(() => {
    clearCookies()
    sessionStorage.clear()
    vi.resetModules()
  })

  it('starts with an empty access token when nothing is persisted', async () => {
    const useAuthStore = await importAuthStore()

    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(useAuthStore.getState().auth.refreshToken).toBe('')
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  it('does not persist the access token across reloads', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setAccessToken('session-token')

    vi.resetModules()
    const useAuthStoreAfterReload = await importAuthStore()

    expect(useAuthStoreAfterReload.getState().auth.accessToken).toBe('')
  })

  it('clears the in-memory access token when resetAccessToken is used', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setAccessToken('to-clear')
    useAuthStore.getState().auth.resetAccessToken()

    vi.resetModules()
    const useAuthStoreAfterReload = await importAuthStore()

    expect(useAuthStoreAfterReload.getState().auth.accessToken).toBe('')
  })

  it('updates the signed-in user via setUser', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setUser({ ...sampleUser })

    expect(useAuthStore.getState().auth.user).toEqual(sampleUser)
  })

  it('persists the rotated refresh token only in the current tab session', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setTokens('access-token', 'refresh-token')

    vi.resetModules()
    const useAuthStoreAfterReload = await importAuthStore()

    expect(useAuthStoreAfterReload.getState().auth.accessToken).toBe('')
    expect(useAuthStoreAfterReload.getState().auth.refreshToken).toBe(
      'refresh-token'
    )
  })

  it('clears the access and refresh tokens when reset is used', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore
      .getState()
      .auth.setTokens('will-be-cleared', 'refresh-to-clear')
    useAuthStore.getState().auth.setUser({ ...sampleUser })

    useAuthStore.getState().auth.reset()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(useAuthStore.getState().auth.refreshToken).toBe('')

    vi.resetModules()
    const useAuthStoreAfterReload = await importAuthStore()

    expect(useAuthStoreAfterReload.getState().auth.user).toBeNull()
    expect(useAuthStoreAfterReload.getState().auth.accessToken).toBe('')
    expect(useAuthStoreAfterReload.getState().auth.refreshToken).toBe('')
  })
})
