import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const db = new PrismaClient();
const tables = [
  'exam_settings', 'exam_questions', 'question_keys', 'exam_attempts',
  'exam_answers', 'exam_events', 'exam_projects',
  'participant_email_allowlist', 'rate_limits', 'exam_retake_archives',
];
const functions = [
  'hit_rate_limit', 'start_attempt', 'attempt_state', 'save_answer',
  'save_answers', 'finalize_and_get_attempt_state', 'grade_essay_attempt',
  'authorize_exam_retake', 'reconcile_expired', 'import_questions',
  'replace_participant_email_allowlist_with_names',
];

try {
  const foundTables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const foundFunctions = await db.$queryRaw`SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace WHERE n.nspname = 'public'`;
  const tableNames = new Set(foundTables.map((row) => row.tablename));
  const functionNames = new Set(foundFunctions.map((row) => row.proname));
  const missing = [
    ...tables.filter((name) => !tableNames.has(name)).map((name) => `table ${name}`),
    ...functions.filter((name) => !functionNames.has(name)).map((name) => `function ${name}`),
  ];
  if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);

  const rows = await db.$queryRaw`SELECT
    (SELECT count(*)::int FROM exam_settings) AS settings,
    (SELECT count(*)::int FROM exam_questions) AS questions,
    (SELECT count(*)::int FROM exam_attempts) AS attempts,
    (SELECT count(*)::int FROM exam_answers) AS answers,
    (SELECT count(*)::int FROM participant_email_allowlist) AS participants,
    (SELECT count(*)::int FROM exam_retake_archives) AS retake_archives`;
  const columns = await db.$queryRaw`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exam_questions' AND column_name = 'bank_order'`;
  if (columns.length !== 1) throw new Error('Migration 024 bank_order is missing.');
  if (rows[0].settings !== 1) throw new Error('Expected exactly one exam_settings row.');
  console.log(JSON.stringify({ schema: 'ok', counts: rows[0] }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
