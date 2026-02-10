const BASE = '/admin/api'

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('admin_token') || ''
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...opts?.headers,
    },
  })
  if (!res.ok)
    throw new Error(`API error: ${res.status}`)
  return await res.json() as T
}
