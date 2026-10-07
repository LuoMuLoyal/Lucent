import { useList } from '@refinedev/core'
import { RefreshCw } from 'lucide-react'
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
import { AdminPage } from '@/components/layout/admin-page'

interface AuditLog {
  id: string
  actorUserId: string
  action: string
  resourceType: string | null
  resourceId: string | null
  createdAt: string
}

export function AuditLogs() {
  const { result, query } = useList<AuditLog>({
    resource: 'audit-logs',
    pagination: { currentPage: 1, pageSize: 50 },
    queryOptions: { retry: false },
  })
  const logs = result.data ?? []

  return (
    <AdminPage
      title='Audit logs'
      description='Recent privileged administration actions'
      actions={
        <Button variant='outline' onClick={() => void query.refetch()}>
          <RefreshCw />
          Refresh
        </Button>
      }
    >
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Resource ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className='h-20'>
                    <Skeleton className='mx-auto h-5 w-2/3' />
                  </TableCell>
                </TableRow>
              ) : query.isError ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='h-20 text-center text-destructive'
                  >
                    Unable to load audit logs.
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='h-20 text-center text-muted-foreground'
                  >
                    No audit events found.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className='whitespace-nowrap'>
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {log.actorUserId}
                    </TableCell>
                    <TableCell className='font-medium'>{log.action}</TableCell>
                    <TableCell>{log.resourceType ?? '—'}</TableCell>
                    <TableCell className='font-mono text-xs'>
                      {log.resourceId ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className='text-xs text-muted-foreground'>
        Showing {logs.length} of{' '}
        {(result.total ?? logs.length).toLocaleString()} events (latest 50).
      </p>
    </AdminPage>
  )
}
