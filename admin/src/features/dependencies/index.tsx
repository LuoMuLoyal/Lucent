import { useCustom } from '@refinedev/core'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminPage } from '@/components/layout/admin-page'

interface DependencyStatus {
  enabled: boolean
}

interface Dependencies {
  lightrag: DependencyStatus
  semantica: DependencyStatus
  generatedAt: string
}

const dependencies: Array<{
  key: keyof Omit<Dependencies, 'generatedAt'>
  title: string
  detail: string
}> = [
  {
    key: 'lightrag',
    title: 'LightRAG',
    detail: 'Graph retrieval sidecar behind the assistant (LIGHTRAG_ENABLED).',
  },
  {
    key: 'semantica',
    title: 'Semantica',
    detail: 'Ontology / medicine knowledge sidecar (SEMANTICA_ENABLED).',
  },
]

/**
 * True once every sidecar section is present. Refine hands `result.data` an
 * empty object until the query resolves (see the dashboard), so the declared
 * type is the partial snapshot: without this guard `status[key].enabled` throws
 * on the first render and on any failed request, and the root error boundary
 * turns that into the 500 page instead of the error card below.
 */
function isDependencyStatus(
  value: Partial<Dependencies>
): value is Dependencies {
  return (
    value.lightrag !== undefined &&
    value.semantica !== undefined &&
    value.generatedAt !== undefined
  )
}

export function Dependencies() {
  const { result, query } = useCustom<Partial<Dependencies>>({
    url: '/admin/dependencies',
    method: 'get',
    queryOptions: { retry: false },
  })
  const status = isDependencyStatus(result.data) ? result.data : undefined

  return (
    <AdminPage
      title='Dependencies'
      description='Read-only sidecar enablement for this deployment'
      actions={
        <Button variant='outline' onClick={() => void query.refetch()}>
          <RefreshCw />
          Refresh
        </Button>
      }
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        {dependencies.map((dependency) => (
          <Card key={dependency.key}>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-base'>{dependency.title}</CardTitle>
              {query.isLoading || !status ? (
                <Skeleton className='h-5 w-16' />
              ) : (
                <Badge
                  variant={
                    status[dependency.key].enabled ? 'secondary' : 'destructive'
                  }
                >
                  {status[dependency.key].enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <p className='text-sm text-muted-foreground'>
                {dependency.detail}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {query.isError && (
        <Card>
          <CardContent className='py-6 text-sm text-destructive'>
            Unable to load dependency status.
          </CardContent>
        </Card>
      )}

      {status && (
        <p className='text-xs text-muted-foreground'>
          Read from the runtime config snapshot at request time (environment
          fallback) · {new Date(status.generatedAt).toLocaleString()}
        </p>
      )}
    </AdminPage>
  )
}
