// Session boundaries live here so the react-query cache is always handled correctly:
// login refreshes everything, logout wipes everything (never leaks the previous session).

import { apiPost } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

export function beginSession(): void {
  void queryClient.invalidateQueries();
}

export async function endSession(): Promise<void> {
  try {
    await apiPost("/auth/logout");
  } finally {
    queryClient.clear();
  }
}
