import { useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  DATA_RESOURCES,
  dataResourceIdField,
  getDataResource,
  groupedDataResources,
} from '@/config/data-resources'
import {
  useCreate,
  useDelete,
  useList,
  useUpdate,
  type CrudFilter,
  type HttpError,
} from '@refinedev/core'
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { ConfirmDialog } from '@/components/confirm-dialog'
import { AdminPage } from '@/components/layout/admin-page'

const PAGE_SIZE = 25
const MAX_COLUMNS = 8

type AdminRow = Record<string, unknown>

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function rowId(row: AdminRow, idField: string): string {
  const value = row[idField] ?? row.id
  return value === undefined || value === null ? '' : String(value)
}

const groups = groupedDataResources()

export function DataBrowser() {
  const search = useSearch({ from: '/_authenticated/data/' })
  const navigate = useNavigate()
  const permissions = useAuthStore(
    (state) => state.auth.user?.permissions ?? []
  )

  const resourceKey =
    search.resource && getDataResource(search.resource)
      ? search.resource
      : (DATA_RESOURCES[0]?.key ?? 'users')
  const descriptor = getDataResource(resourceKey)
  const readOnly = descriptor?.readOnly === true
  const canWrite = permissions.includes('data:write') && !readOnly
  const idField = descriptor ? dataResourceIdField(descriptor) : 'id'

  const [query, setQuery] = useState(search.q ?? '')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AdminRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminRow | null>(null)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)

  const filters: CrudFilter[] = [
    { field: 'q', operator: 'contains', value: search.q || undefined },
    { field: 'userId', operator: 'eq', value: search.userId || undefined },
  ].filter((filter) => filter.value !== undefined) as CrudFilter[]

  const { result, query: listQuery } = useList<AdminRow>({
    resource: resourceKey,
    pagination: { currentPage: search.page ?? 1, pageSize: PAGE_SIZE },
    filters,
    queryOptions: { retry: false },
  })
  const createRow = useCreate<AdminRow, HttpError, AdminRow>()
  const updateRow = useUpdate<AdminRow, HttpError, AdminRow>()
  const deleteRow = useDelete<AdminRow, HttpError>()

  const rows = useMemo(() => result.data ?? [], [result.data])
  const total = result.total ?? rows.length
  const page = search.page ?? 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const columns = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows.slice(0, 50))
      Object.keys(row).forEach((key) => keys.add(key))
    const priority = ['id', idField, 'userId', 'createdAt', 'updatedAt'].filter(
      (key) => keys.has(key)
    )
    const rest = [...keys].filter((key) => !priority.includes(key))
    return [...priority, ...rest].slice(0, MAX_COLUMNS)
  }, [rows, idField])

  const changeResource = (key: string) => {
    void navigate({ to: '/data', search: { resource: key } })
  }

  const applySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void navigate({
      to: '/data',
      search: {
        resource: resourceKey,
        q: query.trim() || undefined,
        userId: search.userId || undefined,
        page: 1,
      },
    })
  }

  const goToPage = (nextPage: number) => {
    void navigate({
      to: '/data',
      search: { ...search, resource: resourceKey, page: nextPage },
    })
  }

  const openCreate = () => {
    setDraft('{\n  \n}')
    setDraftError(null)
    setCreateOpen(true)
  }

  const openEdit = (row: AdminRow) => {
    setDraft(JSON.stringify(row, null, 2))
    setDraftError(null)
    setEditTarget(row)
  }

  const parseDraft = (): AdminRow | null => {
    try {
      const parsed: unknown = JSON.parse(draft)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setDraftError('Body must be a JSON object')
        return null
      }
      return parsed as AdminRow
    } catch {
      setDraftError('Invalid JSON')
      return null
    }
  }

  const saveCreate = () => {
    const body = parseDraft()
    if (!body) return
    createRow.mutate(
      { resource: resourceKey, values: body },
      {
        onSuccess: () => {
          toast.success('Row created')
          setCreateOpen(false)
        },
      }
    )
  }

  const saveEdit = () => {
    const body = parseDraft()
    if (!body || !editTarget) return
    updateRow.mutate(
      { resource: resourceKey, id: rowId(editTarget, idField), values: body },
      {
        onSuccess: () => {
          toast.success('Row updated')
          setEditTarget(null)
        },
      }
    )
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    deleteRow.mutate(
      { resource: resourceKey, id: rowId(deleteTarget, idField) },
      {
        onSuccess: () => {
          toast.success('Row deleted')
          setDeleteTarget(null)
        },
      }
    )
  }

  return (
    <AdminPage
      title='Data browser'
      description='Read every Lucent table; writes follow the per-resource allowlist'
      actions={
        <div className='flex items-center gap-2'>
          {readOnly && (
            <Badge variant='secondary' className='gap-1'>
              <Lock />
              Read-only
            </Badge>
          )}
          {canWrite && (
            <Button onClick={openCreate}>
              <Plus />
              New row
            </Button>
          )}
        </div>
      }
    >
      <Card>
        <CardContent className='py-4'>
          <form
            className='flex flex-wrap items-end gap-3'
            onSubmit={applySearch}
          >
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='data-resource'>
                Resource
              </label>
              <Select value={resourceKey} onValueChange={changeResource}>
                <SelectTrigger id='data-resource' className='w-72'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className='max-h-96'>
                  {groups.map((entry) => (
                    <SelectGroup key={entry.group}>
                      <SelectLabel>{entry.group}</SelectLabel>
                      {entry.resources.map((resource) => (
                        <SelectItem key={resource.key} value={resource.key}>
                          {resource.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='data-query'>
                Search
              </label>
              <Input
                id='data-query'
                value={query}
                maxLength={200}
                placeholder='Free text'
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button type='submit'>
              <Search />
              Apply
            </Button>
          </form>
          {search.userId && (
            <p className='mt-3 text-xs text-muted-foreground'>
              Filtered by user{' '}
              <span className='font-mono'>{search.userId}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <div className='overflow-hidden rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.length === 0 ? (
                <TableHead>Data</TableHead>
              ) : (
                columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))
              )}
              {canWrite && <TableHead className='w-24' />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className='h-24'>
                  <Skeleton className='mx-auto h-5 w-2/3' />
                </TableCell>
              </TableRow>
            ) : listQuery.isError ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  className='h-24 text-center text-destructive'
                >
                  Unable to load {descriptor?.label ?? resourceKey}.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  className='h-24 text-center text-muted-foreground'
                >
                  No rows found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                <TableRow key={rowId(row, idField) || index}>
                  {columns.map((column) => (
                    <TableCell key={column} className='max-w-72 truncate'>
                      {formatCell(row[column])}
                    </TableCell>
                  ))}
                  {canWrite && (
                    <TableCell>
                      <div className='flex justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Edit row'
                          onClick={() => openEdit(row)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Delete row'
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-between'>
        <p className='text-xs text-muted-foreground'>
          Page {page} of {totalPages} · {total.toLocaleString()} rows
        </p>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            <ChevronLeft />
            Previous
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      </div>

      <Dialog
        open={createOpen || editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false)
            setEditTarget(null)
          }
        }}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit row' : 'New row'}</DialogTitle>
            <DialogDescription>
              {descriptor?.label} — values are validated server-side against the
              resource allowlist.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='data-body'>Row JSON</Label>
            <Textarea
              id='data-body'
              className='min-h-72 font-mono text-xs'
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {draftError && (
              <p className='text-sm text-destructive'>{draftError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setCreateOpen(false)
                setEditTarget(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={editTarget ? saveEdit : saveCreate}
              disabled={
                createRow.mutation.isPending || updateRow.mutation.isPending
              }
            >
              {createRow.mutation.isPending || updateRow.mutation.isPending
                ? 'Saving…'
                : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title='Delete row?'
        desc='Soft-delete tables are stamped with deletedAt; others are removed.'
        destructive
        confirmText='Delete'
        isLoading={deleteRow.mutation.isPending}
        handleConfirm={confirmDelete}
      />
    </AdminPage>
  )
}
