import { NextResponse } from 'next/server';
import { DEFAULT_DEMO_PROFILE } from '@/lib/demoProfile';

export async function GET() {
  return NextResponse.json(DEFAULT_DEMO_PROFILE);
}
