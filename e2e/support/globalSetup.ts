/**
 * Global Playwright setup – starts the in-memory mock Supabase server before
 * any tests run so that the Next.js dev server can connect to it.
 */

import { startMockSupabase } from "../support/mockSupabase";

export default async function globalSetup() {
  await startMockSupabase(54321);
  console.log("[globalSetup] Mock Supabase server started on port 54321");
}
