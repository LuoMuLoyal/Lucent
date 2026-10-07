import { useCustom } from '@refinedev/core'
import { Activity, UserCheck, UserPlus, Users as UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

interface AdminMetrics {
  generatedAt: string
  users: {
    total: number
    active: number
    suspended: number
    newLast30Days: number
  }
  productEventsLast24Hours: number
}

export function Dashboard() {
  const { result, query } = useCustom<AdminMetrics>({
    url: '/admin/metrics/overview',
    method: 'get',
    queryOptions: { retry: false },
  })
  const metrics = result.data

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
            <h1 className='text-2xl font-bold tracking-tight'>Overview</h1>
            <p className='text-sm text-muted-foreground'>Platform activity</p>
          </div>
          {metrics && (
            <p className='text-xs text-muted-foreground'>
              Updated {new Date(metrics.generatedAt).toLocaleString()}
            </p>
          )}
        </div>

        {query.isError ? (
          <Card>
            <CardContent className='flex flex-wrap items-center justify-between gap-3 py-6'>
              <p className='text-sm text-destructive'>
                Unable to load administration metrics.
              </p>
              <Button variant='outline' onClick={() => void query.refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
            <MetricCard
              title='Total users'
              value={metrics?.users.total}
              icon={UsersIcon}
              loading={query.isLoading}
            />
            <MetricCard
              title='Active users'
              value={metrics?.users.active}
              icon={UserCheck}
              loading={query.isLoading}
            />
            <MetricCard
              title='New users · 30 days'
              value={metrics?.users.newLast30Days}
              icon={UserPlus}
              loading={query.isLoading}
            />
            <MetricCard
              title='Product events · 24 hours'
              value={metrics?.productEventsLast24Hours}
              icon={Activity}
              loading={query.isLoading}
            />
          </div>
        )}

        {metrics && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Account status</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 sm:grid-cols-2'>
              <div>
                <p className='text-sm text-muted-foreground'>Active</p>
                <p className='mt-1 text-xl font-semibold'>
                  {metrics.users.active.toLocaleString()}
                </p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Suspended</p>
                <p className='mt-1 text-xl font-semibold'>
                  {metrics.users.suspended.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}

interface MetricCardProps {
  title: string
  value: number | undefined
  icon: typeof UsersIcon
  loading: boolean
}

function MetricCard({ title, value, icon: Icon, loading }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        <Icon className='size-4 text-muted-foreground' aria-hidden='true' />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className='h-8 w-24' />
        ) : (
          <p className='text-2xl font-semibold tabular-nums'>
            {value?.toLocaleString() ?? '—'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
