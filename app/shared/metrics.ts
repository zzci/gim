const startTime = Date.now()

let totalRequests = 0
const statusCounts: Record<number, number> = {}
const methodCounts: Record<string, number> = {}

export function recordRequest(method: string, status: number) {
  totalRequests++
  statusCounts[status] = (statusCounts[status] || 0) + 1
  methodCounts[method] = (methodCounts[method] || 0) + 1
}

export function getMetrics() {
  return {
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    total_requests: totalRequests,
    by_status: { ...statusCounts },
    by_method: { ...methodCounts },
  }
}
