import { supabase } from "@/integrations/supabase/client";

/**
 * Typed wrapper around the `olympiad-proxy` edge function which forwards calls
 * to the source iPlus Olympiad `crm-proxy`.
 *
 * - Read actions: schema, select, rpc → manager+
 * - Write actions: insert, update, delete → superadmin only
 */

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in";

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | { op: FilterOp; value: unknown };

export type Filters = Record<string, FilterValue>;

export interface SelectParams {
  table: string;
  columns?: string;
  filters?: Filters;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  offset?: number;
}

export interface RpcParams {
  fn: string;
  args?: Record<string, unknown>;
}

export interface InsertParams {
  table: string;
  rows: Record<string, unknown>[];
}

export interface UpdateParams {
  table: string;
  filters: Filters;
  values: Record<string, unknown>;
}

export interface DeleteParams {
  table: string;
  filters: Filters;
}

async function call<T = unknown>(
  body: Record<string, unknown>,
): Promise<{ data: T; count?: number }> {
  const { data, error } = await supabase.functions.invoke("olympiad-proxy", {
    body,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as { data: T; count?: number };
}

export const olympiadProxy = {
  schema: () => call<{ tables: Record<string, unknown>; allowed_rpcs: string[] }>({ action: "schema" }),
  select: <T = unknown>(p: SelectParams) =>
    call<T[]>({ action: "select", ...p }),
  rpc: <T = unknown>(p: RpcParams) => call<T>({ action: "rpc", ...p }),
  insert: <T = unknown>(p: InsertParams) => call<T>({ action: "insert", ...p }),
  update: <T = unknown>(p: UpdateParams) => call<T>({ action: "update", ...p }),
  delete: <T = unknown>(p: DeleteParams) => call<T>({ action: "delete", ...p }),
};
