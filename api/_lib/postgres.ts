import { prisma } from './prisma-db.js';

type Row = Record<string, any>;
type Result = { data: any; error: (Error & { code?: string }) | null; count: number | null };
type Filter = { column: string; op: string; value: unknown };
const tables = new Set(['exam_settings', 'exam_projects', 'exam_questions', 'question_keys', 'exam_attempts', 'exam_answers', 'exam_events', 'participant_email_allowlist', 'exam_retake_archives']);
const identifier = (value: string) => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Invalid database identifier');
  return `"${value}"`;
};
const normalize = (value: any): any => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object') {
    if (typeof value.toNumber === 'function') return value.toNumber();
    if (Array.isArray(value)) return value.map(normalize);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
};
const jsonColumns = new Set(['options', 'correct_options', 'selected_options', 'metadata']);
const timestampColumns = new Set([
  'opening_at', 'closing_at', 'created_at', 'updated_at', 'started_at', 'deadline_at',
  'submitted_at', 'consumed_at', 'server_received_at', 'added_at', 'archived_at',
]);
const uuidIdTables = new Set(['exam_projects', 'exam_questions', 'exam_attempts', 'exam_retake_archives']);
const uuidColumns = new Set(['project_id', 'attempt_id', 'question_id', 'invitation_code_id', 'consumed_by_attempt_id', 'original_attempt_id']);
const columnType = (table: string, column: string) => {
  if (jsonColumns.has(column)) return 'jsonb';
  if (timestampColumns.has(column)) return 'timestamptz';
  if (uuidColumns.has(column) || (column === 'id' && uuidIdTables.has(table))) return 'uuid';
  return null;
};
const dbError = (error: unknown): Error & { code?: string } => {
  const value = error as Error & { code?: string; meta?: { code?: string; message?: string } };
  if (value?.meta?.code) value.code = value.meta.code;
  if (value?.meta?.message && !value.message.includes(value.meta.message)) value.message += `: ${value.meta.message}`;
  return value;
};

class Query {
  private fields = '*';
  private head = false;
  private wantCount = false;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private offset?: number;
  private size?: number;
  private one = false;
  private optional = false;
  private operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private values?: Row;

  constructor(private table: string) {
    if (!tables.has(table)) throw new Error('Unknown table');
  }
  select(fields = '*', options: { count?: string; head?: boolean } = {}) {
    this.fields = fields; this.head = !!options.head; this.wantCount = options.count === 'exact'; return this;
  }
  insert(values: Row) { this.operation = 'insert'; this.values = values; return this; }
  update(values: Row) { this.operation = 'update'; this.values = values; return this; }
  delete(options: { count?: string } = {}) { this.operation = 'delete'; this.wantCount = options.count === 'exact'; return this; }
  eq(column: string, value: unknown) { this.filters.push({ column, op: '=', value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ column, op: '<>', value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ column, op: 'in', value }); return this; }
  is(column: string, value: unknown) { this.filters.push({ column, op: 'is', value }); return this; }
  not(column: string, op: string, value: unknown) {
    if (op !== 'is') throw new Error('Unsupported filter');
    this.filters.push({ column, op: 'is not', value }); return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push(`${identifier(column)} ${options.ascending === false ? 'DESC' : 'ASC'}`); return this;
  }
  range(start: number, end: number) { this.offset = start; this.size = end - start + 1; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; this.optional = true; return this; }
  then<TResult1 = Result, TResult2 = never>(resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
    return this.run().then(resolve, reject);
  }

  private async run(): Promise<Result> {
    try {
      const params: unknown[] = [];
      const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
      const bindColumn = (column: string, value: unknown) => {
        const type = columnType(this.table, column);
        const placeholder = bind(type === 'jsonb' ? JSON.stringify(value) : value);
        return type ? `${placeholder}::${type}` : placeholder;
      };
      const conditions = this.filters.map(({ column, op, value }) => {
        const name = identifier(column);
        if (op === 'in') {
          const values = value as unknown[];
          if (!values.length) return 'FALSE';
          return `${name} IN (${values.map((entry) => bindColumn(column, entry)).join(',')})`;
        }
        if (op === 'is' || op === 'is not') {
          if (value !== null) throw new Error('Unsupported IS filter');
          return `${name} ${op.toUpperCase()} NULL`;
        }
        return `${name} ${op} ${bindColumn(column, value)}`;
      });
      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      const relation = this.fields.match(/,?question_keys\(correct_options,reference_answer\)/);
      const plain = this.fields.replace(/,?question_keys\(correct_options,reference_answer\)/, '') || '*';
      const columns = plain === '*' ? '*' : plain.split(',').map((part) => identifier(part.trim())).join(',');
      let sql: string;
      if (this.operation === 'select') {
        sql = `SELECT ${columns} FROM ${identifier(this.table)}${where}`;
      } else if (this.operation === 'insert') {
        const keys = Object.keys(this.values ?? {});
        sql = `INSERT INTO ${identifier(this.table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map((key) => {
          return bindColumn(key, this.values![key]);
        }).join(',')}) RETURNING ${columns}`;
      } else if (this.operation === 'update') {
        const keys = Object.keys(this.values ?? {});
        sql = `UPDATE ${identifier(this.table)} SET ${keys.map((key) => {
          return `${identifier(key)} = ${bindColumn(key, this.values![key])}`;
        }).join(',')}${where} RETURNING ${columns}`;
      } else {
        sql = `DELETE FROM ${identifier(this.table)}${where} RETURNING ${columns}`;
      }
      if (this.operation === 'select') {
        if (this.orders.length) sql += ` ORDER BY ${this.orders.join(',')}`;
        if (this.size !== undefined) sql += ` LIMIT ${bind(this.size)} OFFSET ${bind(this.offset ?? 0)}`;
      }
      if (this.head) {
        const countRows = await prisma.$queryRawUnsafe<Row[]>(`SELECT COUNT(*)::int AS count FROM ${identifier(this.table)}${where}`, ...params);
        return { data: null as unknown as Row[] & Row, error: null, count: Number(countRows[0]?.count ?? 0) };
      }
      const rows = (await prisma.$queryRawUnsafe<Row[]>(sql, ...params)).map(normalize);
      if (relation && rows.length) {
        const ids = rows.map((row) => row.id);
        const keys = await prisma.$queryRawUnsafe<Row[]>(`SELECT question_id, correct_options, reference_answer FROM question_keys WHERE question_id IN (${ids.map((_, index) => `$${index + 1}::uuid`).join(',')})`, ...ids);
        const byId = new Map(keys.map((key) => [key.question_id, normalize(key)]));
        for (const row of rows) {
          const key = byId.get(row.id);
          row.question_keys = key ? { correct_options: key.correct_options, reference_answer: key.reference_answer } : null;
        }
      }
      if (this.one && rows.length > 1) throw new Error('Expected one row');
      if (this.one && !this.optional && !rows.length) throw new Error('Row not found');
      return { data: (this.one ? rows[0] ?? null : rows) as Row[] & Row, error: null, count: this.wantCount ? rows.length : null };
    } catch (error) { return { data: null as unknown as Row[] & Row, error: dbError(error), count: null }; }
  }
}

const rpcTypes: Record<string, Record<string, string>> = {
  hit_rate_limit: { p_key: 'text', p_limit: 'int', p_window: 'int' },
  start_attempt: { p_name: 'text', p_email: 'text', p_position: 'text', p_level: 'text', p_main_project: 'text', p_token_hash: 'text' },
  attempt_state: { p_attempt: 'uuid' },
  save_answers: { p_attempt: 'uuid', p_answers: 'jsonb' },
  save_answer: { p_attempt: 'uuid', p_question: 'uuid', p_options: 'jsonb', p_essay: 'text' },
  finalize_and_get_attempt_state: { p_attempt: 'uuid', p_reason: 'text' },
  replace_participant_email_allowlist: { p_emails: 'text[]' },
  replace_participant_email_allowlist_with_names: { p_emails: 'text[]', p_names: 'text[]' },
  append_participant_email_allowlist: { p_emails: 'text[]' },
  authorize_exam_retake: { p_email: 'text', p_expected_attempt: 'uuid', p_reason: 'text' },
  grade_essay_attempt: { p_attempt: 'uuid', p_grades: 'jsonb' },
  reconcile_expired: {},
  import_questions: { p_mode: 'text', p_items: 'jsonb' },
  import_fixed_forms: { p_items: 'jsonb' },
};

export const sb = {
  from: (table: string) => new Query(table),
  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    try {
      const signature = rpcTypes[name];
      if (!signature || Object.keys(args).sort().join() !== Object.keys(signature).sort().join()) throw new Error('Unknown RPC signature');
      const names = Object.keys(signature);
      const params = names.map((key) => signature[key] === 'jsonb' ? JSON.stringify(args[key]) : args[key]);
      const sql = `SELECT ${identifier(name)}(${names.map((key, index) => `${identifier(key)} => $${index + 1}::${signature[key]}`).join(',')}) AS value`;
      const rows = await prisma.$queryRawUnsafe<{ value: any }[]>(sql, ...params);
      return { data: normalize(rows[0]?.value), error: null, count: null };
    } catch (error) { return { data: null as unknown as Row[] & Row, error: dbError(error), count: null }; }
  },
};
