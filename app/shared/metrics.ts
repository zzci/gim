const startTime = Date.now()

// ---- Counters ----

// gim_http_requests_total{method, status}
const requestCounts = new Map<string, number>()

// ---- Histogram: gim_http_request_duration_seconds{method, path} ----

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

interface HistogramData {
  buckets: number[] // counts per bucket
  sum: number
  count: number
}

const durationHistograms = new Map<string, HistogramData>()

// ---- Gauge: gim_active_sync_connections ----

let activeSyncConnections = 0

export function incSyncConnections() {
  activeSyncConnections++
}

export function decSyncConnections() {
  activeSyncConnections--
}

// ---- Recording ----

function normalizePath(path: string): string {
  // Collapse IDs into placeholders to avoid high-cardinality labels
  return path
    .replace(/\/_matrix\/client\/v\d+/, '/_matrix/client')
    .replace(/![^/]+/g, ':roomId')
    .replace(/\$[^/]+/g, ':eventId')
    .replace(/@[^/]+/g, ':userId')
    .replace(/\/[A-Z]{10,}$/i, '/:id')
}

export function recordRequest(method: string, status: number, path?: string, durationMs?: number) {
  // Counter: requests by method + status
  const counterKey = `${method}|${status}`
  requestCounts.set(counterKey, (requestCounts.get(counterKey) || 0) + 1)

  // Histogram: duration by method + normalized path
  if (path !== undefined && durationMs !== undefined) {
    const normalizedPath = normalizePath(path)
    const histKey = `${method}|${normalizedPath}`
    let hist = durationHistograms.get(histKey)
    if (!hist) {
      hist = { buckets: Array.from({ length: DURATION_BUCKETS.length }).fill(0) as number[], sum: 0, count: 0 }
      durationHistograms.set(histKey, hist)
    }
    const durationSec = durationMs / 1000
    hist.sum += durationSec
    hist.count++
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      if (durationSec <= DURATION_BUCKETS[i]!)
        hist.buckets[i]!++
    }
  }
}

// ---- Prometheus text format ----

export function formatPrometheusMetrics(): string {
  const lines: string[] = []

  // Uptime
  lines.push('# HELP gim_uptime_seconds Time since server started')
  lines.push('# TYPE gim_uptime_seconds gauge')
  lines.push(`gim_uptime_seconds ${Math.floor((Date.now() - startTime) / 1000)}`)

  // HTTP request counter
  lines.push('# HELP gim_http_requests_total Total HTTP requests')
  lines.push('# TYPE gim_http_requests_total counter')
  for (const [key, count] of requestCounts) {
    const [method, status] = key.split('|')
    lines.push(`gim_http_requests_total{method="${method}",status="${status}"} ${count}`)
  }

  // HTTP duration histogram
  lines.push('# HELP gim_http_request_duration_seconds HTTP request duration')
  lines.push('# TYPE gim_http_request_duration_seconds histogram')
  for (const [key, hist] of durationHistograms) {
    const [method, path] = key.split('|')
    const labels = `method="${method}",path="${path}"`
    let cumulative = 0
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      cumulative += hist.buckets[i]!
      lines.push(`gim_http_request_duration_seconds_bucket{${labels},le="${DURATION_BUCKETS[i]}"} ${cumulative}`)
    }
    lines.push(`gim_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${hist.count}`)
    lines.push(`gim_http_request_duration_seconds_sum{${labels}} ${hist.sum}`)
    lines.push(`gim_http_request_duration_seconds_count{${labels}} ${hist.count}`)
  }

  // Active sync connections gauge
  lines.push('# HELP gim_active_sync_connections Currently active sync long-poll connections')
  lines.push('# TYPE gim_active_sync_connections gauge')
  lines.push(`gim_active_sync_connections ${activeSyncConnections}`)

  return lines.join('\n')
}
