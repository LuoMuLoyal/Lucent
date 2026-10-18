import { getDataResource, DATA_RESOURCE_KEYS } from '@/config/data-resources'
import type { DataProvider } from '@refinedev/core'
import { api } from '@/lib/lucent-api'

type RecordData = Record<string, unknown>
type ListResult<T> = { items: T[]; total: number }

/** True for tables served by the generic `/admin/data/:resource` layer. */
function isDataResource(resource: string): boolean {
  return DATA_RESOURCE_KEYS.has(resource)
}

/** The generic data layer refuses writes to import/log tables. */
function assertWritable(resource: string): void {
  if (getDataResource(resource)?.readOnly === true) {
    throw new Error(`Resource ${resource} is read-only`)
  }
}

function pageParams(pagination?: { currentPage?: number; pageSize?: number }) {
  return {
    page: pagination?.currentPage ?? 1,
    limit: Math.min(pagination?.pageSize ?? 25, 100),
  }
}

function textFilter(
  filters: unknown,
  fieldNames: string[]
): string | undefined {
  if (!Array.isArray(filters)) return undefined
  const filter = filters.find(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'field' in item &&
      fieldNames.includes(String(item.field)) &&
      typeof (item as { value?: unknown }).value === 'string' &&
      (item as { value: string }).value.length > 0
  )
  return typeof filter?.value === 'string' ? filter.value : undefined
}

function equalityFilter(filters: unknown, field: string): string | undefined {
  if (!Array.isArray(filters)) return undefined
  const filter = filters.find(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as { field?: unknown }).field === field &&
      typeof (item as { value?: unknown }).value === 'string' &&
      (item as { value: string }).value.length > 0
  )
  return typeof filter?.value === 'string' ? filter.value : undefined
}

export const dataProvider: DataProvider = {
  getApiUrl: () => api.defaults.baseURL ?? '/api/v1',
  getList: async ({ resource, pagination, filters }) => {
    const params = pageParams(pagination)

    if (resource === 'metrics') {
      const response = await api.get<RecordData>('/admin/metrics/overview')
      return {
        data: [{ id: 'overview', ...response.data }] as never[],
        total: 1,
      }
    }
    if (resource === 'users') {
      const response = await api.get<ListResult<RecordData>>('/admin/users', {
        params: {
          ...params,
          q: textFilter(filters, ['q', 'email', 'nickname']),
          status: equalityFilter(filters, 'status'),
        },
      })
      return {
        data: response.data.items as never[],
        total: response.data.total,
      }
    }
    if (resource === 'audit-logs') {
      const response = await api.get<ListResult<RecordData>>(
        '/admin/audit-logs',
        {
          params,
        }
      )
      return {
        data: response.data.items as never[],
        total: response.data.total,
      }
    }
    if (resource === 'legal-documents') {
      const response = await api.get<RecordData[]>(
        '/admin/content/legal-documents'
      )
      const data = response.data.map((item) => ({ ...item, id: item.docType }))
      return { data: data as never[], total: data.length }
    }
    if (resource === 'safety-tips') {
      const response = await api.get<RecordData[]>('/admin/content/safety-tips')
      return { data: response.data as never[], total: response.data.length }
    }
    if (resource === 'qa-chunks') {
      const response = await api.get<ListResult<RecordData>>(
        '/admin/content/qa-chunks',
        {
          params: {
            ...params,
            q: textFilter(filters, ['q']),
            safetyLabel: equalityFilter(filters, 'safetyLabel'),
          },
        }
      )
      return {
        data: response.data.items as never[],
        total: response.data.total,
      }
    }
    if (isDataResource(resource)) {
      const response = await api.get<ListResult<RecordData>>(
        `/admin/data/${resource}`,
        {
          params: {
            ...params,
            q: textFilter(filters, ['q']),
            userId: equalityFilter(filters, 'userId'),
          },
        }
      )
      return {
        data: response.data.items as never[],
        total: response.data.total,
      }
    }
    throw new Error(`Unsupported resource: ${resource}`)
  },
  getOne: async ({ resource, id }) => {
    if (resource === 'users') {
      const { data } = await api.get<RecordData>(`/admin/users/${id}`)
      return { data: data as never }
    }
    if (resource === 'legal-documents') {
      const { data } = await api.get<RecordData[]>(
        '/admin/content/legal-documents'
      )
      const document = data.find((item) => item.docType === id)
      if (!document) throw new Error('Legal document not found')
      return { data: { ...document, id: document.docType } as never }
    }
    if (resource === 'safety-tips') {
      const { data } = await api.get<RecordData[]>('/admin/content/safety-tips')
      const tip = data.find((item) => item.id === id)
      if (!tip) throw new Error('Safety tip not found')
      return { data: tip as never }
    }
    if (isDataResource(resource)) {
      const { data } = await api.get<RecordData>(
        `/admin/data/${resource}/${id}`
      )
      return { data: data as never }
    }
    throw new Error(`Unsupported resource: ${resource}`)
  },
  create: async ({ resource, variables }) => {
    if (resource === 'safety-tips') {
      const { data } = await api.post<RecordData>(
        '/admin/content/safety-tips',
        variables
      )
      return { data: data as never }
    }
    if (isDataResource(resource)) {
      assertWritable(resource)
      const { data } = await api.post<RecordData>(
        `/admin/data/${resource}`,
        variables
      )
      return { data: data as never }
    }
    throw new Error(`Create is not supported for ${resource}`)
  },
  update: async ({ resource, id, variables }) => {
    if (resource === 'legal-documents') {
      const { data } = await api.put<RecordData>(
        `/admin/content/legal-documents/${id}`,
        variables
      )
      return { data: { ...data, id: data.id ?? id } as never }
    }
    if (resource === 'safety-tips') {
      const { data } = await api.put<RecordData>(
        `/admin/content/safety-tips/${id}`,
        variables
      )
      return { data: { ...data, id: data.id ?? id } as never }
    }
    if (resource === 'qa-chunks') {
      const { data } = await api.put<RecordData>(
        `/admin/content/qa-chunks/${id}`,
        variables
      )
      return { data: { ...data, id: data.id ?? id } as never }
    }
    if (isDataResource(resource)) {
      assertWritable(resource)
      const { data } = await api.put<RecordData>(
        `/admin/data/${resource}/${id}`,
        variables
      )
      return { data: { ...data, id: data.id ?? id } as never }
    }
    throw new Error(`Update is not supported for ${resource}`)
  },
  deleteOne: async ({ resource, id }) => {
    if (resource === 'safety-tips') {
      await api.delete(`/admin/content/safety-tips/${id}`)
      return { data: { id } as never }
    }
    if (isDataResource(resource)) {
      assertWritable(resource)
      await api.delete(`/admin/data/${resource}/${id}`)
      return { data: { id } as never }
    }
    throw new Error(`Delete is not supported for ${resource}`)
  },
  custom: async ({ url, method, payload, query }) => {
    const { data } = await api.request<RecordData>({
      url,
      method,
      data: payload,
      params: query,
    })
    return { data: data as never }
  },
}
