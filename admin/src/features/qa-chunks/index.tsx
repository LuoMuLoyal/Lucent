import { useState } from 'react'
import { useList, useUpdate, type HttpError } from '@refinedev/core'
import { Pencil, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Textarea } from '@/components/ui/textarea'
import { AdminPage } from '@/components/layout/admin-page'

interface QaChunk {
  id: string
  qaId: string
  question: string
  answer: string
  safetyLabel: SafetyLabel
  updatedAt: string
}

type SafetyLabel = 'safe' | 'caution' | 'blocked'

interface QaChunkFields {
  question: string
  answer: string
  safetyLabel: SafetyLabel
}

const safetyLabels = ['safe', 'caution', 'blocked'] as const

const pageSize = 25

const labelVariants: Record<
  SafetyLabel,
  'default' | 'secondary' | 'destructive'
> = {
  safe: 'secondary',
  caution: 'default',
  blocked: 'destructive',
}

export function QaChunks() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [safetyLabel, setSafetyLabel] = useState<SafetyLabel | 'all'>('all')
  const [editing, setEditing] = useState<QaChunk | null>(null)
  const [fields, setFields] = useState<QaChunkFields>({
    question: '',
    answer: '',
    safetyLabel: 'safe',
  })

  const { result, query: listQuery } = useList<QaChunk>({
    resource: 'qa-chunks',
    pagination: { currentPage: page, pageSize },
    filters: [
      ...(query
        ? [{ field: 'q', operator: 'contains' as const, value: query }]
        : []),
      ...(safetyLabel === 'all'
        ? []
        : [
            {
              field: 'safetyLabel',
              operator: 'eq' as const,
              value: safetyLabel,
            },
          ]),
    ],
    queryOptions: { retry: false },
  })
  const updateChunk = useUpdate<QaChunk, HttpError, QaChunkFields>()
  const chunks = result.data ?? []
  const total = result.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const applySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setQuery(search.trim())
  }

  const startEdit = (chunk: QaChunk) => {
    setFields({
      question: chunk.question,
      answer: chunk.answer,
      safetyLabel: chunk.safetyLabel,
    })
    setEditing(chunk)
  }

  const saveChunk = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    updateChunk.mutate(
      { resource: 'qa-chunks', id: editing.id, values: fields },
      {
        onSuccess: () => {
          toast.success('QA chunk updated')
          setEditing(null)
        },
      }
    )
  }

  return (
    <AdminPage
      title='QA corpus'
      description='Assistant open medical Q&A chunks'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <form className='flex flex-1 items-center gap-2' onSubmit={applySearch}>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Search question, answer or qa id'
            className='max-w-sm'
          />
          <Button type='submit' variant='outline'>
            <Search />
            Search
          </Button>
        </form>
        <Select
          value={safetyLabel}
          onValueChange={(value) => {
            setPage(1)
            setSafetyLabel(value as SafetyLabel | 'all')
          }}
        >
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All labels</SelectItem>
            {safetyLabels.map((label) => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-40'>QA id</TableHead>
                <TableHead>Question</TableHead>
                <TableHead className='w-28'>Safety</TableHead>
                <TableHead className='w-44'>Updated</TableHead>
                <TableHead className='w-16' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className='h-20'>
                    <Skeleton className='mx-auto h-5 w-2/3' />
                  </TableCell>
                </TableRow>
              ) : listQuery.isError ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='h-20 text-center text-destructive'
                  >
                    Unable to load QA chunks.
                  </TableCell>
                </TableRow>
              ) : chunks.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='h-20 text-center text-muted-foreground'
                  >
                    No QA chunks found.
                  </TableCell>
                </TableRow>
              ) : (
                chunks.map((chunk) => (
                  <TableRow key={chunk.id}>
                    <TableCell className='font-mono text-xs'>
                      {chunk.qaId}
                    </TableCell>
                    <TableCell className='max-w-96 truncate'>
                      {chunk.question}
                    </TableCell>
                    <TableCell>
                      <Badge variant={labelVariants[chunk.safetyLabel]}>
                        {chunk.safetyLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      {new Date(chunk.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className='flex justify-end'>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Edit QA chunk'
                          onClick={() => startEdit(chunk)}
                        >
                          <Pencil />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className='flex items-center justify-between gap-2 text-sm text-muted-foreground'>
        <span>
          {total.toLocaleString()} chunk{total === 1 ? '' : 's'} · page {page}{' '}
          of {pageCount}
        </span>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>Edit QA chunk</DialogTitle>
          </DialogHeader>
          <Alert>
            <AlertTitle>Retrieval index is not updated</AlertTitle>
            <AlertDescription>
              Edits are stored in the database only. The assistant reads the
              LightRAG <code>qa</code> workspace, so run the corpus index
              rebuild to make changes searchable; re-importing the corpus
              overwrites this row.
            </AlertDescription>
          </Alert>
          <form id='qa-chunk-form' className='grid gap-4' onSubmit={saveChunk}>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-2'>
                <Label htmlFor='qa-chunk-id'>QA id</Label>
                <Input
                  id='qa-chunk-id'
                  value={editing?.qaId ?? ''}
                  readOnly
                  disabled
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='qa-chunk-safety'>Safety label</Label>
                <Select
                  value={fields.safetyLabel}
                  onValueChange={(value) =>
                    setFields((current) => ({
                      ...current,
                      safetyLabel: value as SafetyLabel,
                    }))
                  }
                >
                  <SelectTrigger id='qa-chunk-safety'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {safetyLabels.map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='qa-chunk-question'>Question</Label>
              <Textarea
                id='qa-chunk-question'
                rows={3}
                maxLength={5000}
                value={fields.question}
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    question: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='qa-chunk-answer'>Answer</Label>
              <Textarea
                id='qa-chunk-answer'
                rows={12}
                className='font-mono text-xs'
                value={fields.answer}
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    answer: event.target.value,
                  }))
                }
                required
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type='submit'
              form='qa-chunk-form'
              disabled={updateChunk.mutation.isPending}
            >
              {updateChunk.mutation.isPending ? 'Saving…' : 'Save chunk'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
