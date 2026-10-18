import { useMemo } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { getDataResource } from '@/config/data-resources'
import { useCustom, useOne } from '@refinedev/core'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminPage } from '@/components/layout/admin-page'

type Row = Record<string, unknown>

interface RelatedSection {
  resource: string
  items: Row[]
  total: number
}

interface RelatedGroup {
  key: string
  sections: RelatedSection[]
}

interface RelatedResponse {
  userId: string
  groups: RelatedGroup[]
}

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

const groupLabels: Record<string, string> = {
  account: 'Account',
  health: 'Health',
  medication: 'Medication',
  records: 'Records',
  events: 'Events',
  suggestions: 'Suggestions',
  assistant: 'Assistant',
  notifications: 'Notifications',
  privacy: 'Privacy',
  telemetry: 'Telemetry',
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function sectionColumns(items: Row[]): string[] {
  const keys = new Set<string>()
  for (const row of items.slice(0, 25))
    Object.keys(row).forEach((key) => keys.add(key))
  const priority = ['id', 'userId', 'createdAt'].filter((key) => keys.has(key))
  const rest = [...keys].filter((key) => !priority.includes(key))
  return [...priority, ...rest].slice(0, 5)
}

function labelFor(resource: string): string {
  return getDataResource(resource)?.label ?? resource
}

export function UserDetail() {
  const { id } = useParams({ from: '/_authenticated/users/$id' })
  const navigate = useNavigate()

  const { result: user, query: userQuery } = useOne<AdminUser>({
    resource: 'users',
    id,
    queryOptions: { retry: false },
  })
  const { result: relatedResult, query: relatedQuery } =
    useCustom<RelatedResponse>({
      url: `/admin/users/${id}/related`,
      method: 'get',
      queryOptions: { retry: false },
    })

  const groups = useMemo(
    () => relatedResult.data?.groups ?? [],
    [relatedResult.data]
  )
  const summary = useMemo(
    () => [
      ['Email', user?.email ?? '—'],
      ['Nickname', user?.nickname ?? '—'],
      ['Status', user?.status ?? '—'],
      ['Email verified', user?.emailVerified ? 'Yes' : 'No'],
      ['Admin role', user?.adminRole ?? '—'],
      ['Created', user ? new Date(user.createdAt).toLocaleString() : '—'],
      [
        'Last login',
        user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—',
      ],
    ],
    [user]
  )

  const openResource = (resource: string) => {
    void navigate({ to: '/data', search: { resource, userId: id } })
  }

  return (
    <AdminPage
      title={user ? (user.nickname ?? user.email) : 'User'}
      description={user ? user.email : id}
      actions={
        <Button variant='outline' asChild>
          <Link to='/users'>
            <ArrowLeft />
            Back to users
          </Link>
        </Button>
      }
    >
      <Card>
        <CardContent className='py-4'>
          {userQuery.isLoading ? (
            <Skeleton className='h-20 w-full' />
          ) : userQuery.isError || !user ? (
            <p className='text-destructive'>Unable to load this user.</p>
          ) : (
            <dl className='grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4'>
              {summary.map(([label, value]) => (
                <div key={label} className='grid gap-1'>
                  <dt className='text-xs text-muted-foreground'>{label}</dt>
                  <dd className='text-sm'>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      {relatedQuery.isLoading ? (
        <Skeleton className='h-64 w-full' />
      ) : relatedQuery.isError ? (
        <p className='text-destructive'>Unable to load related records.</p>
      ) : groups.length === 0 ? (
        <p className='text-muted-foreground'>No related records.</p>
      ) : (
        <Tabs defaultValue={groups[0]?.key}>
          <TabsList className='flex-wrap'>
            {groups.map((group) => (
              <TabsTrigger key={group.key} value={group.key}>
                {groupLabels[group.key] ?? group.key}
              </TabsTrigger>
            ))}
          </TabsList>
          {groups.map((group) => (
            <TabsContent
              key={group.key}
              value={group.key}
              className='grid gap-4'
            >
              {group.sections.map((section) => {
                const columns = sectionColumns(section.items)
                return (
                  <Card key={section.resource}>
                    <CardContent className='grid gap-3 py-4'>
                      <div className='flex items-center justify-between gap-2'>
                        <div className='flex items-center gap-2'>
                          <h2 className='text-sm font-semibold'>
                            {labelFor(section.resource)}
                          </h2>
                          <Badge variant='secondary'>
                            {section.total.toLocaleString()}
                          </Badge>
                        </div>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => openResource(section.resource)}
                        >
                          Browse all
                          <ExternalLink />
                        </Button>
                      </div>
                      {section.items.length === 0 ? (
                        <p className='text-sm text-muted-foreground'>
                          No records.
                        </p>
                      ) : (
                        <div className='overflow-hidden rounded-md border'>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {columns.map((column) => (
                                  <TableHead key={column}>{column}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {section.items.map((row, index) => (
                                <TableRow key={String(row.id ?? index)}>
                                  {columns.map((column) => (
                                    <TableCell
                                      key={column}
                                      className='max-w-64 truncate'
                                    >
                                      {formatCell(row[column])}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </AdminPage>
  )
}
