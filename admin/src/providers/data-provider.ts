import type { DataProvider } from '@refinedev/core'
import { api } from '@/lib/lucent-api'

type RecordData = Record<string, unknown>
type ListResult<T> = { items: T[]; total: number }

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
      'value' in item
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
        params: { ...params, q: textFilter(filters, ['email', 'nickname']) },
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
    throw new Error(`Unsupported resource: ${resource}`)
  },
  create: async ({ resource, variables }) => {
    if (resource !== 'safety-tips') {
      throw new Error(`Create is not supported for ${resource}`)
    }
    const { data } = await api.post<RecordData>(
      '/admin/content/safety-tips',
      variables
    )
    return { data: data as never }
  },
  update: async ({ resource, id, variables }) => {
    const path =
      resource === 'legal-documents'
        ? `/admin/content/legal-documents/${id}`
        : resource === 'safety-tips'
          ? `/admin/content/safety-tips/${id}`
          : null
    if (!path) throw new Error(`Update is not supported for ${resource}`)
    const { data } = await api.put<RecordData>(path, variables)
    return { data: { ...data, id: data.id ?? id } as never }
  },
  deleteOne: async ({ resource, id }) => {
    if (resource !== 'safety-tips') {
      throw new Error(`Delete is not supported for ${resource}`)
    }
    await api.delete(`/admin/content/safety-tips/${id}`)
    return { data: { id } as never }
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
