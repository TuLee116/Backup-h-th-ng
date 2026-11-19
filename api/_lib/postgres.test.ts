import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('./prisma-db.js', () => ({ prisma: { $queryRawUnsafe: query } }));

const { sb } = await import('./postgres.js');

beforeEach(() => query.mockReset());

describe('Prisma PostgreSQL API adapter', () => {
  it('uses bound values and preserves candidate column selection', async () => {
    query.mockResolvedValue([{ id: 'one', question_text: 'Q' }]);
    const result = await sb.from('exam_questions').select('id,question_text').in('id', ['one']);
    expect(result.error).toBeNull();
    expect(query).toHaveBeenCalledWith(
      'SELECT "id","question_text" FROM "exam_questions" WHERE "id" IN ($1::uuid)', 'one',
    );
    expect(result.data).toEqual([{ id: 'one', question_text: 'Q' }]);
  });

  it('casts settings timestamps so Prisma can save the exam configuration', async () => {
    query.mockResolvedValue([{ id: 1 }]);
    const result = await sb.from('exam_settings').update({
      opening_at: '2026-11-18T08:00:00+07:00',
      closing_at: '2026-11-18T09:00:00+07:00',
      updated_at: '2026-11-17T10:00:00.000Z',
    }).eq('id', 1).select('id').single();
    expect(result.error).toBeNull();
    expect(query.mock.calls[0][0]).toContain('"opening_at" = $2::timestamptz');
    expect(query.mock.calls[0][0]).toContain('"closing_at" = $3::timestamptz');
    expect(query.mock.calls[0][0]).toContain('"updated_at" = $4::timestamptz');
    expect(query.mock.calls[0][0]).toContain('WHERE "id" = $1');
  });

  it('casts project IDs so project updates can find UUID rows', async () => {
    query.mockResolvedValue([{ id: '00000000-0000-0000-0000-000000000001', active: false }]);
    const result = await sb.from('exam_projects').update({ active: false })
      .eq('id', '00000000-0000-0000-0000-000000000001').select('id,active').single();
    expect(result.error).toBeNull();
    expect(query.mock.calls[0][0]).toContain('WHERE "id" = $1::uuid');
  });

  it('sends JSON answers into the existing atomic SQL function', async () => {
    query.mockResolvedValue([{ value: 'ok' }]);
    const answers = [{ questionId: 'a', optionIds: ['b'] }];
    const result = await sb.rpc('save_answers', { p_attempt: 'id', p_answers: answers });
    expect(result.data).toBe('ok');
    expect(query.mock.calls[0][0]).toContain('"save_answers"("p_attempt" => $1::uuid,"p_answers" => $2::jsonb)');
    expect(query.mock.calls[0].slice(1)).toEqual(['id', JSON.stringify(answers)]);
  });

  it('sends five fixed forms to the import RPC as JSON', async () => {
    query.mockResolvedValue([{ value: 95 }]);
    const items = [{ formNo: 1, type: 'single', text: 'Câu hỏi' }];
    const result = await sb.rpc('import_fixed_forms', { p_items: items });
    expect(result.error).toBeNull();
    expect(result.data).toBe(95);
    expect(query).toHaveBeenCalledWith(
      'SELECT "import_fixed_forms"("p_items" => $1::jsonb) AS value',
      JSON.stringify(items),
    );
  });

  it('attaches answer keys only when the server explicitly requests them', async () => {
    query.mockResolvedValueOnce([{ id: '00000000-0000-0000-0000-000000000001', question_text: 'Q' }]);
    query.mockResolvedValueOnce([{ question_id: '00000000-0000-0000-0000-000000000001', correct_options: ['a'], reference_answer: null }]);
    const result = await sb.from('exam_questions').select('id,question_text,question_keys(correct_options,reference_answer)');
    expect(result.data[0].question_keys).toEqual({ correct_options: ['a'], reference_answer: null });
    expect(query.mock.calls[0][0]).not.toContain('correct_options');
    expect(query.mock.calls[1][0]).toContain('FROM question_keys');
  });

  it('rejects unknown tables and RPC calls before SQL execution', async () => {
    expect(() => sb.from('private_secrets')).toThrow();
    const result = await sb.rpc('arbitrary_function');
    expect(result.error).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
  });
});
