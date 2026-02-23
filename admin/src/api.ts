const BASE = '/admin/api'

// In-memory token for dev mode (Vite proxy) where cookies may not flow
let devToken = ''

export function setDevToken(token: string) {
  devToken = token
}

export function clearDevToken() {
  devToken = ''
}

export function hasDevToken(): boolean {
  return devToken.length > 0
}

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  // In dev mode, send token via header as fallback
  if (devToken) {
    headers.Authorization = `Bearer ${devToken}`
  }

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: 'same-origin',
    headers: {
      ...headers,
      ...opts?.headers,
    },
  })
  if (!res.ok)
    throw new Error(`API error: ${res.status}`)
  return await res.json() as T
}

export async function adminLogin(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (res.ok) {
    // Keep token in memory for dev mode Authorization header fallback
    setDevToken(token)
    return true
  }
  return false
}

export async function adminLogout(): Promise<void> {
  clearDevToken()
  await fetch(`${BASE}/logout`, {
    method: 'POST',
    credentials: 'same-origin',
  }).catch(() => {})
}
