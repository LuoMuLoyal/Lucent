import { useList } from '@refinedev/core'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

interface AdminUser {
  id: string
  email: string
  nickname: string | null
  status: string
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
  adminRole: string | null
}

export function Users() {
  const { result, query } = useList<AdminUser>({
    resource: 'users',
    pagination: { currentPage: 1, pageSize: 50 },
    queryOptions: { retry: false },
  })
  const users = result.data ?? []

  return (
    <>
      <Header fixed>
        <div className='me-auto text-sm font-medium'>Lucent Admin</div>
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Users</h1>
            <p className='text-sm text-muted-foreground'>Account summaries</p>
          </div>
          <Button variant='outline' onClick={() => void query.refetch()}>
            Refresh
          </Button>
        </div>

        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Admin role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24'>
                    <Skeleton className='mx-auto h-5 w-2/3' />
                  </TableCell>
                </TableRow>
              ) : query.isError ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='h-24 text-center text-destructive'
                  >
                    Unable to load users.
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='h-24 text-center text-muted-foreground'
                  >
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className='font-medium'>{user.email}</TableCell>
                    <TableCell>{user.nickname ?? '—'}</TableCell>
                    <TableCell>{user.status}</TableCell>
                    <TableCell>{user.emailVerified ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{user.adminRole ?? '—'}</TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className='text-xs text-muted-foreground'>
          {(result.total ?? users.length).toLocaleString()} accounts · first 50
          shown
        </p>
      </Main>
    </>
  )
}
