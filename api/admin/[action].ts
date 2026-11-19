import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ZipArchive } from 'archiver';
import type { Archiver } from 'archiver';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { sb, hmac, safeEq, adminOk, ip, setCookie, limited, begin, fail } from '../_lib/server.js';
import { escapeCell, isCompanyEmail, normalizeEmail } from '../_lib/pure.js';
import { buildResultsWorkbook, orderExportAttempts } from '../_lib/workbook.js';
import { adminResultPdfName, buildReviewPdf } from '../_lib/review-pdf.js';
import { appendZipEntry } from '../_lib/zip.js';
import { parseFormSheets, parseRows, parseText } from '../_lib/import.js';
import { buildExamDashboard, buildTabSwitchSummary } from '../_lib/dashboard.js';
import { scoreBucketOutOfTen, scoreOutOfTen } from '../_lib/scoring.js';
import { parseParticipantImportSheet } from '../_lib/participant-import.js';
import { loadParticipationSnapshot } from '../_lib/participation.js';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph } from 'docx';
import { prisma } from '../_lib/prisma-db.js';

// Lịch thi nhập/hiển thị theo giờ Việt Nam (cố định +07:00, khớp timezone của exam_settings).
const VN_OFFSET = '+07:00';
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SettingsIn = z.object({
  title: z.string().trim().min(1, 'Nhập tiêu đề bài thi.').max(200),
  openingAt: z.string().regex(LOCAL_DATETIME, 'Ngày giờ bắt đầu không hợp lệ.'),
  closingAt: z.string().regex(LOCAL_DATETIME, 'Ngày giờ kết thúc không hợp lệ.'),
  durationMinutes: z.number().int().min(1).max(600),
  multipleChoiceCount: z.number().int().min(0).max(1000),
  essayCount: z.number().int().min(0).max(1000),
  mcPointsPerQuestion: z.number().min(0.01).max(1000).multipleOf(0.01),
  essayPointsPerQuestion: z.number().min(0.01).max(1000).multipleOf(0.01),
  passingScore: z.number().min(0).max(1_000_000).multipleOf(0.01),
  showScore: z.boolean(),
  displayMode: z.enum(['paged', 'all']),
  fixedFormsEnabled: z.boolean(),
  active: z.boolean(),
}).refine((v) => v.multipleChoiceCount + v.essayCount >= 1
  && v.multipleChoiceCount + v.essayCount <= 1000,
{ message: 'Tổng số câu phải từ 1 đến 1.000.', path: ['multipleChoiceCount'] })
  .refine((v) => v.passingScore <= v.multipleChoiceCount * v.mcPointsPerQuestion
    + v.essayCount * v.essayPointsPerQuestion,
  { message: 'Điểm đạt không được vượt quá tổng điểm tối đa của đề.', path: ['passingScore'] })
  .refine((v) => Date.parse(`${v.closingAt}:00${VN_OFFSET}`) > Date.parse(`${v.openingAt}:00${VN_OFFSET}`),
  { message: 'Giờ kết thúc phải sau giờ bắt đầu.', path: ['closingAt'] });
type SettingsRow = {
  title: string; opening_at: string; closing_at: string; duration_minutes: number;
  question_count: number; mc_question_count: number; essay_question_count: number;
  mc_points_per_question: number; essay_points_per_question: number; passing_score: number;
  passing_percentage: number; show_score: boolean; active: boolean;
  display_mode?: 'paged' | 'all'; fixed_forms_enabled: boolean;
};
const toLocal = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 16);
const settingsOut = (s: SettingsRow) => ({
  title: s.title, openingAt: toLocal(s.opening_at), closingAt: toLocal(s.closing_at),
  durationMinutes: s.duration_minutes, multipleChoiceCount: s.mc_question_count, essayCount: s.essay_question_count,
  mcPointsPerQuestion: s.mc_points_per_question,
  essayPointsPerQuestion: s.essay_points_per_question,
  passingScore: s.passing_score,
  showScore: s.show_score, displayMode: s.display_mode ?? 'paged',
  fixedFormsEnabled: s.fixed_forms_enabled, active: s.active,
});
const ParticipantEmails = z.array(z.string().trim().email().max(254)).max(199);
function parseParticipantEmails(values: unknown): string[] | null {
  const parsed = ParticipantEmails.safeParse(values);
  if (!parsed.success) return null;
  const emails = [...new Set(parsed.data.map(normalizeEmail))];
  if (emails.some((email) => !isCompanyEmail(email))) return null;
  return emails;
}
async function replaceParticipantEmails(emails: string[]) {
  const { error } = await sb.rpc('replace_participant_email_allowlist', { p_emails: emails });
  if (error) throw error;
}
async function replaceParticipantEntries(emails: string[], names: (string | null)[]) {
  const { error } = await sb.rpc('replace_participant_email_allowlist_with_names', {
    p_emails: emails,
    p_names: names,
  });
  if (error) throw error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestAction = String(req.query.action);
  const maxBytes = requestAction === 'import' ? 4_500_000
    : requestAction === 'participants-import' ? 360 * 1024
      : requestAction === 'participants' ? 64 * 1024 : 16_384;
  const rid = begin(req, res, maxBytes);
  if (!rid) return;
  try {
    const action = requestAction;
    if (action === 'login' && req.method === 'POST') {
      if (await limited('admin:' + ip(req), 5, 60)) return res.status(429).json({ error: 'Quá nhiều lần thử.' });
      const p = z.object({ password: z.string().max(200) }).safeParse(req.body);
      if (!p.success || !process.env.ADMIN_PASSWORD || !safeEq(p.data.password, process.env.ADMIN_PASSWORD))
        return res.status(401).json({ error: 'Sai thông tin đăng nhập.' });
      const exp = String(Date.now() + 4 * 3600_000);
      setCookie(res, 'admin', `${exp}.${hmac(process.env.ADMIN_AUTH_SECRET!, exp)}`, 4 * 3600);
      return res.json({ ok: true });
    }
    if (!adminOk(req)) return res.status(401).json({ error: 'Chưa xác thực.' });

    if (action === 'participants' && req.method === 'GET') {
      const { data, error } = await sb.from('participant_email_allowlist').select('email').order('sequence_number');
      if (error) throw error;
      return res.json({ emails: data.map((row: any) => row.email) });
    }
    if (action === 'participation' && req.method === 'GET') {
      return res.json(await loadParticipationSnapshot());
    }
    if (action === 'retake-log' && req.method === 'GET') {
      const parsed = z.object({
        page: z.coerce.number().int().min(1).max(10000),
        search: z.string().trim().max(120),
      }).safeParse({ page: req.query.page ?? '1', search: req.query.search ?? '' });
      if (!parsed.success) return res.status(400).json({ error: 'Bộ lọc nhật ký thi lại không hợp lệ.' });
      const { page, search } = parsed.data;
      const pageSize = 20;
      const [countRows, rows] = await Promise.all([
        prisma.$queryRaw<{ total: number }[]>`
          select count(*)::integer as total from exam_retake_archives
          where ${search} = '' or strpos(lower(normalized_email), lower(${search})) > 0
            or strpos(lower(coalesce(attempt_snapshot->>'full_name', '')), lower(${search})) > 0`,
        prisma.$queryRaw<{
          id: string; original_attempt_id: string; normalized_email: string; reason: string;
          archived_at: Date; full_name: string | null; old_status: string | null;
          started_at: string | null; submitted_at: string | null;
        }[]>`
          select id, original_attempt_id, normalized_email, reason, archived_at,
            attempt_snapshot->>'full_name' as full_name,
            attempt_snapshot->>'status' as old_status,
            attempt_snapshot->>'started_at' as started_at,
            attempt_snapshot->>'submitted_at' as submitted_at
          from exam_retake_archives
          where ${search} = '' or strpos(lower(normalized_email), lower(${search})) > 0
            or strpos(lower(coalesce(attempt_snapshot->>'full_name', '')), lower(${search})) > 0
          order by archived_at desc, id desc
          limit ${pageSize} offset ${(page - 1) * pageSize}`,
      ]);
      return res.json({
        entries: rows.map((row) => ({
          id: row.id, originalAttemptId: row.original_attempt_id,
          email: row.normalized_email, fullName: row.full_name,
          reason: row.reason, authorizedAt: row.archived_at,
          oldStatus: row.old_status, startedAt: row.started_at, submittedAt: row.submitted_at,
        })),
        total: countRows[0]?.total ?? 0, page, pageSize,
      });
    }
    if (action === 'authorize-retake' && req.method === 'POST') {
      if (await limited('admin-retake:' + ip(req), 20, 60))
        return res.status(429).json({ error: 'Quá nhiều yêu cầu cấp thi lại. Vui lòng thử lại sau.' });
      const p = z.object({
        email: z.string().trim().email().max(254).refine(isCompanyEmail),
        attemptId: z.string().uuid(),
        reason: z.string().trim().min(10).max(500),
      }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Email, lượt thi hoặc lý do không hợp lệ.' });
      const { error } = await sb.rpc('authorize_exam_retake', {
        p_email: normalizeEmail(p.data.email),
        p_expected_attempt: p.data.attemptId,
        p_reason: p.data.reason,
      });
      if (error) {
        if (error.message.includes('retake_not_found'))
          return res.status(409).json({ error: 'Lượt thi đã thay đổi. Hãy làm mới danh sách trước khi cấp thi lại.' });
        if (error.message.includes('retake_not_allowed'))
          return res.status(409).json({ error: 'Email không còn trong danh sách được phép dự thi.' });
        throw error;
      }
      return res.json({ ok: true });
    }
    if (action === 'overview' && req.method === 'GET') {
      if (await limited('overview:' + ip(req), 60, 60))
        return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
      const [
        { data: settings, error: settingsError },
        { data: participants, count: participantCount, error: participantsError },
        { count: activeMultipleCount, error: multipleError },
        { count: activeEssayCount, error: essayError },
      ] = await Promise.all([
        sb.from('exam_settings').select('*').eq('id', 1).single(),
        sb.from('participant_email_allowlist').select('email,sequence_number', { count: 'exact' }).order('sequence_number'),
        sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('active', true).neq('question_type', 'essay'),
        sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('active', true).eq('question_type', 'essay'),
      ]);
      if (settingsError) throw settingsError;
      if (participantsError) throw participantsError;
      if (multipleError) throw multipleError;
      if (essayError) throw essayError;

      const fixedFormCounts = settings.fixed_forms_enabled
        ? await prisma.$queryRaw<{ form_no: number; mc_count: number; essay_count: number }[]>`
          select form_no, count(*) filter (where question_type <> 'essay')::integer as mc_count,
            count(*) filter (where question_type = 'essay')::integer as essay_count
          from exam_questions where active and form_no between 1 and 5 group by form_no`
        : [];
      const formsReady = !settings.fixed_forms_enabled || [1, 2, 3, 4, 5].every((formNo) => {
        const count = fixedFormCounts.find((row) => row.form_no === formNo);
        return count?.mc_count === settings.mc_question_count && count?.essay_count === settings.essay_question_count;
      });

      const emails = (participants ?? []).map((participant: any) => participant.email);
      const { data: attempts, error: attemptsError } = emails.length
        ? await sb.from('exam_attempts')
          .select('normalized_email,status,deadline_at')
          .in('normalized_email', emails)
        : { data: [], error: null };
      if (attemptsError) throw attemptsError;

      const attemptsByEmail = new Map<string, any>((attempts ?? []).map((attempt: any) => [attempt.normalized_email, attempt]));
      const now = Date.now();
      const participation = { notStarted: 0, inProgress: 0, overdue: 0, submitted: 0, autoSubmitted: 0 };
      for (const email of emails) {
        const attempt = attemptsByEmail.get(email);
        if (!attempt) participation.notStarted += 1;
        else if (attempt.status === 'in_progress') {
          if (Date.parse(attempt.deadline_at) <= now) participation.overdue += 1;
          else participation.inProgress += 1;
        } else if (attempt.status === 'auto_submitted') participation.autoSubmitted += 1;
        else participation.submitted += 1;
      }

      return res.json({
        settings: settingsOut(settings),
        questions: {
          activeMultiple: activeMultipleCount ?? 0,
          requiredMultiple: settings.mc_question_count * (settings.fixed_forms_enabled ? 5 : 1),
          activeEssay: activeEssayCount ?? 0,
          requiredEssay: settings.essay_question_count * (settings.fixed_forms_enabled ? 5 : 1),
          formsReady,
        },
        participants: {
          allowed: participantCount ?? emails.length,
          ...participation,
        },
        refreshedAt: new Date(now).toISOString(),
      });
    }
    if (action === 'questions' && req.method === 'GET') {
      type QuestionRow = {
        id: string;
        question_text: string;
        options: { id: string; text: string }[] | null;
        question_type: 'single' | 'multiple' | 'essay';
        points: number;
        active: boolean;
        bank_order: number;
        form_no: number | null;
        question_keys: {
          correct_options: string[] | null;
          reference_answer: string | null;
        } | {
          correct_options: string[] | null;
          reference_answer: string | null;
        }[] | null;
      };
      const questions: QuestionRow[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb.from('exam_questions')
          .select('id,question_text,options,question_type,points,active,bank_order,form_no,question_keys(correct_options,reference_answer)')
          .order('bank_order', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as QuestionRow[];
        questions.push(...rows);
        if (rows.length < pageSize) break;
      }
      return res.json({
        questions: questions.map((question) => {
          const key = Array.isArray(question.question_keys) ? question.question_keys[0] : question.question_keys;
          return {
            id: question.id,
            text: question.question_text,
            options: question.options ?? [],
            type: question.question_type,
            points: question.points,
            active: question.active,
            formNo: question.form_no,
            correct: key?.correct_options ?? [],
            referenceAnswer: key?.reference_answer ?? '',
          };
        }),
      });
    }
    if (action === 'participants' && req.method === 'POST') {
      const p = z.object({
        emails: ParticipantEmails,
        mode: z.enum(['append', 'replace']),
      }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Danh sách phải có tối đa 199 email hợp lệ.' });
      const emails = parseParticipantEmails(p.data.emails);
      if (!emails) return res.status(400).json({ error: 'Chỉ chấp nhận tối đa 199 email công ty @tanminhnhan.com.vn hợp lệ.' });
      if (p.data.mode === 'replace') {
        await replaceParticipantEmails(emails);
        return res.json({ emails, count: emails.length });
      }

      const { data: added, error } = await sb.rpc('append_participant_email_allowlist', { p_emails: emails });
      if (error?.message.includes('participant_limit'))
        return res.status(409).json({ error: 'Danh sách tối đa 199 email; email mới vượt quá giới hạn này.' });
      if (error) throw error;
      const { data, error: listError } = await sb.from('participant_email_allowlist')
        .select('email').order('sequence_number');
      if (listError) throw listError;
      return res.json({ emails: data.map((row: any) => row.email), count: data.length, added });
    }
    if (action === 'participant-template' && req.method === 'GET') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Danh sách email');
      sheet.columns = [
        { header: 'Số thứ tự', key: 'number', width: 16 },
        { header: 'Họ và tên', key: 'name', width: 32 },
        { header: 'Email công ty', key: 'email', width: 42 },
      ];
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      sheet.getCell('A1').note = 'Đánh số thứ tự liên tục từ 1.';
      sheet.getCell('B1').note = 'Có thể để trống; nếu nhập, họ tên tối đa 120 ký tự.';
      sheet.getCell('C1').note = 'Nhập tối đa 199 email công ty, mỗi dòng một địa chỉ. Ví dụ: ten.nguoidung@tanminhnhan.com.vn.';
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="mau-danh-sach-email.xlsx"');
      return res.status(200).send(buffer);
    }
    if (action === 'participants-import' && req.method === 'POST') {
      const p = z.object({ file: z.string().min(1).max(350_000) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Tệp Excel không hợp lệ hoặc vượt quá dung lượng cho phép.' });
      const buffer = Buffer.from(p.data.file, 'base64');
      if (buffer.length < 4 || buffer.length > 256 * 1024 || buffer[0] !== 0x50 || buffer[1] !== 0x4b)
        return res.status(400).json({ error: 'Chỉ hỗ trợ tệp Excel .xlsx tối đa 256 KB.' });

      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      } catch {
        return res.status(400).json({ error: 'Không đọc được tệp Excel. Hãy tải mẫu và nhập lại.' });
      }
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: 'Tệp Excel không có trang tính danh sách email.' });

      const imported = parseParticipantImportSheet(sheet);
      if (imported.error === 'invalid_layout')
        return res.status(400).json({ error: 'Mẫu cần có STT liên tục từ 1; email phải nằm đúng cột Email công ty. Có thể để trống Họ và tên.' });
      if (imported.error === 'empty') return res.status(400).json({ error: 'Tệp Excel chưa có email nào.' });
      const participantRows = imported.rows;
      if (participantRows.length > 199) return res.status(400).json({ error: 'Danh sách chỉ được có tối đa 199 email.' });
      const emails = parseParticipantEmails(participantRows.map((row) => row.email));
      if (!emails) return res.status(400).json({ error: 'Email trong tệp phải là địa chỉ công ty @tanminhnhan.com.vn hợp lệ.' });
      const nameByEmail = new Map<string, string | null>();
      for (const row of participantRows) {
        const email = normalizeEmail(row.email);
        if (!nameByEmail.has(email)) nameByEmail.set(email, row.name);
      }
      await replaceParticipantEntries(emails, emails.map((email) => nameByEmail.get(email) ?? null));
      return res.json({ emails, count: emails.length });
    }

    if (action === 'grading' && req.method === 'GET') {
      const attempts: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await sb.from('exam_attempts')
          .select('id,full_name,normalized_email,position,main_project,candidate_level,question_order,participant_order,form_no,submitted_at,correct_count,incorrect_count,scored_points,total_points,result,submit_reason,mc_points_per_question,essay_points_per_question,passing_score')
          .neq('status', 'in_progress').order('participant_order').order('submitted_at')
          .range(offset, offset + 999);
        if (error) throw error;
        attempts.push(...data);
        if (data.length < 1000) break;
      }
      const questionIds = [...new Set(attempts.flatMap((attempt) => attempt.question_order as string[]))];
      const questions: any[] = [];
      for (let offset = 0; offset < questionIds.length; offset += 100) {
        const { data, error } = await sb.from('exam_questions')
          .select('id,question_text,question_type')
          .in('id', questionIds.slice(offset, offset + 100));
        if (error) throw error;
        questions.push(...data);
      }
      const questionMap = new Map(questions.map((question) => [question.id, question]));
      const essayQuestionIds = questions.filter((question) => question.question_type === 'essay').map((question) => question.id);
      const answers: any[] = [];
      if (essayQuestionIds.length > 0) {
        for (let attemptOffset = 0; attemptOffset < attempts.length; attemptOffset += 100) {
          const attemptIds = attempts.slice(attemptOffset, attemptOffset + 100).map((attempt) => attempt.id);
          for (let questionOffset = 0; questionOffset < essayQuestionIds.length; questionOffset += 100) {
            const questionChunk = essayQuestionIds.slice(questionOffset, questionOffset + 100);
            for (let offset = 0; ; offset += 1000) {
              const { data, error } = await sb.from('exam_answers')
                .select('attempt_id,question_id,essay_response,essay_score')
                .in('attempt_id', attemptIds).in('question_id', questionChunk)
                .range(offset, offset + 999);
              if (error) {
                if (error.message.includes('essay_score')
                  && (/does not exist|schema cache/i.test(error.message))) {
                  console.error(rid, error.message);
                  return res.status(503).json({
                    error: 'Cơ sở dữ liệu chưa hỗ trợ lưu điểm tự luận. Hãy chạy migration 023_numeric_essay_grading.sql trên Supabase rồi tải lại.',
                  });
                }
                throw error;
              }
              answers.push(...data);
              if (data.length < 1000) break;
            }
          }
        }
      }
      const answerMap = new Map(answers.map((answer) => [`${answer.attempt_id}:${answer.question_id}`, answer]));
      const gradingAttempts = attempts.map((attempt) => {
        const essayQuestions = (attempt.question_order as string[])
          .map((id, index) => ({ question: questionMap.get(id), index }))
          .filter((entry) => entry.question?.question_type === 'essay');
        const essays = essayQuestions.map(({ question, index }) => {
          const answer = answerMap.get(`${attempt.id}:${question.id}`);
          return {
            questionId: question.id,
            number: index + 1,
            text: question.question_text,
            response: answer?.essay_response ?? '',
            score: answer?.essay_score ?? null,
            maxPoints: attempt.essay_points_per_question,
          };
        });
        const mcTotal = (attempt.question_order as string[])
          .filter((id) => questionMap.get(id)?.question_type !== 'essay').length;
        const pendingEssayCount = essays.filter((essay) => essay.score === null).length;
        return {
          id: attempt.id,
          participantOrder: attempt.participant_order,
          formNo: attempt.form_no,
          fullName: attempt.full_name,
          email: attempt.normalized_email,
          position: attempt.position,
          mainProject: attempt.main_project,
          candidateLevel: attempt.candidate_level,
          submittedAt: attempt.submitted_at,
          submitReason: attempt.submit_reason,
          correctCount: attempt.correct_count ?? 0,
          incorrectCount: attempt.incorrect_count ?? 0,
          mcPoints: (attempt.correct_count ?? 0) * attempt.mc_points_per_question,
          mcMaxPoints: mcTotal * attempt.mc_points_per_question,
          scoredPoints: attempt.scored_points,
          totalPoints: attempt.total_points,
          passingScore: attempt.passing_score,
          result: attempt.result,
          essays,
          pendingEssayCount,
        };
      }).filter((attempt) => attempt.essays.length > 0);
      return res.json({ attempts: gradingAttempts });
    }

    if (action === 'grade-essay-attempt' && req.method === 'POST') {
      const p = z.object({
        attemptId: z.string().uuid(),
        grades: z.array(z.object({
          questionId: z.string().uuid(),
          points: z.number().min(0).max(1000).multipleOf(0.01),
        })).max(1000),
      }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Kết quả chấm không hợp lệ.' });
      const { data, error } = await sb.rpc('grade_essay_attempt', {
        p_attempt: p.data.attemptId,
        p_grades: p.data.grades,
      });
      if (error?.message.includes('grade_essay_attempt')
        && (/does not exist|schema cache/i.test(error.message))) {
        console.error(rid, error.message);
        return res.status(503).json({
          error: 'Cơ sở dữ liệu chưa hỗ trợ lưu điểm tự luận. Hãy chạy migration 023_numeric_essay_grading.sql trên Supabase.',
        });
      }
      if (error?.message.includes('invalid_grade'))
        return res.status(400).json({
          error: 'Điểm từng câu phải từ 0 đến mức tối đa đã cấu hình, tối đa 2 chữ số thập phân. Nếu điểm hợp lệ nhưng vẫn lỗi, hãy áp dụng migration 023_numeric_essay_grading.sql trên Supabase.',
        });
      if (error?.message.includes('attempt_not_found'))
        return res.status(404).json({ error: 'Không tìm thấy bài thi.' });
      if (error?.message.includes('attempt_not_submitted'))
        return res.status(409).json({ error: 'Chỉ chấm được bài thi đã nộp.' });
      if (error?.message.includes('question_not_in_attempt') || error?.message.includes('question_not_essay'))
        return res.status(400).json({ error: 'Câu hỏi tự luận không thuộc bài thi này.' });
      if (error) throw error;
      return res.json({ grading: data });
    }

    if (action === 'projects' && req.method === 'GET') {
      const { data, error } = await sb.from('exam_projects').select('id,name,active').order('name');
      if (error) throw error;
      return res.json({ projects: data });
    }
    if (action === 'dashboard' && req.method === 'GET') {
      if (await limited('dashboard:' + ip(req), 60, 60)) return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
      const { data: projectRows, error: projectError } = await sb.from('exam_projects')
        .select('id,name,active').order('name');
      if (projectError) throw projectError;
      const pageSize = 1000;
      const attempts: {
        project_id: string | null;
        main_project: string | null;
        candidate_level: string | null;
        correct_count: number | null;
        incorrect_count: number | null;
        scored_points: number | null;
        total_points: number | null;
        result: string | null;
        submit_reason: string | null;
      }[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb.from('exam_attempts')
          .select('project_id,main_project,candidate_level,correct_count,incorrect_count,scored_points,total_points,result,submit_reason')
          .neq('status', 'in_progress').order('id').range(offset, offset + pageSize - 1);
        if (error) throw error;
        attempts.push(...data);
        if (data.length < pageSize) break;
      }

      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
      const level = typeof req.query.level === 'string' ? req.query.level : '';
      const scoreBucket = typeof req.query.scoreBucket === 'string' ? req.query.scoreBucket : '';
      if (projectId && !z.string().uuid().safeParse(projectId).success)
        return res.status(400).json({ error: 'Bộ lọc công trình không hợp lệ.' });
      if (level.length > 100) return res.status(400).json({ error: 'Bộ lọc cấp bậc không hợp lệ.' });
      if (scoreBucket && (!/^[0-4]$/.test(scoreBucket)))
        return res.status(400).json({ error: 'Bộ lọc điểm không hợp lệ.' });

      const levelOptions = [...new Set(attempts.map((attempt) => attempt.candidate_level?.trim() || 'Chưa khai báo'))]
        .sort((a, b) => a.localeCompare(b, 'vi'));
      const contextFiltered = attempts.filter((attempt) => {
        if (projectId && attempt.project_id !== projectId) return false;
        if (level && (attempt.candidate_level?.trim() || 'Chưa khai báo') !== level) return false;
        if (scoreBucket) {
          if (scoreBucketOutOfTen(attempt.scored_points, attempt.total_points) !== Number(scoreBucket)) return false;
        }
        return true;
      });
      return res.json({
        dashboard: buildExamDashboard(contextFiltered, projectRows),
        tabSwitchSummary: buildTabSwitchSummary(attempts),
        levelOptions,
      });
    }
    if (action === 'projects' && req.method === 'POST') {
      const p = z.object({ name: z.string().trim().min(1).max(200) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Tên công trình không hợp lệ.' });
      const { data, error } = await sb.from('exam_projects').insert({ name: p.data.name })
        .select('id,name,active').single();
      if (error?.code === '23505') return res.status(409).json({ error: 'Tên công trình này đã có trong danh sách.' });
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (action === 'projects' && req.method === 'DELETE') {
      const p = z.object({ id: z.string().uuid() }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Công trình cần xóa không hợp lệ.' });
      const { count, error: countError } = await sb.from('exam_attempts')
        .select('id', { count: 'exact', head: true }).eq('project_id', p.data.id);
      if (countError) throw countError;
      if ((count ?? 0) > 0)
        return res.status(409).json({ error: 'Công trình đã có bài thi lịch sử nên không thể xóa. Hãy ẩn công trình để giữ dữ liệu cũ.' });
      const { data, error } = await sb.from('exam_projects').delete()
        .eq('id', p.data.id).select('id').maybeSingle();
      if (error?.code === '23503')
        return res.status(409).json({ error: 'Công trình vừa được dùng trong bài thi nên không thể xóa. Hãy ẩn công trình để giữ dữ liệu cũ.' });
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Không tìm thấy công trình.' });
      return res.json({ id: data.id });
    }
    if (action === 'projects' && req.method === 'PUT') {
      const p = z.object({ id: z.string().uuid(), active: z.boolean() }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Cập nhật công trình không hợp lệ.' });
      if (!p.data.active) {
        const { count, error: countError } = await sb.from('exam_projects')
          .select('id', { count: 'exact', head: true }).eq('active', true);
        if (countError) throw countError;
        if ((count ?? 0) <= 1) return res.status(409).json({ error: 'Cần giữ ít nhất một công trình đang được chọn.' });
      }
      const { data, error } = await sb.from('exam_projects').update({ active: p.data.active })
        .eq('id', p.data.id).select('id,name,active').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Không tìm thấy công trình.' });
      return res.json(data);
    }
    if (action === 'settings' && req.method === 'GET') {
      const { data, error } = await sb.from('exam_settings').select('*').eq('id', 1).single();
      if (error) throw error;
      return res.json(settingsOut(data));
    }
    if (action === 'settings' && req.method === 'PUT') {
      const p = SettingsIn.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message ?? 'Cấu hình không hợp lệ.' });
      const d = p.data;
      const [{ data: current, error: currentError }, { count: attemptCount, error: attemptError }] = await Promise.all([
        sb.from('exam_settings').select('fixed_forms_enabled').eq('id', 1).single(),
        sb.from('exam_attempts').select('id', { count: 'exact', head: true }),
      ]);
      if (currentError) throw currentError;
      if (attemptError) throw attemptError;
      if (current.fixed_forms_enabled !== d.fixedFormsEnabled && (attemptCount ?? 0) > 0)
        return res.status(409).json({ error: 'Đã có lượt thi. Chỉ đổi cách chọn đề sau khi kết thúc kỳ thi và xóa các lượt thi theo quy trình lưu hồ sơ.' });
      if (d.fixedFormsEnabled) {
        const formCounts = await prisma.$queryRaw<{ form_no: number; mc_count: number; essay_count: number }[]>`
          select form_no, count(*) filter (where question_type <> 'essay')::integer as mc_count,
            count(*) filter (where question_type = 'essay')::integer as essay_count
          from exam_questions where active and form_no between 1 and 5 group by form_no`;
        if ([1, 2, 3, 4, 5].some((formNo) => {
          const count = formCounts.find((row) => row.form_no === formNo);
          return !count || count.mc_count !== d.multipleChoiceCount || count.essay_count !== d.essayCount;
        })) return res.status(409).json({ error: 'Chưa có đủ 5 đề đúng số câu theo cấu hình. Hãy nhập lại Excel 5 sheet trước khi bật.' });
      }
      const { data, error } = await sb.from('exam_settings').update({
        title: d.title,
        opening_at: `${d.openingAt}:00${VN_OFFSET}`, closing_at: `${d.closingAt}:00${VN_OFFSET}`,
        duration_minutes: d.durationMinutes, question_count: d.multipleChoiceCount + d.essayCount,
        mc_question_count: d.multipleChoiceCount, essay_question_count: d.essayCount,
        mc_points_per_question: d.mcPointsPerQuestion,
        essay_points_per_question: d.essayPointsPerQuestion,
        passing_score: d.passingScore,
        passing_percentage: Math.max(1, Math.round(d.passingScore / (
          d.multipleChoiceCount * d.mcPointsPerQuestion
          + d.essayCount * d.essayPointsPerQuestion
        ) * 100)),
        show_score: d.showScore, display_mode: d.displayMode,
        fixed_forms_enabled: d.fixedFormsEnabled, active: d.active,
        updated_at: new Date().toISOString(),
      }).eq('id', 1).select('*').single();
      if (error) {
        if (error.message.includes('mode_locked')) return res.status(409).json({ error: 'Đã có lượt thi nên không thể đổi cách chọn đề.' });
        throw error;
      }
      return res.json(settingsOut(data));
    }
    if (action === 'reconcile' && req.method === 'POST') {
      const { data, error } = await sb.rpc('reconcile_expired');
      if (error) throw error;
      return res.json({ finalized: data });
    }
    if (action === 'export' && req.method === 'GET') {
      const { error: reconcileError } = await sb.rpc('reconcile_expired');
      if (reconcileError) throw reconcileError;
      const { data: examSettings, error: examSettingsError } = await sb.from('exam_settings')
        .select('active,closing_at').eq('id', 1).single();
      if (examSettingsError) throw examSettingsError;
      if (req.query.clear === 'true') {
        if (examSettings.active && Date.parse(examSettings.closing_at) > Date.now())
          return res.status(409).json({ error: 'Chỉ có thể xóa kết quả khi kỳ thi đã đóng hoặc chưa được kích hoạt.' });
        const { count, error: activeError } = await sb.from('exam_attempts')
          .select('id', { count: 'exact', head: true }).eq('status', 'in_progress');
        if (activeError) throw activeError;
        if ((count ?? 0) > 0)
          return res.status(409).json({ error: 'Vẫn còn bài thi đang làm. Hãy chờ thí sinh nộp bài trước khi xóa kết quả.' });
        const { count: pendingGrades, error: pendingGradeError } = await sb.from('exam_attempts')
          .select('id', { count: 'exact', head: true }).neq('status', 'in_progress').is('result', null);
        if (pendingGradeError) throw pendingGradeError;
        if ((pendingGrades ?? 0) > 0)
          return res.status(409).json({ error: 'Vẫn còn bài tự luận chưa chấm xong. Hãy chấm đủ trước khi tải và xóa kết quả.' });
      }
      const pageSize = 1000;
      const idChunk = 100; // keeps PostgREST URLs short
      const attempts: any[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb.from('exam_attempts')
          .select('id,full_name,normalized_email,position,candidate_level,main_project,question_order,correct_count,incorrect_count,scored_points,total_points,result,started_at,submitted_at,submit_reason,participant_order,participant_list_name,form_no,mc_points_per_question,essay_points_per_question,passing_score')
          .neq('status', 'in_progress').order('submitted_at').order('id')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        attempts.push(...data);
        if (data.length < pageSize) break;
      }
      let exportAttempts = attempts as any[];
      if (exportAttempts.some((attempt) => attempt.participant_order == null)) {
        const { data: participants, error } = await sb.from('participant_email_allowlist')
          .select('email,sequence_number');
        if (error) throw error;
        const orderByEmail = new Map(participants.map((participant: any) => [
          normalizeEmail(participant.email), participant.sequence_number,
        ]));
        exportAttempts = exportAttempts.map((attempt) => ({
          ...attempt,
          participant_order: attempt.participant_order ?? orderByEmail.get(normalizeEmail(attempt.normalized_email)) ?? null,
        }));
      }
      if (exportAttempts.some((attempt) => attempt.participant_order == null))
        return res.status(409).json({ error: 'Không xác định được STT theo danh sách email cho một số bài thi. Hãy kiểm tra danh sách email đã nhập.' });
      const orderedAttempts = orderExportAttempts(exportAttempts);
      const questionIds = [...new Set(orderedAttempts.flatMap((a) => a.question_order as string[]))];
      const questions: any[] = [];
      for (let offset = 0; offset < questionIds.length; offset += idChunk) {
        const { data, error } = await sb.from('exam_questions')
          .select('id,question_text,options,question_type,points,question_keys(correct_options,reference_answer)')
          .in('id', questionIds.slice(offset, offset + idChunk));
        if (error) throw error;
        questions.push(...data);
      }
      const answers: any[] = [];
      for (let attemptOffset = 0; attemptOffset < orderedAttempts.length; attemptOffset += idChunk) {
        const attemptIds = orderedAttempts.slice(attemptOffset, attemptOffset + idChunk).map((a) => a.id);
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await sb.from('exam_answers')
            .select('attempt_id,question_id,selected_options,essay_response,essay_score')
            .in('attempt_id', attemptIds).range(offset, offset + pageSize - 1);
          if (error) throw error;
          answers.push(...data);
          if (data.length < pageSize) break;
        }
      }
      const wb = buildResultsWorkbook({ attempts: orderedAttempts, questions, answers });
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
      const archive: Archiver = new ZipArchive({ zlib: { level: 6 } });
      const archiveError = (error: Error) => {
        console.error(rid, error.message);
        if (!res.destroyed) res.destroy(error);
      };
      archive.on('error', archiveError);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="examination-review-${day}.zip"`);
      archive.pipe(res);
      const workbookName = `examination-results-${day}.xlsx`;
      await appendZipEntry(archive, Buffer.from(await wb.xlsx.writeBuffer()), workbookName);
      const answersByAttempt = new Map<string, any[]>();
      for (const answer of answers) {
        const items = answersByAttempt.get(answer.attempt_id) ?? [];
        items.push(answer);
        answersByAttempt.set(answer.attempt_id, items);
      }
      for (let index = 0; index < orderedAttempts.length; index++) {
        const attempt = orderedAttempts[index];
        const name = `pdfs/${adminResultPdfName(attempt, attempt.participant_order ?? index + 1)}`;
        const pdf = await buildReviewPdf({ attempt, questions, answers: answersByAttempt.get(attempt.id) ?? [] });
        await appendZipEntry(archive, pdf, name);
      }
      const finished = new Promise<void>((resolve, reject) => {
        res.once('finish', resolve);
        res.once('error', reject);
        archive.once('error', reject);
      });
      await Promise.all([archive.finalize(), finished]);
      return;
    }
    if (action === 'clear-results' && req.method === 'POST') {
      const p = z.object({ confirm: z.literal(true) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Cần xác nhận trước khi xóa dữ liệu kết quả.' });
      const { data: settings, error: settingsError } = await sb.from('exam_settings')
        .select('active,closing_at').eq('id', 1).single();
      if (settingsError) throw settingsError;
      if (settings.active && Date.parse(settings.closing_at) > Date.now())
        return res.status(409).json({ error: 'Chỉ có thể xóa kết quả khi kỳ thi đã đóng hoặc chưa được kích hoạt.' });
      const { count, error: activeError } = await sb.from('exam_attempts')
        .select('id', { count: 'exact', head: true }).eq('status', 'in_progress');
      if (activeError) throw activeError;
      if ((count ?? 0) > 0)
        return res.status(409).json({ error: 'Vẫn còn bài thi đang làm. Hãy chờ thí sinh nộp bài trước khi xóa kết quả.' });
      const { count: pendingGrades, error: pendingGradeError } = await sb.from('exam_attempts')
        .select('id', { count: 'exact', head: true }).neq('status', 'in_progress').is('result', null);
      if (pendingGradeError) throw pendingGradeError;
      if ((pendingGrades ?? 0) > 0)
        return res.status(409).json({ error: 'Vẫn còn bài tự luận chưa chấm xong. Hãy chấm đủ trước khi xóa kết quả.' });
      const { count: deleted, error } = await sb.from('exam_attempts')
        .delete({ count: 'exact' }).neq('status', 'in_progress');
      if (error) throw error;
      return res.json({ deleted: deleted ?? 0 });
    }
    if (action === 'template' && req.method === 'GET') {
      if (req.query.format === 'forms-xlsx') {
        const workbook = new ExcelJS.Workbook();
        for (let formNo = 1; formNo <= 5; formNo++) {
          const sheet = workbook.addWorksheet(`Đề ${formNo}`);
          sheet.addRow(['Câu hỏi', 'A', 'B', 'C', 'D', 'E', 'F', 'Đáp án đúng (A,C)', 'Loại', 'Điểm (đặt trong cấu hình)', 'Đáp án tham khảo']);
          sheet.getRow(1).font = { bold: true };
          sheet.columns.forEach((column, index) => { column.width = index === 0 ? 50 : index === 10 ? 60 : 18; });
        }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-5-de.xlsx"');
        return res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
      }
      if (req.query.format === 'docx') {
        const lines = [
          'HƯỚNG DẪN: mỗi câu bắt đầu bằng số thứ tự. Có thể ghi Loại: single, multiple hoặc essay (mặc định single). Số câu và điểm mỗi câu được cấu hình trong trang quản trị. Câu tự luận được người chấm nhập điểm riêng cho từng bài, không vượt quá điểm tối đa đã cấu hình.',
          'Câu trắc nghiệm ghi A-F và Đáp án: A hoặc A,C. Câu tự luận ghi Đáp án tham khảo: nội dung đáp án.',
          'Xóa ví dụ trước khi nhập câu hỏi thật.', '',
          '1. Thủ đô của Việt Nam là?', 'Loại: single',
          'A. Hà Nội', 'B. Huế', 'C. Đà Nẵng', 'D. Cần Thơ', 'Đáp án: A', '',
          '2. Chọn các số nguyên tố', 'Loại: multiple',
          'A. 2', 'B. 4', 'C. 5', 'Đáp án: A,C', '',
          '3. Trình bày một giải pháp bảo vệ môi trường', 'Loại: essay',
          'Đáp án tham khảo: Nêu được các biện pháp giảm rác thải, tiết kiệm tài nguyên và bảo vệ hệ sinh thái.',
        ];
        const buf = await Packer.toBuffer(new Document({ sections: [{ children: lines.map((t) => new Paragraph(t)) }] }));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-cau-hoi.docx"');
        return res.send(buf);
      }
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Câu hỏi');
      ws.addRow(['Câu hỏi', 'A', 'B', 'C', 'D', 'E', 'F', 'Đáp án đúng (A,C)', 'Loại', 'Điểm (đặt trong cấu hình)', 'Đáp án tham khảo']);
      ws.addRow(['Thủ đô của Việt Nam là?', 'Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ', '', '', 'A', 'single', '', '']);
      ws.addRow(['Chọn các số nguyên tố', '2', '4', '5', '', '', '', 'A,C', 'multiple', '', '']);
      ws.addRow(['Trình bày một giải pháp bảo vệ môi trường', '', '', '', '', '', '', '', 'essay', '', 'Nêu biện pháp giảm rác thải, tiết kiệm tài nguyên và bảo vệ hệ sinh thái.']);
      ws.getRow(1).font = { bold: true };
      ws.getCell(1, 10).note = 'Điểm được cấu hình tại tab Cấu hình và áp dụng đồng đều cho mỗi câu cùng loại. Giá trị trong cột này không ảnh hưởng đến điểm bài thi.';
      ws.columns.forEach((c, i) => { c.width = i === 0 ? 50 : i === 10 ? 60 : 18; });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="mau-cau-hoi.xlsx"');
      return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    if (action === 'import' && req.method === 'POST') {
      const p = z.object({ format: z.enum(['forms-xlsx', 'xlsx', 'docx']), mode: z.enum(['replace', 'append']), commit: z.boolean(), file: z.string().min(1).max(4_200_000) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
      const buf = Buffer.from(p.data.file, 'base64');
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return res.status(400).json({ error: 'Tệp không đúng định dạng Word/Excel (.docx/.xlsx).' });
      if (p.data.format === 'forms-xlsx') {
        if (p.data.mode !== 'replace') return res.status(400).json({ error: 'Tệp 5 đề chỉ hỗ trợ thay thế toàn bộ câu hỏi.' });
        const [{ data: settings, error: settingsError }, { count: attemptCount, error: attemptError }] = await Promise.all([
          sb.from('exam_settings').select('mc_question_count,essay_question_count').eq('id', 1).single(),
          sb.from('exam_attempts').select('id', { count: 'exact', head: true }),
        ]);
        if (settingsError) throw settingsError;
        if (attemptError) throw attemptError;
        let workbook: ExcelJS.Workbook;
        try {
          workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buf as unknown as ExcelJS.Buffer);
        } catch { return res.status(400).json({ error: 'Không đọc được tệp Excel 5 đề.' }); }
        const sheets = workbook.worksheets.map((sheet) => {
          const rows: { n: number; cells: string[] }[] = [];
          sheet.eachRow({ includeEmpty: false }, (row, n) => {
            rows.push({ n, cells: Array.from({ length: 11 }, (_, i) => String(row.getCell(i + 1).text ?? '').trim()) });
          });
          return { name: sheet.name, rows };
        });
        const parsed = parseFormSheets(sheets, settings.mc_question_count, settings.essay_question_count);
        const locked = (attemptCount ?? 0) > 0;
        const base = { fixedForms: true, total: parsed.items.length,
          availableMultiple: parsed.items.filter((item) => item.type !== 'essay').length,
          availableEssay: parsed.items.filter((item) => item.type === 'essay').length,
          neededMultiple: settings.mc_question_count, neededEssay: settings.essay_question_count,
          pickedMultiple: settings.mc_question_count, pickedEssay: settings.essay_question_count,
          errors: parsed.errors, locked, preview: parsed.items };
        if (!p.data.commit) return res.json({ ok: !locked && parsed.errors.length === 0, ...base });
        if (parsed.errors.length) return res.status(422).json({ error: 'Tệp còn lỗi, chưa lưu.', ...base });
        if (locked) return res.status(409).json({ error: 'Đã có thí sinh bắt đầu thi nên không thể đổi đề.' });
        const { data: saved, error } = await sb.rpc('import_fixed_forms', { p_items: parsed.items });
        if (error) { if (error.message.includes('locked')) return res.status(409).json({ error: 'Đã có thí sinh bắt đầu thi nên không thể đổi đề.' }); throw error; }
        return res.json({ ok: true, saved });
      }
      let parsed: ReturnType<typeof parseText>;
      try {
        if (p.data.format === 'xlsx') {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
          const rows: { n: number; cells: string[] }[] = [];
          wb.worksheets[0]?.eachRow({ includeEmpty: false }, (row, n) => {
            rows.push({ n, cells: Array.from({ length: 11 }, (_, i) => String(row.getCell(i + 1).text ?? '').trim()) });
          });
          parsed = parseRows(rows);
        } else {
          parsed = parseText((await mammoth.extractRawText({ buffer: buf })).value);
        }
      } catch { return res.status(400).json({ error: 'Không đọc được tệp. Hãy kiểm tra định dạng theo tệp mẫu.' }); }
      const [
        { count: attemptCount, error: attemptError },
        { data: s, error: settingsError },
        { count: activeMultipleCount, error: multipleError },
        { count: activeEssayCount, error: essayError },
      ] = await Promise.all([
        sb.from('exam_attempts').select('id', { count: 'exact', head: true }),
        sb.from('exam_settings').select('mc_question_count,essay_question_count,fixed_forms_enabled').eq('id', 1).single(),
        sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('active', true).neq('question_type', 'essay'),
        sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('active', true).eq('question_type', 'essay'),
      ]);
      if (attemptError) throw attemptError;
      if (settingsError) throw settingsError;
      if (s.fixed_forms_enabled) return res.status(409).json({ error: 'Đã bật 5 đề cố định. Hãy nhập tệp Excel 5 sheet để thay thế đề.' });
      if (multipleError) throw multipleError;
      if (essayError) throw essayError;
      const locked = (attemptCount ?? 0) > 0;
      const neededMultiple = s.mc_question_count;
      const neededEssay = s.essay_question_count;
      const currentMultiple = p.data.mode === 'replace' ? 0 : activeMultipleCount ?? 0;
      const currentEssay = p.data.mode === 'replace' ? 0 : activeEssayCount ?? 0;
      const availableMultiple = currentMultiple + parsed.items.filter((item) => item.type !== 'essay').length;
      const availableEssay = currentEssay + parsed.items.filter((item) => item.type === 'essay').length;
      const pickedMultiple = Math.min(availableMultiple, neededMultiple);
      const pickedEssay = Math.min(availableEssay, neededEssay);
      const base = {
        total: parsed.items.length, availableMultiple, availableEssay, neededMultiple, neededEssay,
        pickedMultiple, pickedEssay, errors: parsed.errors, locked, preview: parsed.items,
      };
      if (!p.data.commit) return res.json({ ok: parsed.errors.length === 0 && !locked, ...base });
      if (parsed.errors.length) return res.status(422).json({ error: 'Tệp còn lỗi, chưa lưu.', ...base });
      if (locked) return res.status(409).json({ error: 'Đã có thí sinh bắt đầu thi nên không thể đổi câu hỏi.' });
      const runImport = async (mode: 'replace' | 'append') => sb.rpc('import_questions', { p_mode: mode, p_items: parsed.items });
      let { error } = await runImport(p.data.mode);
      if (error?.message.includes('DELETE requires a WHERE clause') && p.data.mode === 'replace') {
        const cleared = await sb.from('exam_questions').delete().not('id', 'is', null);
        if (cleared.error) throw cleared.error;
        ({ error } = await runImport('append'));
      }
      if (error) { if (error.message.includes('locked')) return res.status(409).json({ error: 'Đã có thí sinh bắt đầu thi nên không thể đổi câu hỏi.' }); throw error; }
      return res.json({ ok: true, saved: parsed.items.length });
    }
    return res.status(404).json({ error: 'Không tìm thấy.' });
  } catch (e) {
    if (res.headersSent) {
      console.error(rid, (e as Error)?.message);
      if (!res.destroyed) res.destroy(e as Error);
      return;
    }
    return fail(res, rid, e);
  }
}
