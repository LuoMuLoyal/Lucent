import { useState } from 'react'
import { useCustom } from '@refinedev/core'
import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

interface FunnelTotals {
  eventStarted: number
  suggestionImpression: number
  suggestionActioned: number
  eventEndedOrOutcome: number
  reviewOpened: number
}

interface FunnelOptionalCounts {
  visitSummaryPreviewed: number
  visitSummaryExported: number
  visitSummaryShareCreated: number
  visitSummaryShareOpened: number
}

interface FunnelDaily extends FunnelTotals {
  date: string
}

interface FunnelData {
  daily: FunnelDaily[]
  optional: FunnelOptionalCounts
  totals: FunnelTotals
  window: {
    dateFrom: string
    dateTo: string
    generatedAt: string
    detailsSuppressed: boolean
  }
}

const stages: Array<{ key: keyof FunnelTotals; label: string }> = [
  { key: 'eventStarted', label: 'Event started' },
  { key: 'suggestionImpression', label: 'Suggestion impression' },
  { key: 'suggestionActioned', label: 'Suggestion actioned' },
  { key: 'eventEndedOrOutcome', label: 'Event ended / outcome' },
  { key: 'reviewOpened', label: 'Review opened' },
]

const optionalStages: Array<{
  key: keyof FunnelOptionalCounts
  label: string
}> = [
  { key: 'visitSummaryPreviewed', label: 'Summary previewed' },
  { key: 'visitSummaryExported', label: 'Summary exported' },
  { key: 'visitSummaryShareCreated', label: 'Share created' },
  { key: 'visitSummaryShareOpened', label: 'Share opened' },
]

/** Percentage of the first stage that reached a later stage. */
function conversion(value: number, baseline: number): string {
  if (baseline === 0) return '—'
  return `${((value / baseline) * 100).toFixed(1)}%`
}

export function MetricsFunnel() {
  const [draft, setDraft] = useState({ dateFrom: '', dateTo: '' })
  const [range, setRange] = useState<{ dateFrom?: string; dateTo?: string }>({})

  const { result, query } = useCustom<FunnelData>({
    url: '/admin/metrics/funnel',
    method: 'get',
    config: { query: range },
    queryOptions: { retry: false },
  })
  const funnel = result.data
  const totals = funnel?.totals
  const baseline = totals?.eventStarted ?? 0

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRange({
      ...(draft.dateFrom ? { dateFrom: draft.dateFrom } : {}),
      ...(draft.dateTo ? { dateTo: draft.dateTo } : {}),
    })
  }

  const reset = () => {
    setDraft({ dateFrom: '', dateTo: '' })
    setRange({})
  }

  return (
    <AdminPage
      title='Product funnel'
      description='Core product loop per UTC calendar day (counts only)'
      actions={
        <Button variant='outline' onClick={() => void query.refetch()}>
          <RefreshCw />
          Refresh
        </Button>
      }
    >
      <form
        className='flex flex-wrap items-end gap-2'
        onSubmit={apply}
        onReset={reset}
      >
        <div className='grid gap-2'>
          <Label htmlFor='funnel-from'>From</Label>
          <Input
            id='funnel-from'
            type='date'
            value={draft.dateFrom}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                dateFrom: event.target.value,
              }))
            }
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='funnel-to'>To</Label>
          <Input
            id='funnel-to'
            type='date'
            value={draft.dateTo}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                dateTo: event.target.value,
              }))
            }
          />
        </div>
        <Button type='submit'>Apply</Button>
        <Button type='reset' variant='ghost'>
          Last 30 days
        </Button>
      </form>

      {query.isError ? (
        <Card>
          <CardContent className='py-6 text-sm text-destructive'>
            Unable to load the funnel. Check the window (both dates, at most 30
            days) and retry.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
            {stages.map((stage) => (
              <Card key={stage.key}>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>
                    {stage.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {query.isLoading || !totals ? (
                    <Skeleton className='h-8 w-20' />
                  ) : (
                    <>
                      <p className='text-2xl font-semibold tabular-nums'>
                        {totals[stage.key].toLocaleString()}
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {conversion(totals[stage.key], baseline)} of started
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {funnel && (
            <p className='text-xs text-muted-foreground'>
              Window {funnel.window.dateFrom} → {funnel.window.dateTo} ·
              generated {new Date(funnel.window.generatedAt).toLocaleString()}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>
                Optional visit-summary events
              </CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
              {optionalStages.map((stage) => (
                <div key={stage.key}>
                  <p className='text-sm text-muted-foreground'>{stage.label}</p>
                  <p className='mt-1 text-xl font-semibold tabular-nums'>
                    {funnel
                      ? funnel.optional[stage.key].toLocaleString()
                      : '\u2014'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {funnel?.window.detailsSuppressed === true && (
            <Alert>
              <AlertTitle>Daily details suppressed</AlertTitle>
              <AlertDescription>
                The window total is below the small-sample threshold, so per-day
                counts are hidden. Window totals above are still accurate.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day (UTC)</TableHead>
                    {stages.map((stage) => (
                      <TableHead key={stage.key}>{stage.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className='h-20'>
                        <Skeleton className='mx-auto h-5 w-2/3' />
                      </TableCell>
                    </TableRow>
                  ) : (funnel?.daily ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className='h-20 text-center text-muted-foreground'
                      >
                        No per-day rows for this window.
                      </TableCell>
                    </TableRow>
                  ) : (
                    funnel?.daily.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className='whitespace-nowrap'>
                          {day.date}
                        </TableCell>
                        {stages.map((stage) => (
                          <TableCell key={stage.key} className='tabular-nums'>
                            {day[stage.key].toLocaleString()}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </AdminPage>
  )
}
