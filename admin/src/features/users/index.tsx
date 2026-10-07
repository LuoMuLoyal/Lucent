import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useList, type CrudFilter } from '@refinedev/core'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AdminPage } from '@/components/layout/admin-page'

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
  const search = useSearch({ from: '/_authenticated/users/' })
  const navigate = useNavigate()
  const [query, setQuery] = useState(search.q ?? '')
  const [status, setStatus] = useState<string>(search.status ?? 'all')

  const filters = [
    { field: 'q', operator: 'contains', value: search.q || undefined },
    {
      field: 'status',
      operator: 'eq',
      value: search.status ?? undefined,
    },
  ].filter((filter) => filter.value !== undefined) as CrudFilter[]

  const { result, query: listQuery } = useList<AdminUser>({
    resource: 'users',
    pagination: { currentPage: 1, pageSize: 50 },
    filters,
    queryOptions: { retry: false },
  })
  const users = result.data ?? []

  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void navigate({
      to: '/users',
      search: {
        q: query.trim() || undefined,
        status:
          status === 'all' ? undefined : (status as 'active' | 'suspended'),
      },
    })
  }

  return (
    <AdminPage
      title='Users'
      description='Account summaries from Lucent'
      actions={
        <Button variant='outline' onClick={() => void listQuery.refetch()}>
          <RefreshCw />
          Refresh
        </Button>
      }
    >
      <Card>
        <CardContent className='py-4'>
          <form
            className='flex flex-wrap items-end gap-3'
            onSubmit={applyFilters}
          >
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='user-query'>
                Search
              </label>
              <Input
                id='user-query'
                value={query}
                maxLength={120}
                placeholder='Email or nickname'
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='user-status'>
                Status
              </label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id='user-status' className='w-40'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All</SelectItem>
                  <SelectItem value='active'>Active</SelectItem>
                  <SelectItem value='suspended'>Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type='submit'>
              <Search />
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

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
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className='h-24'>
                  <Skeleton className='mx-auto h-5 w-2/3' />
                </TableCell>
              </TableRow>
            ) : listQuery.isError ? (
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
        Showing {users.length} of{' '}
        {(result.total ?? users.length).toLocaleString()} accounts
      </p>
    </AdminPage>
  )
}
