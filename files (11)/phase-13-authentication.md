# Phase 13 — Authentication & User Management

## Auth Strategy

- **Provider**: Supabase Auth (handles JWT, sessions, OAuth flows)
- **OAuth Provider**: Google (required by spec)
- **Session**: Supabase JWTs verified server-side by Fastify
- **Frontend**: Supabase SSR helpers for Next.js App Router

---

## Google OAuth Setup

### 1. Google Cloud Console
```
1. Go to console.cloud.google.com
2. Create OAuth 2.0 credentials (Web Application)
3. Authorized redirect URIs:
   - https://<your-supabase-ref>.supabase.co/auth/v1/callback
   - http://localhost:3000/auth/callback (for dev)
4. Copy Client ID and Client Secret
```

### 2. Supabase Dashboard
```
Authentication -> Providers -> Google
Enable Google -> paste Client ID + Secret -> Save
```

### 3. Environment Variables
```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
```

---

## Supabase Client Setup

```typescript
// apps/web/lib/supabase.ts  (browser client)
import { createBrowserClient } from '@supabase/ssr'

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
```

```typescript
// apps/web/lib/supabase-server.ts  (server component client)
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createSupabaseServerClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: (name, value, options) => cookieStore.set(name, value, options),
        remove: (name, options) => cookieStore.delete({ name, ...options }),
      },
    },
  )
}
```

---

## Login Page (app/(auth)/login/page.tsx)

```tsx
'use client'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import Image from 'next/image'

export default function LoginPage() {
  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-8 rounded-2xl border border-border bg-card text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Welcome</h1>
          <p className="text-muted-foreground text-sm mt-1">Sign in to start building</p>
        </div>

        <Button onClick={signInWithGoogle} variant="outline" className="w-full gap-3">
          <Image src="/google.svg" alt="Google" width={18} height={18} />
          Continue with Google
        </Button>

        <p className="text-xs text-muted-foreground">
          By signing in you agree to our Terms of Service.
        </p>
      </div>
    </main>
  )
}
```

---

## OAuth Callback (app/(auth)/callback/page.tsx)

```tsx
// app/auth/callback/route.ts  (Route Handler, not page)
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // Upsert user in our DB
      await fetch(`${process.env.API_URL}/api/users/upsert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ id: data.user.id, email: data.user.email, name: data.user.user_metadata.full_name }),
      })

      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth_error`)
}
```

---

## Next.js Middleware (Route Protection)

```typescript
// apps/web/middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => request.cookies.get(n)?.value, set: () => {}, remove: () => {} } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // Redirect unauthenticated users to /login
  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/auth')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect authenticated users away from /login
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'] }
```

---

## Fastify JWT Verification

```typescript
// apps/api/src/plugins/auth.ts
import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'

export default fp(async (app) => {
  // Supabase JWTs are signed with the JWT_SECRET from your project
  app.register(jwt, { secret: process.env.SUPABASE_JWT_SECRET! })

  app.addHook('preHandler', async (req, reply) => {
    const publicPaths = ['/health', '/public']
    if (publicPaths.some(p => req.url.startsWith(p))) return

    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing Authorization header' })
    }

    try {
      await req.jwtVerify()
    } catch {
      return reply.code(401).send({ error: 'Invalid token' })
    }
  })
})
```

---

## useUser Hook (Frontend)

```typescript
// apps/web/hooks/useUser.ts
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = () => supabase.auth.signOut()

  return { user, loading, signOut }
}
```
