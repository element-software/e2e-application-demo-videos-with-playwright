/**
 * Global Playwright teardown – stops the in-memory mock Supabase server after
 * all tests finish.
 */

import { stopMockSupabase } from "../support/mockSupabase";

export default async function globalTeardown() {
  await stopMockSupabase();
  console.log("[globalTeardown] Mock Supabase server stopped");
}
