import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const proposed = request.nextUrl.searchParams.get('next') || '/';
  const next =
    proposed.startsWith('/') && !proposed.startsWith('//') && !proposed.includes('\\')
      ? proposed
      : '/';
  if (code) {
    const client = await createServerSupabaseClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL('/account?error=link', request.url));
}
