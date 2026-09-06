// Why: plain in-memory Prometheus counters — no prom-client dependency (tier-1 binding rule).
export class ControlMetrics {
  private readonly httpRequests = new Map<string, { method: string; status: number; count: number }>()

  incHttpRequest(method: string, status: number): void {
    const key = JSON.stringify([method, status])
    const existing = this.httpRequests.get(key)
    this.httpRequests.set(key, { method, status, count: (existing?.count ?? 0) + 1 })
  }

  renderPrometheus(): string {
    const lines = ['# TYPE http_requests_total counter']
    for (const { method, status, count } of this.httpRequests.values()) {
      lines.push(`http_requests_total{method="${escapeLabel(method)}",status="${status}"} ${count}`)
    }
    return lines.join('\n') + '\n'
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}
