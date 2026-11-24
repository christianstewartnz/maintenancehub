import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes — no auth needed
  if (pathname.startsWith('/portal') || pathname.startsWith('/api/')) {
    return supabaseResponse
  }

  // Deactivated users are sent here by the admin layout. A server component can't clear
  // cookies, so sign them out here; otherwise the rule below would bounce them back to
  // /dashboard → layout → here in a loop.
  if (pathname === '/auth/login' && request.nextUrl.searchParams.get('deactivated') === '1') {
    if (user) await supabase.auth.signOut({ scope: 'local' })
    return supabaseResponse
  }

  // The invite / set-password page must work even if someone (e.g. the admin who sent
  // the invite) is already signed in in this browser: redeeming the link swaps the session.
  if (pathname === '/auth/accept-invite') {
    return supabaseResponse
  }

  // Auth routes — redirect to dashboard if already signed in
  if (pathname.startsWith('/auth') && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Protected routes — redirect to login if not signed in
  if (!pathname.startsWith('/auth') && !user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
