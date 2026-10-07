# Shadcn Admin Dashboard

> Vendored from `satnaing/shadcn-admin` at upstream commit `e16c87f`. This is an independent pnpm workspace under `Lucent/admin`, not a member of the Lucent backend workspace. Run `pnpm install` and `pnpm build` from this directory.

Admin Dashboard UI crafted with Shadcn and Vite. Built with responsiveness and accessibility in mind.

![alt text](public/images/shadcn-admin.png)

[![Sponsored by Clerk](https://img.shields.io/badge/Sponsored%20by-Clerk-5b6ee1?logo=clerk)](https://go.clerk.com/GttUAaK)

I've been creating dashboard UIs at work and for my personal projects. I always wanted to make a reusable collection of dashboard UI for future projects; and here it is now. While I've created a few custom components, some of the code is directly adapted from ShadcnUI examples.

> This is not a starter project (template) though. I'll probably make one in the future.

## Features

- Light/dark mode
- Responsive
- Accessible
- With built-in Sidebar component
- Global search command
- 10+ pages
- Extra custom components
- RTL support

<details>
<summary>Customized Components (click to expand)</summary>

This project uses Shadcn UI components, but some have been slightly modified for better RTL (Right-to-Left) support and other improvements. These customized components differ from the original Shadcn UI versions.

If you want to update components using the Shadcn CLI (e.g., `npx shadcn@latest add <component>`), it's generally safe for non-customized components. For the listed customized ones, you may need to manually merge changes to preserve the project's modifications and avoid overwriting RTL support or other updates.

> If you don't require RTL support, you can safely update the 'RTL Updated Components' via the Shadcn CLI, as these changes are primarily for RTL compatibility. The 'Modified Components' may have other customizations to consider.

### Modified Components

- scroll-area
- sonner
- separator

### RTL Updated Components

- alert-dialog
- calendar
- command
- dialog
- dropdown-menu
- select
- table
- sheet
- sidebar
- switch

**Notes:**

- **Modified Components**: These have general updates, potentially including RTL adjustments.
- **RTL Updated Components**: These have specific changes for RTL language support (e.g., layout, positioning).
- For implementation details, check the source files in `src/components/ui/`.
- All other Shadcn UI components in the project are standard and can be safely updated via the CLI.

</details>

## Tech Stack

**UI:** [ShadcnUI](https://ui.shadcn.com) (TailwindCSS + RadixUI)

**Build Tool:** [Vite](https://vitejs.dev/)

**Routing:** [TanStack Router](https://tanstack.com/router/latest)

**Type Checking:** [TypeScript](https://www.typescriptlang.org/)

**Linting/Formatting:** [ESLint](https://eslint.org/) & [Prettier](https://prettier.io/)

**Icons:** [Lucide Icons](https://lucide.dev/icons/), [Tabler Icons](https://tabler.io/icons) (Brand icons only)

**Auth:** Lucent JWT session with server-side AdminRole permissions

## Development

Run commands from `Lucent/admin`; this project is intentionally independent of the backend pnpm workspace.

```powershell
pnpm install --frozen-lockfile
$env:VITE_API_BASE_URL = 'http://localhost:3000/api/v1'
pnpm dev
```

`VITE_API_BASE_URL` defaults to `/api/v1`, which is appropriate when the panel and API are served from the same origin. For local development, point it at the running Lucent API and allow the Vite origin in the backend CORS configuration.

Build and lint from the same directory:

```powershell
pnpm build
pnpm lint
```

The panel authenticates against Lucent `POST /api/v1/auth/login` and `GET /api/v1/admin/me`. Access tokens stay in memory; refresh tokens are scoped to the current tab session. Admin permissions are enforced by Lucent on every API request. The frontend hides unavailable navigation, but it is not an authorization boundary.

## Production Mount Point

The SPA is served by the Lucent backend at `/admin` from the same origin as the API. Two settings must stay aligned with `ADMIN_CONSOLE_ROOT_PATH` in `Lucent/src/admin-console/constants/console.constants.ts`:

- `base: '/admin/'` in `vite.config.ts` — makes Vite emit `/admin/assets/*` URLs.
- `basepath: '/admin'` on the router in `src/main.tsx` — makes client-side links resolve under the mount point.

`Lucent/Dockerfile` builds this project in its own stage and copies `admin/dist` into the image; `ADMIN_CONSOLE_DIR` overrides the directory the backend reads.

## Screens

Screens backed by a Lucent endpoint are overview metrics, users, audit logs, legal documents, and safety tips. They sit under the `Administration` and `Content` sidebar groups, and each entry is hidden when the signed-in administrator lacks the permission its endpoint requires.

The upstream template pages (`apps`, `chats`, `tasks`, `settings/*`, `help-center`, the Clerk demo group, and the template `sign-up` / `otp` / `forgot-password` / `sign-in-2` forms) are kept and routed for reference and reuse, and are listed under the `Template` and `Template · Forms` sidebar groups. They render template or placeholder data and have no Lucent API behind them, so a template page can open while showing nothing real. They are not an authentication path into the console: the console session comes only from Lucent `POST /api/v1/auth/login`, and every admin API decides authorization server-side.

The template error pages are linked at their real paths (`/401`, `/403`, `/404`, `/500`, `/503`). Upstream pointed them at `/errors/*`, which no route serves.

## Sponsoring this project ❤️

If you find this project helpful or use this in your own work, consider [sponsoring me](https://github.com/sponsors/satnaing) to support development and maintenance. You can [buy me a coffee](https://buymeacoffee.com/satnaing) as well. Don’t worry, every penny helps. Thank you! 🙏

For questions or sponsorship inquiries, feel free to reach out at [satnaingdev@gmail.com](mailto:satnaingdev@gmail.com).

### Current Sponsor

- [Clerk](https://go.clerk.com/GttUAaK) - authentication and user management for the modern web

## Author

Crafted with 🤍 by [@satnaing](https://github.com/satnaing)

## License

Licensed under the [MIT License](https://choosealicense.com/licenses/mit/)
