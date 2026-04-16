# Phase 19 — Observability, Logging & Analytics

## Observability Stack

| Concern | Tool | Purpose |
|---|---|---|
| Structured logging | Pino | JSON logs for all API calls |
| LLM tracing | LangSmith | Token usage, latency, cost per request |
| Error tracking | Sentry | Frontend + backend error capture |
| Metrics | OpenTelemetry + Prometheus | Request rates, latency, sandbox metrics |
| Dashboards | Grafana | Visualize metrics |
| Health checks | /health endpoint | Uptime monitoring |
| Analytics | PostHog | User behavior, feature usage |

---

## Pino Logging (Fastify)

```typescript
// apps/api/src/index.ts
const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
    level: 'info',
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        userId: req.user?.sub,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
        responseTime: res.elapsedTime,
      }),
    },
  },
})

// Log LLM calls
app.addHook('onRequest', (req, reply, done) => {
  req.log.info({ type: 'request_start' })
  done()
})
```

---

## LangSmith Integration

```typescript
// packages/llm-router/src/providers.ts
import { createAnthropic } from '@ai-sdk/anthropic'
import { wrapAISDKModel } from 'langsmith/wrappers'

const rawAnthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Wrap with LangSmith tracing
export const anthropic = (modelId: string) =>
  wrapAISDKModel(rawAnthropic(modelId), {
    project: 'lovable-clone',
    tags: ['production'],
  })
```

```typescript
// Track per-request metadata in LangSmith
const result = streamText({
  model: getModel(provider),
  system: systemMessage,
  messages,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'chat-completion',
    metadata: { projectId, userId, provider },
  },
})
```

---

## OpenTelemetry Setup (apps/api/src/tracing.ts)

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify'

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'lovable-api',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version,
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  instrumentations: [
    new HttpInstrumentation(),
    new FastifyInstrumentation(),
  ],
})

sdk.start()
process.on('SIGTERM', () => sdk.shutdown())
```

---

## Custom LLM Metrics

```typescript
// packages/llm-router/src/metrics.ts
import { metrics } from '@opentelemetry/api'

const meter = metrics.getMeter('llm-router')

export const llmCallDuration = meter.createHistogram('llm_call_duration_ms', {
  description: 'LLM API call duration in milliseconds',
  unit: 'ms',
})

export const llmTokensTotal = meter.createCounter('llm_tokens_total', {
  description: 'Total tokens consumed',
})

export const llmErrors = meter.createCounter('llm_errors_total', {
  description: 'Total LLM API errors',
})

// Usage in streamText wrapper:
const start = Date.now()
try {
  const result = await streamText({ ... })
  llmCallDuration.record(Date.now() - start, { provider, model })
  llmTokensTotal.add(result.usage.totalTokens, { provider, model })
  return result
} catch (err) {
  llmErrors.add(1, { provider, model, error: err.code })
  throw err
}
```

---

## Sandbox Metrics

```typescript
// apps/api/src/services/metrics.service.ts

export const sandboxCreations = meter.createCounter('sandbox_creations_total')
export const sandboxDuration = meter.createHistogram('sandbox_duration_seconds')
export const activeWorkspaces = meter.createUpDownCounter('sandbox_active_workspaces')

// On workspace create
sandboxCreations.add(1, { provider: 'daytona' })
activeWorkspaces.add(1)

// On workspace stop
activeWorkspaces.add(-1)
sandboxDuration.record(sessionDurationSeconds, { provider: 'daytona' })
```

---

## Sentry Integration

```typescript
// apps/api/src/index.ts
import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend: (event) => {
    // Scrub API keys from error events
    if (event.request?.headers?.authorization) {
      event.request.headers.authorization = '[REDACTED]'
    }
    return event
  },
})

// Frontend: apps/web/sentry.client.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
})
```

---

## Health Check Endpoint

```typescript
// apps/api/src/routes/health.ts
app.get('/health', { config: { rateLimit: false } }, async () => {
  const [dbOk, redisOk] = await Promise.allSettled([
    db.execute(sql`SELECT 1`).then(() => true),
    redis.ping().then(() => true),
  ])

  const status = dbOk.status === 'fulfilled' && redisOk.status === 'fulfilled'
    ? 'healthy' : 'degraded'

  return {
    status,
    checks: {
      database: dbOk.status === 'fulfilled' ? 'ok' : 'error',
      redis: redisOk.status === 'fulfilled' ? 'ok' : 'error',
    },
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
  }
})
```

---

## PostHog Analytics (Frontend)

```typescript
// apps/web/lib/analytics.ts
import posthog from 'posthog-js'

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  posthog.capture(event, properties)
}

// Track key events:
trackEvent('project_created', { projectId, name })
trackEvent('message_sent', { projectId, provider, messageLength: content.length })
trackEvent('file_written', { projectId, path })
trackEvent('project_published', { projectId, url })
trackEvent('model_switched', { from: oldModel, to: newModel })
```

---

## Grafana Dashboard Panels

1. **LLM Overview**: Requests/min, avg latency, p95 latency, error rate, tokens/day
2. **Sandbox Health**: Active workspaces, creation rate, failed starts, avg session duration
3. **API Performance**: Request rate, 4xx/5xx rate, slowest endpoints
4. **User Activity**: DAU, projects created, messages sent, publishes per day
5. **Cost Tracking**: Tokens by provider/model, estimated cost per day

---

## Alerting Rules (Grafana)

```yaml
groups:
  - name: lovable-alerts
    rules:
      - alert: HighLLMErrorRate
        expr: rate(llm_errors_total[5m]) > 0.05
        for: 2m
        annotations:
          summary: "LLM error rate above 5%"

      - alert: SandboxCreationFailing
        expr: rate(sandbox_creation_errors_total[5m]) > 0.1
        for: 1m
        annotations:
          summary: "More than 10% of sandbox creations failing"

      - alert: APILatencyHigh
        expr: histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m])) > 5000
        for: 5m
        annotations:
          summary: "95th percentile API latency above 5 seconds"
```
