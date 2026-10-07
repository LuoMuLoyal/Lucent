import { useMemo, useState } from 'react'
import {
  useCreate,
  useDelete,
  useList,
  useUpdate,
  type HttpError,
} from '@refinedev/core'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Switch } from '@/components/ui/switch'
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

interface SafetyTip {
  id: string
  contentZh: string
  contentEn: string
  category: string
  sortOrder: number
  isActive: boolean
  updatedAt: string
}

interface SafetyTipFields {
  contentZh: string
  contentEn: string
  category: string
  sortOrder: number
  isActive: boolean
}

const categories = [
  'alcohol',
  'caffeine',
  'timing',
  'storage',
  'food',
  'pregnancy',
  'allergy',
  'driving',
] as const

const emptyFields: SafetyTipFields = {
  contentZh: '',
  contentEn: '',
  category: 'alcohol',
  sortOrder: 0,
  isActive: true,
}

export function SafetyTips() {
  const { result, query } = useList<SafetyTip>({
    resource: 'safety-tips',
    queryOptions: { retry: false },
  })
  const createTip = useCreate<SafetyTip, HttpError, SafetyTipFields>()
  const updateTip = useUpdate<SafetyTip, HttpError, SafetyTipFields>()
  const deleteTip = useDelete<SafetyTip, HttpError>()
  const [editingId, setEditingId] = useState<string | null | undefined>(
    undefined
  )
  const [deleteTarget, setDeleteTarget] = useState<SafetyTip | null>(null)
  const [fields, setFields] = useState(emptyFields)
  const tips = useMemo(
    () =>
      [...(result.data ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder
      ),
    [result.data]
  )

  const startCreate = () => {
    setFields(emptyFields)
    setEditingId(null)
  }

  const startEdit = (tip: SafetyTip) => {
    setFields({
      contentZh: tip.contentZh,
      contentEn: tip.contentEn,
      category: tip.category,
      sortOrder: tip.sortOrder,
      isActive: tip.isActive,
    })
    setEditingId(tip.id)
  }

  const saveTip = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const onSuccess = () => {
      toast.success(editingId ? 'Safety tip updated' : 'Safety tip created')
      setEditingId(undefined)
    }
    if (editingId) {
      updateTip.mutate(
        { resource: 'safety-tips', id: editingId, values: fields },
        { onSuccess }
      )
    } else {
      createTip.mutate(
        { resource: 'safety-tips', values: fields },
        { onSuccess }
      )
    }
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    deleteTip.mutate(
      { resource: 'safety-tips', id: deleteTarget.id },
      {
        onSuccess: () => {
          toast.success('Safety tip deleted')
          setDeleteTarget(null)
        },
      }
    )
  }

  const mutationPending =
    createTip.mutation.isPending || updateTip.mutation.isPending

  return (
    <AdminPage
      title='Safety tips'
      description='Bilingual medicine safety guidance'
      actions={
        <Button onClick={startCreate}>
          <Plus />
          Add tip
        </Button>
      }
    >
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chinese content</TableHead>
                <TableHead>English content</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='w-24' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className='h-20'>
                    <Skeleton className='mx-auto h-5 w-2/3' />
                  </TableCell>
                </TableRow>
              ) : query.isError ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='h-20 text-center text-destructive'
                  >
                    Unable to load safety tips.
                  </TableCell>
                </TableRow>
              ) : tips.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='h-20 text-center text-muted-foreground'
                  >
                    No safety tips found.
                  </TableCell>
                </TableRow>
              ) : (
                tips.map((tip) => (
                  <TableRow key={tip.id}>
                    <TableCell className='max-w-72 truncate'>
                      {tip.contentZh}
                    </TableCell>
                    <TableCell className='max-w-72 truncate'>
                      {tip.contentEn}
                    </TableCell>
                    <TableCell>{tip.category}</TableCell>
                    <TableCell className='tabular-nums'>
                      {tip.sortOrder}
                    </TableCell>
                    <TableCell>
                      {tip.isActive ? 'Active' : 'Inactive'}
                    </TableCell>
                    <TableCell>
                      <div className='flex justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Edit safety tip'
                          onClick={() => startEdit(tip)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Delete safety tip'
                          onClick={() => setDeleteTarget(tip)}
                        >
                          <Trash2 />
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

      <Dialog
        open={editingId !== undefined}
        onOpenChange={(open) => !open && setEditingId(undefined)}
      >
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit safety tip' : 'Add safety tip'}
            </DialogTitle>
          </DialogHeader>
          <form id='safety-tip-form' className='grid gap-4' onSubmit={saveTip}>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-2'>
                <Label htmlFor='tip-category'>Category</Label>
                <Select
                  value={fields.category}
                  onValueChange={(category) =>
                    setFields((current) => ({ ...current, category }))
                  }
                >
                  <SelectTrigger id='tip-category'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='tip-order'>Display order</Label>
                <Input
                  id='tip-order'
                  type='number'
                  min={0}
                  max={1000000}
                  value={fields.sortOrder}
                  onChange={(event) =>
                    setFields((current) => ({
                      ...current,
                      sortOrder: Number(event.target.value),
                    }))
                  }
                  required
                />
              </div>
            </div>
            <div className='grid gap-4 lg:grid-cols-2'>
              <div className='grid gap-2'>
                <Label htmlFor='tip-content-en'>Content (English)</Label>
                <Textarea
                  id='tip-content-en'
                  rows={7}
                  maxLength={10000}
                  value={fields.contentEn}
                  onChange={(event) =>
                    setFields((current) => ({
                      ...current,
                      contentEn: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='tip-content-zh'>Content (Chinese)</Label>
                <Textarea
                  id='tip-content-zh'
                  rows={7}
                  maxLength={10000}
                  value={fields.contentZh}
                  onChange={(event) =>
                    setFields((current) => ({
                      ...current,
                      contentZh: event.target.value,
                    }))
                  }
                  required
                />
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <Switch
                id='tip-active'
                checked={fields.isActive}
                onCheckedChange={(isActive) =>
                  setFields((current) => ({ ...current, isActive }))
                }
              />
              <Label htmlFor='tip-active'>Active</Label>
            </div>
          </form>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditingId(undefined)}>
              Cancel
            </Button>
            <Button
              type='submit'
              form='safety-tip-form'
              disabled={mutationPending}
            >
              {mutationPending ? 'Saving…' : 'Save tip'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title='Delete safety tip?'
        desc='This removes the tip from the active administration list.'
        destructive
        confirmText='Delete'
        isLoading={deleteTip.mutation.isPending}
        handleConfirm={confirmDelete}
      />
    </AdminPage>
  )
}
