import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

const { navigate, login } = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
}))

vi.mock('@/providers/auth-provider', () => ({
  authProvider: { login },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => navigate }
})

describe('UserAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    login.mockResolvedValue({ success: true })
  })

  it('validates credentials and submits to the Lucent auth provider', async () => {
    const screen = await render(<UserAuthForm />)
    const email = screen.getByRole('textbox', { name: /^Email$/i })
    const password = screen.getByLabelText(/^Password$/i)
    const submit = screen.getByRole('button', { name: /^Sign in$/i })

    await userEvent.click(submit)
    await expect
      .element(screen.getByText('Please enter your email.'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Please enter your password.'))
      .toBeInTheDocument()

    await userEvent.fill(email, 'admin@example.com')
    await userEvent.fill(password, 'ValidPass123')
    await userEvent.click(submit)

    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce())
    expect(login).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'ValidPass123',
    })
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
    )
  })

  it('keeps redirects on-site after successful authentication', async () => {
    const screen = await render(<UserAuthForm redirectTo='/users' />)
    await userEvent.fill(
      screen.getByRole('textbox', { name: /^Email$/i }),
      'admin@example.com'
    )
    await userEvent.fill(screen.getByLabelText(/^Password$/i), 'ValidPass123')
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/i }))

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/users', replace: true })
    )
  })

  it('rejects an external redirect destination', async () => {
    const screen = await render(<UserAuthForm redirectTo='//example.com' />)
    await userEvent.fill(
      screen.getByRole('textbox', { name: /^Email$/i }),
      'admin@example.com'
    )
    await userEvent.fill(screen.getByLabelText(/^Password$/i), 'ValidPass123')
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/i }))

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
    )
  })
})
