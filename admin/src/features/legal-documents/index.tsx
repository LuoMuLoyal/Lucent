import { useState } from 'react'
import { useList, useUpdate, type HttpError } from '@refinedev/core'
import { Pencil } from 'lucide-react'
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
import { AdminPage } from '@/components/layout/admin-page'

interface LegalDocument {
  id: string
  docType: string
  titleZh: string
  titleEn: string
  contentZh: string
  contentEn: string
  isActive: boolean
  updatedAt: string
}

interface LegalDocumentFields {
  titleZh: string
  titleEn: string
  contentZh: string
  contentEn: string
  isActive: boolean
}

const emptyFields: LegalDocumentFields = {
  titleZh: '',
  titleEn: '',
  contentZh: '',
  contentEn: '',
  isActive: false,
}

export function LegalDocuments() {
  const { result, query } = useList<LegalDocument>({
    resource: 'legal-documents',
    queryOptions: { retry: false },
  })
  const updateDocument = useUpdate<
    LegalDocument,
    HttpError,
    LegalDocumentFields
  >()
  const [selected, setSelected] = useState<LegalDocument | null>(null)
  const [fields, setFields] = useState(emptyFields)
  const documents = result.data ?? []

  const editDocument = (document: LegalDocument) => {
    setSelected(document)
    setFields({
      titleZh: document.titleZh,
      titleEn: document.titleEn,
      contentZh: document.contentZh,
      contentEn: document.contentEn,
      isActive: document.isActive,
    })
  }

  const saveDocument = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    updateDocument.mutate(
      { resource: 'legal-documents', id: selected.id, values: fields },
      {
        onSuccess: () => {
          toast.success('Legal document updated')
          setSelected(null)
        },
      }
    )
  }

  return (
    <AdminPage
      title='Legal documents'
      description='Published legal and compliance text'
    >
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Title (English)</TableHead>
                <TableHead>Title (Chinese)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className='w-12' />
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
                    Unable to load legal documents.
                  </TableCell>
                </TableRow>
              ) : documents.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='h-20 text-center text-muted-foreground'
                  >
                    No legal documents found.
                  </TableCell>
                </TableRow>
              ) : (
                documents.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className='font-medium'>
                      {document.docType}
                    </TableCell>
                    <TableCell className='max-w-56 truncate'>
                      {document.titleEn}
                    </TableCell>
                    <TableCell className='max-w-56 truncate'>
                      {document.titleZh}
                    </TableCell>
                    <TableCell>
                      {document.isActive ? 'Active' : 'Inactive'}
                    </TableCell>
                    <TableCell>
                      {new Date(document.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={`Edit ${document.docType}`}
                        onClick={() => editDocument(document)}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>Edit {selected?.docType}</DialogTitle>
          </DialogHeader>
          <form
            id='legal-document-form'
            className='grid gap-4'
            onSubmit={saveDocument}
          >
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field
                label='Title (English)'
                value={fields.titleEn}
                maxLength={200}
                onChange={(titleEn) =>
                  setFields((current) => ({ ...current, titleEn }))
                }
              />
              <Field
                label='Title (Chinese)'
                value={fields.titleZh}
                maxLength={200}
                onChange={(titleZh) =>
                  setFields((current) => ({ ...current, titleZh }))
                }
              />
            </div>
            <div className='grid gap-4 lg:grid-cols-2'>
              <div className='grid gap-2'>
                <Label htmlFor='legal-content-en'>Content (English)</Label>
                <Textarea
                  id='legal-content-en'
                  rows={12}
                  maxLength={500000}
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
                <Label htmlFor='legal-content-zh'>Content (Chinese)</Label>
                <Textarea
                  id='legal-content-zh'
                  rows={12}
                  maxLength={500000}
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
                id='legal-active'
                checked={fields.isActive}
                onCheckedChange={(isActive) =>
                  setFields((current) => ({ ...current, isActive }))
                }
              />
              <Label htmlFor='legal-active'>Active</Label>
            </div>
          </form>
          <DialogFooter>
            <Button variant='outline' onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              type='submit'
              form='legal-document-form'
              disabled={updateDocument.mutation.isPending}
            >
              {updateDocument.mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}

interface FieldProps {
  label: string
  value: string
  maxLength: number
  onChange: (value: string) => void
}

function Field({ label, value, maxLength, onChange }: FieldProps) {
  const id = label.toLowerCase().split(' ').join('-')
  return (
    <div className='grid gap-2'>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </div>
  )
}
