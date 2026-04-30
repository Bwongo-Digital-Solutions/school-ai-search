type QueryOperation = 'select' | 'insert' | 'update' | 'delete';

type QueryFilter = {
  field: string;
  operator: 'eq';
  value: unknown;
};

type QueryOrder = {
  field: string;
  ascending: boolean;
};

type QueryResult<T = any> = {
  data: T | null;
  error: Error | null;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export const buildApiUrl = (path: string) => `${API_BASE}${path}`;

const toError = (value: unknown) =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Request failed');

class ApiQueryBuilder<T = any> implements PromiseLike<QueryResult<T>> {
  private readonly table: string;
  private operation: QueryOperation = 'select';
  private columns = '*';
  private filters: QueryFilter[] = [];
  private orderBy?: QueryOrder;
  private rowLimit?: number;
  private payload?: unknown;
  private expectSingle = false;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = '*') {
    this.columns = columns;
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = {
      field,
      ascending: options?.ascending ?? true,
    };
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, operator: 'eq', value });
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  update(payload: unknown) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  insert(payload: unknown) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  single() {
    this.expectSingle = true;
    return this;
  }

  private async execute(): Promise<QueryResult<T>> {
    try {
      const response = await fetch(buildApiUrl('/api/db'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table: this.table,
          operation: this.operation,
          columns: this.columns,
          filters: this.filters,
          orderBy: this.orderBy,
          limit: this.rowLimit,
          payload: this.payload,
          single: this.expectSingle,
        }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.error) {
        return {
          data: null,
          error: toError(json?.error || `Request failed with status ${response.status}`),
        };
      }

      return {
        data: (json?.data ?? null) as T,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: toError(error),
      };
    }
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export const supabase = {
  from<T = any>(table: string) {
    return new ApiQueryBuilder<T>(table);
  },
  functions: {
    async invoke<T = any>(name: string, options?: { body?: unknown }): Promise<QueryResult<T>> {
      try {
        const response = await fetch(buildApiUrl(`/api/functions/${name}`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options?.body ?? {}),
        });

        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.error) {
          return {
            data: (json?.data ?? null) as T,
            error: toError(json?.error || `Function request failed with status ${response.status}`),
          };
        }

        return {
          data: (json?.data ?? null) as T,
          error: null,
        };
      } catch (error) {
        return {
          data: null,
          error: toError(error),
        };
      }
    },
  },
};
