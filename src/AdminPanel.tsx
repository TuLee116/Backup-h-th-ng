import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/be-vietnam-pro/800.css';
import { api } from './api';
import { useUi } from './ui';
import './admin.css';
import type { ExamDashboard, DashboardMetric } from '../api/_lib/dashboard';

type Item = {
  text: string; type: 'single' | 'multiple' | 'essay'; points: number;
  options: { id: string; text: string }[]; correct: string[]; referenceAnswer: string;
};
type BankQuestion = {
  id: string; text: string; type: Item['type']; points: number; active: boolean;
  formNo: number | null;
  options: Item['options']; correct: string[]; referenceAnswer: string;
};
type Preview = {
  ok: boolean; total: number; availableMultiple: number; availableEssay: number;
  neededMultiple: number; neededEssay: number; pickedMultiple: number; pickedEssay: number;
  fixedForms?: boolean; locked: boolean; errors: { ref: string; message: string }[];
  preview: (Item & { formNo?: number })[];
};
type Run = (f: () => Promise<void>) => Promise<void>;
type Settings = {
  title: string; openingAt: string; closingAt: string; durationMinutes: number;
  multipleChoiceCount: number; essayCount: number;
  mcPointsPerQuestion: number; essayPointsPerQuestion: number; passingScore: number; showScore: boolean;
  displayMode: 'paged' | 'all'; fixedFormsEnabled: boolean; active: boolean;
};
type Project = { id: string; name: string; active: boolean };
type EssayGrade = {
  questionId: string; number: number; text: string;
  response: string; score: number | null; maxPoints: number;
};
type GradeAttempt = {
  id: string; participantOrder: number | null; formNo: number | null; fullName: string; email: string;
  position: string; mainProject: string; candidateLevel: string; submittedAt: string;
  submitReason: string | null;
  correctCount: number; incorrectCount: number; mcPoints: number; mcMaxPoints: number;
  scoredPoints: number | null; totalPoints: number | null; passingScore: number; result: 'PASS' | 'FAIL' | null;
  essays: EssayGrade[]; pendingEssayCount: number;
};

const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('Không đọc được tệp.')); r.readAsDataURL(f); });
const inputCls = 'admin-control w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition focus:outline-none';
const btnPrimary = 'admin-button admin-button-primary inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const btnDark = 'admin-button admin-button-dark inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost = 'admin-button admin-button-ghost inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const btnDanger = 'admin-button admin-button-danger inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50';

function Card({ id, title, desc, children }: { id: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="admin-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="admin-card-heading">
        <h2 id={id} className="text-base font-semibold text-slate-900">{title}</h2>
        {desc && <p className="mt-1 text-sm text-slate-500">{desc}</p>}
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={'admin-field block ' + className}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="admin-switch flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-700 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-700 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

const MODES: { id: Settings['displayMode']; title: string; desc: string }[] = [
  { id: 'paged', title: 'Từng câu một', desc: 'Thí sinh làm lần lượt từng câu, dùng nút Câu trước/Câu sau hoặc bảng số câu.' },
  { id: 'all', title: 'Hiện tất cả câu cùng lúc', desc: 'Toàn bộ câu hỏi nằm trên một trang cuộn xuống; bảng số câu giúp nhảy nhanh tới từng câu.' },
];

function SettingsForm({ run }: { run: Run }) {
  const { toast } = useUi();
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Settings>('admin/settings').then(setS).catch((e: Error) => toast('error', e.message)); }, [toast]);
  if (!s) return <p className="text-sm text-slate-500">Đang tải cấu hình…</p>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const totalQuestionCount = s.multipleChoiceCount + s.essayCount;
  const maximumScore = s.multipleChoiceCount * s.mcPointsPerQuestion
    + s.essayCount * s.essayPointsPerQuestion;
  const questionCountIsValid = totalQuestionCount >= 1 && totalQuestionCount <= 1000
    && s.mcPointsPerQuestion > 0 && s.essayPointsPerQuestion > 0
    && s.passingScore >= 0 && s.passingScore <= maximumScore;
  const save = () => void run(async () => {
    if (!questionCountIsValid) return;
    setBusy(true);
    try { setS(await api<Settings>('admin/settings', { method: 'PUT', body: JSON.stringify(s) })); toast('success', 'Đã lưu cấu hình kỳ thi.'); }
    finally { setBusy(false); }
  });
  return (
    <div className="space-y-6">
      <Card id="cfg-general" title="Thông tin bài kiểm tra" desc="Thời gian nhập theo giờ Việt Nam.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tiêu đề" className="sm:col-span-2"><input className={inputCls} value={s.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Thời gian bắt đầu"><input type="datetime-local" className={inputCls} value={s.openingAt} onChange={(e) => set('openingAt', e.target.value)} /></Field>
          <Field label="Thời gian kết thúc"><input type="datetime-local" className={inputCls} value={s.closingAt} onChange={(e) => set('closingAt', e.target.value)} /></Field>
          
          <Field label="Số câu trắc nghiệm">
            <input type="number" min={0} max={1000} className={inputCls} value={s.multipleChoiceCount} onChange={(e) => set('multipleChoiceCount', Number(e.target.value))} />
          </Field>

          <Field label="Điểm trắc nghiệm (mỗi câu)" >
            <input type="number" min={0.01} max={1000} step={0.01} className={inputCls} value={s.mcPointsPerQuestion} onChange={(e) => set('mcPointsPerQuestion', Number(e.target.value))} />
          </Field>
          <Field label="Số câu tự luận">
            <input type="number" min={0} max={1000} className={inputCls} value={s.essayCount} onChange={(e) => set('essayCount', Number(e.target.value))} />
          </Field>
          
          <Field label="Điểm tự luận (mỗi câu)" >
            <input type="number" min={0.01} max={1000} step={0.01} className={inputCls} value={s.essayPointsPerQuestion} onChange={(e) => set('essayPointsPerQuestion', Number(e.target.value))} />
          </Field>

          <Field label="Thời lượng làm bài (phút)"><input type="number" min={1} max={600} className={inputCls} value={s.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} /></Field>
          <Field label="Điểm đạt" hint={`Tối đa ${maximumScore.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} điểm cho đề này.`}>
            <input type="number" min={0} max={maximumScore} step={0.01} className={inputCls} value={s.passingScore} onChange={(e) => set('passingScore', Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card id="cfg-mode" title="Cách hiển thị bài làm" desc="Áp dụng cho các thí sinh bắt đầu hoặc tải lại bài thi sau khi lưu.">
        <div role="radiogroup" aria-labelledby="cfg-mode" className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <label key={m.id} className={'flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition ' + (s.displayMode === m.id ? 'border-blue-700 bg-blue-50' : 'border-slate-200 hover:border-slate-300')}>
              <input type="radio" name="displayMode" className="mt-1 accent-blue-700" checked={s.displayMode === m.id} onChange={() => set('displayMode', m.id)} />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{m.title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-600">{m.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card id="cfg-forms" title="Cách chọn đề" desc="Áp dụng cho lượt thi bắt đầu sau khi lưu. Khi đã có lượt thi, cần kết thúc kỳ thi và lưu hồ sơ trước khi đổi chế độ.">
        <div role="radiogroup" aria-labelledby="cfg-forms" className="grid gap-3 sm:grid-cols-2">
          <label className={'flex cursor-pointer gap-3 rounded-xl border-2 p-4 ' + (!s.fixedFormsEnabled ? 'border-blue-700 bg-blue-50' : 'border-slate-200')}>
            <input type="radio" name="fixedFormsEnabled" checked={!s.fixedFormsEnabled} onChange={() => set('fixedFormsEnabled', false)} />
            <span><strong className="block text-sm">Một đề xáo trộn</strong><span className="text-xs text-slate-600">Chọn câu ngẫu nhiên từ ngân hàng hiện có.</span></span>
          </label>
          <label className={'flex cursor-pointer gap-3 rounded-xl border-2 p-4 ' + (s.fixedFormsEnabled ? 'border-blue-700 bg-blue-50' : 'border-slate-200')}>
            <input type="radio" name="fixedFormsEnabled" checked={s.fixedFormsEnabled} onChange={() => set('fixedFormsEnabled', true)} />
            <span><strong className="block text-sm">5 đề cố định</strong><span className="text-xs text-slate-600">STT 1–5 nhận đề 1–5, STT 6 quay lại đề 1. Cần nhập Excel 5 sheet trước.</span></span>
          </label>
        </div>
      </Card>

      <Card id="cfg-access" title="Truy cập và kết quả">
        <div className="grid gap-3 sm:grid-cols-2">
          <Switch checked={s.active} onChange={(v) => set('active', v)} label="Mở kỳ thi" hint="Tắt để đóng ngay lập tức." />
          <Switch checked={s.showScore} onChange={(v) => set('showScore', v)} label="Hiện điểm" hint="Hiện tổng điểm và kết quả sau khi chấm xong tự luận." />
        </div>
      </Card>

      <div className="flex justify-end">
        <button className={btnPrimary} disabled={busy || !questionCountIsValid} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</button>
      </div>
    </div>
  );
}

function Projects({ run }: { run: Run }) {
  const { confirm, toast } = useUi();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => api<{ projects: Project[] }>('admin/projects').then((r) => setProjects(r.projects));
  useEffect(() => { void reload().catch((e: Error) => toast('error', e.message)); }, [toast]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setBusy(true);
      try {
        const project = await api<Project>('admin/projects', { method: 'POST', body: JSON.stringify({ name }) });
        setProjects((current) => [...(current ?? []), project].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
        setName('');
        toast('success', 'Đã thêm công trình vào danh sách.');
      } finally {
        setBusy(false);
      }
    });
  };

  const setActive = (project: Project) => void run(async () => {
    const updated = await api<Project>('admin/projects', {
      method: 'PUT',
      body: JSON.stringify({ id: project.id, active: !project.active }),
    });
    setProjects((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? []);
    toast('success', updated.active ? 'Đã mở lựa chọn công trình.' : 'Đã ẩn công trình khỏi lựa chọn; dữ liệu bài thi cũ được giữ nguyên.');
  });

  const deleteProject = (project: Project) => void run(async () => {
    const ok = await confirm({
      title: `Xóa công trình "${project.name}"?`,
      message: 'Chỉ xóa được công trình chưa có bài thi liên quan. Nếu đã có dữ liệu cũ, hãy dùng nút Ẩn để giữ lịch sử và thống kê.',
      confirmText: 'Xóa công trình',
      danger: true,
    });
    if (!ok) return;
    await api<{ id: string }>('admin/projects', {
      method: 'DELETE',
      body: JSON.stringify({ id: project.id }),
    });
    setProjects((current) => current?.filter((item) => item.id !== project.id) ?? []);
    toast('success', 'Đã xóa công trình.');
  });

  return (
    <Card id="project-catalog" title="Danh sách công trình" desc="Có thể xóa công trình chưa từng được dùng. Công trình đã liên quan đến bài thi chỉ có thể ẩn để giữ dữ liệu lịch sử.">
      <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Tên công trình mới" className="flex-1">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </Field>
        <button className={btnPrimary} disabled={busy || !name.trim()}>{busy ? 'Đang thêm…' : 'Thêm công trình'}</button>
      </form>
      {projects === null ? <p className="text-sm text-slate-500">Đang tải danh sách…</p>
        : projects.length === 0 ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Chưa có công trình. Hãy thêm danh sách trước khi mở kỳ thi cho thí sinh.</p>
          : <ul className="max-h-80 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between gap-4 px-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">{project.name}</span>
                  <span className={'text-xs ' + (project.active ? 'text-emerald-700' : 'text-slate-500')}>{project.active ? 'Đang cho phép chọn' : 'Đã ẩn · dữ liệu lịch sử được giữ'}</span>
                </span>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className={project.active ? btnGhost : btnPrimary}
                    onClick={() => setActive(project)}>
                    {project.active ? 'Ẩn' : 'Kích hoạt'}
                  </button>
                  <button type="button" className={btnDanger} onClick={() => deleteProject(project)}>Xóa</button>
                </div>
              </li>
            ))}
          </ul>}
    </Card>
  );
}

const MAX_PARTICIPANTS = 199;
const COMPANY_EMAIL = /^[^\s@]+@tanminhnhan\.com\.vn$/i;
type Participation = {
  sequenceNumber: number; name: string | null; email: string; attemptId: string | null;
  formNo: number | null;
  status: 'not_started' | 'in_progress' | 'overdue' | 'submitted' | 'auto_submitted';
  startedAt: string | null; submittedAt: string | null; submitReason: string | null;
};
type RetakeLogEntry = {
  id: string; originalAttemptId: string; email: string; fullName: string | null;
  reason: string; authorizedAt: string; oldStatus: string | null;
  startedAt: string | null; submittedAt: string | null;
};
type RetakeLogResponse = { entries: RetakeLogEntry[]; total: number; page: number; pageSize: number };
type OverviewData = {
  settings: Settings;
  questions: { activeMultiple: number; requiredMultiple: number; activeEssay: number; requiredEssay: number; formsReady: boolean };
  participants: {
    allowed: number; notStarted: number; inProgress: number; overdue: number; submitted: number; autoSubmitted: number;
  };
  refreshedAt: string;
};
const participationDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value))
  : '—';

function ParticipationMonitor({ run, onViewRetakeLog }: { run: Run; onViewRetakeLog: () => void }) {
  const { confirm, toast } = useUi();
  const [participation, setParticipation] = useState<Participation[] | null>(null);
  const [refreshedAt, setRefreshedAt] = useState('');
  const [streamState, setStreamState] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | Participation['status']>('all');
  const [page, setPage] = useState(1);
  const [selectedRetake, setSelectedRetake] = useState<Participation | null>(null);
  const [retakeReason, setRetakeReason] = useState('');
  const [retakeBusy, setRetakeBusy] = useState(false);
  const latestSnapshotAt = useRef(0);
  const applySnapshot = useCallback((result: { participants: Participation[]; refreshedAt: string }) => {
    const receivedAt = Date.parse(result.refreshedAt);
    if (receivedAt < latestSnapshotAt.current) return;
    latestSnapshotAt.current = receivedAt;
    setParticipation(result.participants);
    setRefreshedAt(result.refreshedAt);
  }, []);
  const reload = useCallback(async () => {
    const result = await api<{ participants: Participation[]; refreshedAt: string }>('admin/participation');
    applySnapshot(result);
  }, [applySnapshot]);
  useEffect(() => {
    let active = true;
    const stream = new EventSource('/api/admin/stream/participation');
    stream.onopen = () => { if (active) setStreamState('live'); };
    stream.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data) as { participants: Participation[]; refreshedAt: string };
        if (!active) return;
        applySnapshot(result);
        setStreamState('live');
      } catch {
        if (active) setStreamState('reconnecting');
      }
    };
    stream.onerror = () => { if (active) setStreamState('reconnecting'); };
    void api<{ participants: Participation[]; refreshedAt: string }>('admin/participation')
      .then((result) => { if (active) applySnapshot(result); })
      .catch((error: Error) => { if (active) toast('error', error.message); });
    return () => { active = false; stream.close(); };
  }, [applySnapshot, toast]);

  const refresh = () => void run(async () => {
    setRefreshing(true);
    try { await reload(); }
    finally { setRefreshing(false); }
  });
  const authorizeRetake = () => void run(async () => {
    if (!selectedRetake?.attemptId || retakeReason.trim().length < 10 || retakeBusy) return;
    if (!(await confirm({
      title: `Cho ${selectedRetake.email} thi lại?`,
      message: 'Bài cũ sẽ được lưu vào hồ sơ đối chiếu. Phiên thi cũ hết hiệu lực ngay, kể cả khi đang làm; thí sinh cần tải lại trang để bắt đầu bài mới.',
      confirmText: 'Cấp thi lại',
      danger: true,
    }))) return;
    setRetakeBusy(true);
    try {
      await api('admin/authorize-retake', { method: 'POST', body: JSON.stringify({
        email: selectedRetake.email, attemptId: selectedRetake.attemptId, reason: retakeReason.trim(),
      }) });
      await reload();
      setSelectedRetake(null);
      setRetakeReason('');
      toast('success', `Đã cho phép ${selectedRetake.email} thi lại.`);
    } finally { setRetakeBusy(false); }
  });
  const notStartedCount = participation?.filter((item) => item.status === 'not_started').length ?? 0;
  const inProgressCount = participation?.filter((item) => item.status === 'in_progress' || item.status === 'overdue').length ?? 0;
  const submittedCount = participation?.filter((item) => item.status === 'submitted').length ?? 0;
  const autoSubmittedCount = participation?.filter((item) => item.status === 'auto_submitted').length ?? 0;
  const visibleParticipation = participation?.filter((item) =>
    filter === 'all' || item.status === filter) ?? [];
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(visibleParticipation.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageParticipation = visibleParticipation.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstVisible = visibleParticipation.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastVisible = Math.min(currentPage * pageSize, visibleParticipation.length);

  return (
    <Card id="active-participation" title="Theo dõi tiến độ dự thi"
      desc="Trạng thái hiện tại của danh sách thí sinh được phép tham gia kỳ thi.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className={'admin-participation-live ' + (streamState === 'live' ? 'is-live' : '')} role="status">
            {streamState === 'live' ? 'Đang cập nhật trực tiếp' : streamState === 'connecting' ? 'Đang kết nối…' : 'Mất kết nối · đang thử lại…'}
          </span>
          <span>{refreshedAt ? `Cập nhật lần cuối: ${participationDate(refreshedAt)}` : 'Đang tải trạng thái…'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGhost} onClick={onViewRetakeLog}>Xem nhật ký thi lại</button>
          <button type="button" className={btnGhost} disabled={refreshing} onClick={refresh}>
            {refreshing ? 'Đang làm mới…' : 'Làm mới trạng thái'}
          </button>
        </div>
      </div>
      {participation !== null && (
        <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <p className="admin-stat admin-stat-neutral rounded-lg p-3">Chưa bắt đầu <b>{notStartedCount}</b></p>
          <p className="admin-stat admin-stat-warning rounded-lg p-3">Đang thi / quá hạn <b>{inProgressCount}</b></p>
          <p className="admin-stat admin-stat-success rounded-lg p-3">Đã nộp <b>{submittedCount}</b></p>
          <p className="admin-stat admin-stat-warning rounded-lg p-3">Nộp tự động <b>{autoSubmittedCount}</b></p>
        </div>
      )}
      {participation === null ? (
        <p role="status" className="text-sm text-slate-500">Đang tải danh sách tham gia…</p>
      ) : participation.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          Chưa có thí sinh nào trong danh sách được phép dự thi.
        </p>
      ) : (
        <>
          <div className="admin-participation-toolbar">
            <Field label="Lọc theo trạng thái" className="admin-participation-filter">
              <select className={inputCls} value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as typeof filter);
                  setPage(1);
                }}>
                <option value="all">Tất cả ({participation.length})</option>
                <option value="not_started">Chưa bắt đầu ({notStartedCount})</option>
                <option value="in_progress">
                  Đang làm ({participation.filter((item) => item.status === 'in_progress').length})
                </option>
                <option value="overdue">
                  Quá hạn · chưa chốt ({participation.filter((item) => item.status === 'overdue').length})
                </option>
                <option value="submitted">Đã nộp ({submittedCount})</option>
                <option value="auto_submitted">Nộp tự động ({autoSubmittedCount})</option>
              </select>
            </Field>
            <p className="admin-participation-note">Nộp tự động có thể do chuyển tab hoặc hết giờ. Lý do được ghi trong từng trạng thái.</p>
          </div>
          <div className="admin-table-frame max-h-[36rem] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[42rem] divide-y divide-slate-200 text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2">STT / Họ tên</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Bắt đầu</th>
                  <th className="px-3 py-2">Nộp bài</th>
                  <th className="px-3 py-2">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageParticipation.map((item) => {
                  const statusLabel = item.status === 'not_started' ? 'Chưa bắt đầu'
                    : item.status === 'in_progress' ? 'Đang làm'
                      : item.status === 'overdue' ? 'Quá hạn · chưa chốt'
                        : item.status === 'auto_submitted'
                          ? item.submitReason === 'tab_switch' ? 'Vi phạm chuyển tab'
                            : item.submitReason === 'deadline' ? 'Nộp tự động · hết giờ' : 'Nộp tự động'
                          : 'Đã nộp';
                  const statusClass = item.status === 'not_started' ? 'admin-status admin-status-neutral'
                    : item.status === 'in_progress' ? 'admin-status admin-status-info'
                      : item.status === 'overdue' ? 'admin-status admin-status-warning'
                        : item.status === 'auto_submitted'
                          ? item.submitReason === 'tab_switch' ? 'admin-status admin-status-danger' : 'admin-status admin-status-warning'
                        : 'admin-status admin-status-success';
                  return (
                    <tr key={item.email}>
                      <td className="px-3 py-2 text-slate-800">
                        <span className="font-medium">{item.sequenceNumber}. {item.name || '—'}</span>
                        {item.formNo && <span className="ml-2 text-xs font-semibold text-blue-800">Đề {item.formNo}</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600 break-all">{item.email}</td>
                      <td className="px-3 py-2"><span className={statusClass}>{statusLabel}</span></td>
                      <td className="px-3 py-2 text-slate-600">{participationDate(item.startedAt)}</td>
                      <td className="px-3 py-2 text-slate-600">{participationDate(item.submittedAt)}</td>
                      <td className="px-3 py-2">
                        {item.attemptId ? (
                          <button type="button" className={btnGhost} disabled={retakeBusy}
                            onClick={() => { setSelectedRetake(item); setRetakeReason(''); }}>
                            Cấp thi lại
                          </button>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {pageParticipation.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Không có thí sinh ở trạng thái này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {selectedRetake && (
            <section aria-label="Cấp thi lại" className="admin-retake-panel space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Cấp thi lại cho {selectedRetake.name || selectedRetake.email}</h3>
                <p className="mt-1 text-sm text-slate-600">{selectedRetake.email} · Lượt bắt đầu {participationDate(selectedRetake.startedAt)}</p>
              </div>
              <Field label="Lý do cấp thi lại" hint="Ghi nội dung báo cáo sự cố để lưu cùng hồ sơ lượt thi cũ.">
                <textarea className={inputCls} value={retakeReason} maxLength={500}
                  onChange={(event) => setRetakeReason(event.target.value)}
                  placeholder="Ví dụ: Thí sinh báo mất kết nối mạng khi đang làm bài…" />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={btnGhost} disabled={retakeBusy}
                  onClick={() => setSelectedRetake(null)}>Hủy</button>
                <button type="button" className={btnDanger} disabled={retakeBusy || retakeReason.trim().length < 10}
                  onClick={authorizeRetake}>{retakeBusy ? 'Đang cấp…' : 'Xác nhận cấp thi lại'}</button>
              </div>
            </section>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              Hiển thị {firstVisible}–{lastVisible} / {visibleParticipation.length} thí sinh
            </p>
            <div className="flex items-center gap-2">
              <button type="button" className={btnGhost} disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}>Trang trước</button>
              <span className="min-w-20 text-center text-xs text-slate-600">
                Trang {currentPage} / {pageCount}
              </span>
              <button type="button" className={btnGhost} disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}>Trang sau</button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

const retakeLogDate = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium',
});

function RetakeLog() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [log, setLog] = useState<RetakeLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), search });
    setLoading(true);
    setError('');
    void api<RetakeLogResponse>(`admin/retake-log?${query}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setLog(result); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, search, refreshKey]);

  const total = log?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (log?.pageSize ?? 20)));
  return (
    <Card id="retake-log-title" title="Lịch sử cấp thi lại"
      desc="Mỗi lần cấp quyền thi lại được lưu cùng lý do và thời điểm. Hồ sơ lượt thi cũ vẫn được giữ trong database.">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex w-full flex-wrap items-end gap-2 sm:w-auto" onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}>
          <Field label="Tìm theo tên hoặc email" className="min-w-56 flex-1 sm:w-72">
            <input type="search" className={inputCls} value={searchInput} maxLength={120}
              onChange={(event) => setSearchInput(event.target.value)} placeholder="Nhập tên hoặc email thí sinh" />
          </Field>
          <button type="submit" className={btnPrimary}>Tìm kiếm</button>
        </form>
        <button type="button" className={btnGhost} disabled={loading}
          onClick={() => setRefreshKey((value) => value + 1)}>
          {loading ? 'Đang tải…' : 'Làm mới nhật ký'}
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        Không tải được nhật ký: {error}
      </p>}
      {loading && <p role="status" className="text-sm text-slate-500">Đang tải nhật ký thi lại…</p>}
      {!loading && !error && log && (
        <>
          <p className="text-xs text-slate-600">{search ? `Có ${total} lần cấp thi lại phù hợp.` : `Đã ghi ${total} lần cấp thi lại.`}</p>
          {log.entries.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              {search ? 'Không tìm thấy lần cấp thi lại nào theo tên hoặc email này.' : 'Chưa có lần cấp thi lại nào được ghi nhận.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
              {log.entries.map((entry) => {
                const oldStatus = entry.oldStatus === 'in_progress' ? 'Đang làm bài'
                  : entry.oldStatus === 'submitted' ? 'Đã nộp bài'
                    : entry.oldStatus === 'auto_submitted' ? 'Nộp tự động' : 'Không rõ trạng thái';
                const statusClass = entry.oldStatus === 'in_progress' ? 'admin-status admin-status-info'
                  : entry.oldStatus === 'submitted' ? 'admin-status admin-status-success'
                    : 'admin-status admin-status-warning';
                return (
                  <article key={entry.id} className="grid gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-5 sm:p-5">
                    <div className="text-xs text-slate-500">
                      <time className="block font-semibold text-slate-700" dateTime={entry.authorizedAt}>
                        {retakeLogDate.format(new Date(entry.authorizedAt))}
                      </time>
                      <span className="mt-1 block">Cấp quyền thi lại</span>
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{entry.fullName || entry.email}</h3>
                          <p className="break-all text-xs text-slate-600">{entry.email}</p>
                        </div>
                        <span className={statusClass}>{oldStatus}</span>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-xs font-semibold text-slate-600">Lý do cấp thi lại</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">{entry.reason}</p>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        Bắt đầu lượt cũ: {participationDate(entry.startedAt)} · Nộp bài: {participationDate(entry.submittedAt)}
                        <span className="block break-all">Mã lượt cũ: {entry.originalAttemptId}</span>
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <span>Trang {page} / {pageCount}</span>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}>Trang trước</button>
              <button type="button" className={btnGhost} disabled={page >= pageCount}
                onClick={() => setPage((value) => value + 1)}>Trang sau</button>
            </div>
          </div>}
        </>
      )}
    </Card>
  );
}

function ExamOverview({ onViewParticipation }: { onViewParticipation: () => void }) {
  const { toast } = useUi();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      setOverview(await api<OverviewData>('admin/overview'));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không tải được trạng thái kỳ thi.';
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload().catch((e: Error) => toast('error', e.message)); }, [toast]);

  const refresh = () => {
    setRefreshing(true);
    void reload().catch((e: Error) => toast('error', e.message)).finally(() => setRefreshing(false));
  };
  if (loading && !overview) return <p role="status" className="text-sm text-slate-500">Đang tải trạng thái kỳ thi…</p>;
  if (!overview) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800">
        <span>{error || 'Không tải được trạng thái kỳ thi.'}</span>
        <button type="button" className={btnGhost} onClick={refresh}>Thử lại</button>
      </div>
    );
  }

  const { settings, questions, participants } = overview;
  const openedAt = Date.parse(`${settings.openingAt}:00+07:00`);
  const closedAt = Date.parse(`${settings.closingAt}:00+07:00`);
  const scheduleReady = Number.isFinite(openedAt) && Number.isFinite(closedAt) && closedAt > openedAt;
  const now = Date.now();
  const examStatus = !settings.active ? 'Đang tắt'
    : now < openedAt ? 'Đã bật · chờ mở'
      : now < closedAt ? 'Đang mở'
        : 'Đã hết giờ';
  const multipleReady = questions.activeMultiple >= questions.requiredMultiple && questions.formsReady;
  const essayReady = questions.activeEssay >= questions.requiredEssay && questions.formsReady;
  const started = Math.max(0, participants.allowed - participants.notStarted);
  const startedPercent = participants.allowed ? Math.round((started / participants.allowed) * 100) : 0;
  const tasks: string[] = [];
  if (questions.activeMultiple < questions.requiredMultiple) tasks.push(`Bổ sung ${questions.requiredMultiple - questions.activeMultiple} câu trắc nghiệm đang hoạt động.`);
  if (questions.activeEssay < questions.requiredEssay) tasks.push(`Bổ sung ${questions.requiredEssay - questions.activeEssay} câu tự luận đang hoạt động.`);
  if (!questions.formsReady) tasks.push('Kiểm tra đủ số câu trắc nghiệm và tự luận trong từng đề 1–5.');
  if (participants.allowed === 0) tasks.push('Thêm danh sách email được phép dự thi.');
  if (!scheduleReady) tasks.push('Kiểm tra lại thời gian mở và đóng kỳ thi.');
  if (!settings.active) tasks.push('Bật kỳ thi khi đã hoàn tất chuẩn bị.');
  const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short',
  });
  const formatSchedule = (value: string) => {
    const time = Date.parse(`${value}:00+07:00`);
    return Number.isFinite(time) ? dateFormatter.format(time) : 'Chưa thiết lập';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Cập nhật lần cuối: {participationDate(overview.refreshedAt)}</p>
        <button type="button" className={btnGhost} disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Đang cập nhật…' : 'Làm mới tổng quan'}
        </button>
      </div>

      <section className="admin-overview-hero" aria-label="Trạng thái kỳ thi">
        <div>
          <p className="admin-hero-kicker"><span className={'admin-live-dot ' + (settings.active && now >= openedAt && now < closedAt ? '' : 'is-idle')} />{examStatus}</p>
          <h2>{settings.title}</h2>
          <p>Thí sinh được phép truy cập theo danh sách email đã duyệt.</p>
          <div className="admin-hero-meta">
            <span>Mở: {formatSchedule(settings.openingAt)}</span>
            <span>Đóng: {formatSchedule(settings.closingAt)}</span>
            <span>{settings.durationMinutes} phút / bài</span>
          </div>
        </div>
        <span className="admin-hero-chip">{multipleReady && essayReady && participants.allowed > 0 && scheduleReady ? 'Điều kiện đã sẵn sàng' : 'Cần kiểm tra điều kiện'}</span>
      </section>

      <div className="admin-kpi-grid">
        <div className="admin-kpi admin-kpi-blue"><span>Thí sinh hợp lệ</span><strong>{participants.allowed}<small> / 199</small></strong><p>Danh sách được phép dự thi</p></div>
        <div className="admin-kpi admin-kpi-green"><span>Đã bắt đầu thi</span><strong>{started}<small> / {participants.allowed}</small></strong><p>{startedPercent}% số thí sinh hợp lệ</p></div>
        <div className="admin-kpi admin-kpi-amber"><span>Chưa bắt đầu</span><strong>{participants.notStarted}</strong><p>Thí sinh chưa vào bài thi</p></div>
        <div className="admin-kpi admin-kpi-red"><span>Nộp tự động</span><strong>{participants.autoSubmitted}</strong><p>Do chuyển tab hoặc hết giờ</p></div>
      </div>

      <div className="admin-overview-columns">
      <Card id="overview-readiness" title="Mức sẵn sàng" desc="Các điều kiện hiện tại để tổ chức kỳ thi theo cấu hình.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className={`admin-readiness-item ${multipleReady && essayReady ? 'is-ready' : 'is-pending'}`}>
            <span className="admin-overview-label">Ngân hàng câu hỏi</span>
            <strong>{questions.activeMultiple}/{questions.requiredMultiple} TN · {questions.activeEssay}/{questions.requiredEssay} TL</strong>
            <span>{multipleReady && essayReady ? 'Đủ số câu theo cấu hình' : 'Chưa đủ câu đang hoạt động'}</span>
          </div>
          <div className={`admin-readiness-item ${participants.allowed > 0 ? 'is-ready' : 'is-pending'}`}>
            <span className="admin-overview-label">Danh sách email</span>
            <strong>{participants.allowed} người</strong>
            <span>{participants.allowed > 0 ? 'Có thí sinh được phép dự thi' : 'Chưa có thí sinh được cấp quyền'}</span>
          </div>
          <div className={`admin-readiness-item ${scheduleReady ? 'is-ready' : 'is-pending'}`}>
            <span className="admin-overview-label">Thời gian mở / đóng</span>
            <strong>{scheduleReady ? 'Đã đặt thời gian' : 'Cần kiểm tra'}</strong>
            <span>{scheduleReady ? 'Thời gian kết thúc sau thời gian bắt đầu' : 'Lịch thi chưa hợp lệ'}</span>
          </div>
          <div className={`admin-readiness-item ${settings.active ? 'is-ready' : 'is-pending'}`}>
            <span className="admin-overview-label">Kỳ thi</span>
            <strong>{settings.active ? 'Đã bật' : 'Đang tắt'}</strong>
            <span>{settings.active ? 'Cho phép bắt đầu theo lịch đã đặt' : 'Chưa cho phép thí sinh bắt đầu'}</span>
          </div>
          <div className="admin-readiness-item is-ready">
            <span className="admin-overview-label">Chế độ</span>
            <strong>Chính thức · mặc định</strong>
            <span>Bảo vệ chuyển tab bật mặc định khi thí sinh bắt đầu bài thi.</span>
          </div>
        </div>
      </Card>

      <Card id="overview-participation" title="Tiến độ tham gia" desc="Tóm tắt tình trạng của danh sách thí sinh được phép dự thi.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-800">
            Đã bắt đầu {started}/{participants.allowed} thí sinh ({startedPercent}%)
          </p>
          <button type="button" className={btnGhost} onClick={onViewParticipation}>Xem chi tiết tiến độ</button>
        </div>
        <div
          className="h-3 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Tỷ lệ thí sinh đã bắt đầu dự thi"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={startedPercent}>
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${startedPercent}%` }} />
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <p className="admin-stat admin-stat-neutral rounded-lg p-3">Chưa bắt đầu <b>{participants.notStarted}</b></p>
          <p className="admin-stat admin-stat-warning rounded-lg p-3">Đang thi <b>{participants.inProgress}</b></p>
          <p className="admin-stat admin-stat-warning rounded-lg p-3">Quá hạn <b>{participants.overdue}</b></p>
          <p className="admin-stat admin-stat-success rounded-lg p-3">Đã nộp <b>{participants.submitted}</b></p>
          <p className="admin-stat admin-stat-danger rounded-lg p-3">Nộp tự động <b>{participants.autoSubmitted}</b></p>
        </div>
      </Card>
      </div>

      <Card id="overview-tasks" title="Việc cần làm" desc="Các mục cần hoàn tất trước khi kỳ thi sẵn sàng.">
        {tasks.length ? (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span aria-hidden="true" className="font-bold">!</span>
                <span>{task}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            Không còn mục cần xử lý; kỳ thi đã sẵn sàng theo cấu hình hiện tại.
          </p>
        )}
      </Card>
    </div>
  );
}

function Participants({ run }: { run: Run }) {
  const { confirm, toast } = useUi();
  const [allowedEmails, setAllowedEmails] = useState<string[] | null>(null);
  const [rawEmails, setRawEmails] = useState('');
  const [participantFile, setParticipantFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const parsedEmails = rawEmails.split(/[\s,;]+/)
    .map((email) => email.replace(/^[\uFEFF"']+|["']+$/g, '').trim().toLowerCase())
    .filter(Boolean);
  const emails = [...new Set(parsedEmails)];
  const invalidEmails = emails.filter((email) => email.length > 254 || !COMPANY_EMAIL.test(email));
  const reload = () => api<{ emails: string[] }>('admin/participants').then((r) => setAllowedEmails(r.emails));
  useEffect(() => { void reload().catch((e: Error) => toast('error', e.message)); }, [toast]);

  const refreshList = () => void run(async () => {
    setRefreshing(true);
    try { await reload(); }
    finally { setRefreshing(false); }
  });

  const importList = () => void run(async () => {
    const hasValidSource = participantFile
      ? participantFile.size <= 256 * 1024
      : emails.length > 0 && emails.length <= MAX_PARTICIPANTS && invalidEmails.length === 0;
    if (allowedEmails === null || !hasValidSource) return;
    const replacing = participantFile !== null;
    if (replacing && allowedEmails.length > 0 && !(await confirm({
      title: 'Thay danh sách người dự thi?',
      message: 'Danh sách email hiện tại sẽ được thay hoàn toàn bằng danh sách mới.',
      confirmText: 'Thay danh sách',
      danger: true,
    }))) return;
    setBusy(true);
    try {
      const result = await api<{ emails: string[]; count: number; added?: number }>(
        replacing ? 'admin/participants-import' : 'admin/participants',
        {
          method: 'POST',
          body: JSON.stringify(replacing
            ? { file: await toB64(participantFile!) }
            : { emails, mode: 'append' }),
        },
      );
      setAllowedEmails(result.emails);
      setRawEmails('');
      setParticipantFile(null);
      toast('success', replacing
        ? `Đã thay danh sách bằng ${result.count} email.`
        : `Đã thêm ${result.added ?? 0} email mới; danh sách hiện có ${result.count} email.`);
    } finally {
      setBusy(false);
    }
  });

  const clearList = () => void run(async () => {
    if (!allowedEmails?.length || !(await confirm({
      title: 'Xóa danh sách email?',
      message: 'Sau khi xóa, không email nào có thể bắt đầu bài thi.',
      confirmText: 'Xóa danh sách',
      danger: true,
    }))) return;
    setBusy(true);
    try {
      await api('admin/participants', { method: 'POST', body: JSON.stringify({ emails: [], mode: 'replace' }) });
      setAllowedEmails([]);
      toast('success', 'Đã xóa danh sách email.');
    } finally {
      setBusy(false);
    }
  });

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 256 * 1024) {
      setParticipantFile(null);
      toast('error', 'Tệp Excel không được vượt quá 256 KB.');
      return;
    }
    setRawEmails('');
    setParticipantFile(file);
  };

  return (
    <Card id="participants" title="Danh sách email người dự thi"
      desc={`Chỉ email công ty trong danh sách mới được bắt đầu thi. Tối đa ${MAX_PARTICIPANTS} địa chỉ.`}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Tệp danh sách Excel" className="min-w-64 flex-1">
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={inputCls}
                onChange={(e) => { void readFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </Field>
            <a href="/api/admin/participant-template" download="mau-danh-sach-email.xlsx" className={btnGhost}>
              Tải mẫu Excel
            </a>
          </div>
          {participantFile && <p className="text-sm text-blue-800">Đã chọn tệp: {participantFile.name}</p>}
          <Field label="Hoặc dán email công ty">
            <textarea rows={7} value={rawEmails} onChange={(e) => { setParticipantFile(null); setRawEmails(e.target.value); }}
              placeholder={'ten.nguoidung@tanminhnhan.com.vn\nnguoi.dung2@tanminhnhan.com.vn'}
              className={inputCls + ' font-mono'} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className={invalidEmails.length || emails.length > MAX_PARTICIPANTS ? 'text-red-700' : 'text-slate-600'}>
              {participantFile
                ? `Tệp Excel · tối đa ${MAX_PARTICIPANTS} email`
                : `${emails.length} email duy nhất / tối đa ${MAX_PARTICIPANTS}${parsedEmails.length > emails.length ? ` · bỏ qua ${parsedEmails.length - emails.length} email trùng` : ''}${invalidEmails.length > 0 ? ` · ${invalidEmails.length} email không hợp lệ hoặc sai tên miền` : ''}`}
            </p>
            <button type="button" className={btnPrimary}
              disabled={busy || allowedEmails === null || (!participantFile && (!emails.length || emails.length > MAX_PARTICIPANTS || invalidEmails.length > 0))}
              onClick={importList}>
              {busy ? 'Đang nhập…' : participantFile ? 'Thay danh sách bằng Excel' : 'Thêm email đã dán'}
            </button>
          </div>
        </div>
        <aside className="admin-email-summary">
          <h3>Danh sách được phép dự thi</h3>
          <p className="admin-email-count">
            {allowedEmails === null ? 'Đang tải…' : `${allowedEmails.length} / ${MAX_PARTICIPANTS}`}
          </p>
          <p className="admin-email-note">
            Mẫu Excel gồm cột Số thứ tự, Họ và tên (có thể để trống) và Email công ty. Tên trong mẫu được dùng khi đặt tên PDF xuất từ admin.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btnGhost} disabled={busy || refreshing || allowedEmails === null}
              onClick={refreshList}>
              {refreshing ? 'Đang làm mới…' : 'Làm mới danh sách'}
            </button>
            <button type="button" className={btnDanger} disabled={busy || !allowedEmails?.length}
              onClick={clearList}>Xóa danh sách</button>
          </div>
        </aside>
      </div>
    </Card>
  );
}

function QuestionBank({ refreshToken }: { refreshToken: number }) {
  const { toast } = useUi();
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | Item['type']>('all');
  const [formFilter, setFormFilter] = useState<'all' | 'unassigned' | 1 | 2 | 3 | 4 | 5>('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ questions: BankQuestion[] }>('admin/questions');
      setQuestions(result.questions);
      setFormFilter((current) => {
        if (current === 'all') return current;
        if (current === 'unassigned') return result.questions.some((question) => question.formNo === null) ? current : 'all';
        return result.questions.some((question) => question.formNo !== null) ? current : 'all';
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không tải được ngân hàng câu hỏi.';
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload().catch((e: Error) => toast('error', e.message)); }, [refreshToken, toast]);

  const normalizedSearch = search.trim().toLocaleLowerCase('vi');
  const hasFixedForms = questions.some((question) => question.formNo !== null);
  const unassignedCount = questions.filter((question) => question.formNo === null).length;
  const filtered = questions.filter((question) => {
    if (formFilter === 'unassigned' ? question.formNo !== null : formFilter !== 'all' && question.formNo !== formFilter) return false;
    if (typeFilter !== 'all' && question.type !== typeFilter) return false;
    if (!normalizedSearch) return true;
    const searchable = [
      question.text,
      question.referenceAnswer,
      ...question.options.map((option) => option.text),
      ...question.correct,
    ].join(' ').toLocaleLowerCase('vi');
    return searchable.includes(normalizedSearch);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageQuestions = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstVisible = filtered.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastVisible = Math.min(currentPage * pageSize, filtered.length);

  return (
    <Card id="question-bank" title={`Ngân hàng câu hỏi (${questions.length})`}
      desc="Xem nội dung, đáp án đúng và trạng thái sử dụng của từng câu hỏi.">
      {hasFixedForms && (
        <div role="group" aria-label="Lọc câu hỏi theo đề" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={formFilter === 'all'}
            className={formFilter === 'all' ? btnPrimary : btnGhost}
            onClick={() => { setFormFilter('all'); setPage(1); }}>
            Tất cả <span className="text-xs opacity-75">({questions.length})</span>
          </button>
          {([1, 2, 3, 4, 5] as const).map((formNo) => (
            <button key={formNo} type="button" aria-pressed={formFilter === formNo}
              className={formFilter === formNo ? btnPrimary : btnGhost}
              onClick={() => { setFormFilter(formNo); setPage(1); }}>
              Đề {formNo} <span className="text-xs opacity-75">({questions.filter((question) => question.formNo === formNo).length})</span>
            </button>
          ))}
          {unassignedCount > 0 && (
            <button type="button" aria-pressed={formFilter === 'unassigned'}
              className={formFilter === 'unassigned' ? btnPrimary : btnGhost}
              onClick={() => { setFormFilter('unassigned'); setPage(1); }}>
              Ngân hàng chung <span className="text-xs opacity-75">({unassignedCount})</span>
            </button>
          )}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem_auto] md:items-end">
        <Field label="Tìm câu hỏi">
          <input className={inputCls} value={search} placeholder="Nhập nội dung câu hỏi hoặc đáp án..."
            onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </Field>
        <Field label="Loại câu hỏi">
          <select className={inputCls} value={typeFilter}
            onChange={(event) => { setTypeFilter(event.target.value as typeof typeFilter); setPage(1); }}>
            <option value="all">Tất cả loại</option>
            <option value="single">Một đáp án</option>
            <option value="multiple">Nhiều đáp án</option>
            <option value="essay">Tự luận</option>
          </select>
        </Field>
        <button type="button" className={btnGhost} disabled={loading}
          onClick={() => void reload().catch((e: Error) => toast('error', e.message))}>
          {loading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      {loading && <p role="status" className="text-sm text-slate-500">Đang tải ngân hàng câu hỏi...</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <span>{error}</span>
          <button type="button" className={btnGhost} onClick={() => void reload().catch((e: Error) => toast('error', e.message))}>Thử lại</button>
        </div>
      )}
      {!loading && !error && questions.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Chưa có câu hỏi. Hãy nhập câu hỏi từ tệp ở phía trên.</p>
      )}
      {!loading && !error && questions.length > 0 && filtered.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Không tìm thấy câu hỏi phù hợp.</p>
      )}
      {!loading && !error && pageQuestions.length > 0 && (
        <>
          <div className="space-y-3">
            {pageQuestions.map((question, index) => {
              const correct = new Set(question.correct);
              return (
                <article key={question.id} className="admin-question-item">
                  <div className="admin-question-meta">
                    {question.formNo && <span className="admin-question-tag">Đề {question.formNo}</span>}
                    <span className="admin-question-index">Câu {(currentPage - 1) * pageSize + index + 1}</span>
                    <span className="admin-question-tag">
                      {question.type === 'essay' ? 'Tự luận' : question.type === 'multiple' ? 'Nhiều đáp án' : 'Một đáp án'}
                    </span>
                    <span className="admin-question-tag">{question.points} điểm</span>
                    <span className={`admin-question-status ${question.active ? 'is-active' : 'is-inactive'}`}>
                      {question.active ? 'Đang sử dụng' : 'Đang ẩn'}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-900">{question.text}</p>
                  {question.type === 'essay' ? (
                    <div className="admin-question-answer">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Đáp án tham khảo</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-950">
                        {question.referenceAnswer || 'Chưa có đáp án tham khảo.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <ul className="space-y-2">
                        {question.options.map((option) => (
                          <li key={option.id} className={`admin-question-option ${correct.has(option.id) ? 'is-correct' : ''}`}>
                            <span className="admin-question-option-id">{option.id.toUpperCase()}.</span>
                            <span className="min-w-0 flex-1 whitespace-pre-wrap">{option.text}</span>
                            {correct.has(option.id) && <span className="admin-question-correct-label">Đáp án đúng</span>}
                          </li>
                        ))}
                      </ul>
                      {question.correct.length === 0 && (
                        <p className="text-xs font-medium text-amber-700">Chưa khai báo đáp án đúng.</p>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">Hiển thị {firstVisible}–{lastVisible} / {filtered.length} câu hỏi</p>
            <div className="flex items-center gap-2">
              <button type="button" className={btnGhost} disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}>Trang trước</button>
              <span className="min-w-20 text-center text-xs text-slate-600">Trang {currentPage} / {pageCount}</span>
              <button type="button" className={btnGhost} disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}>Trang sau</button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function QuestionsPage({ run }: { run: Run }) {
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <div className="space-y-6">
      <Import run={run} onSaved={() => setRefreshToken((current) => current + 1)} />
      <QuestionBank refreshToken={refreshToken} />
    </div>
  );
}

function Import({ run, onSaved }: { run: Run; onSaved: () => void }) {
  const { confirm } = useUi();
  const [format, setFormat] = useState<'forms-xlsx' | 'xlsx' | 'docx'>('xlsx');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const call = async (commit: boolean) => api<any>('admin/import', { method: 'POST', body: JSON.stringify({ format, mode, commit, file: await toB64(file!) }) });
  const reset = () => { setPv(null); setSaved(null); };
  const commit = async () => {
    const ok = await confirm(mode === 'append' && format !== 'forms-xlsx'
      ? { title: 'Thêm các câu hỏi này?', message: 'Các câu hỏi trong tệp sẽ được thêm vào ngân hàng hiện có.', confirmText: 'Thêm câu hỏi' }
      : { title: 'Thay thế toàn bộ câu hỏi?', message: format === 'forms-xlsx' ? 'Toàn bộ câu hỏi hiện có sẽ được thay bằng 5 sheet trong tệp Excel.' : 'Toàn bộ câu hỏi hiện có sẽ được thay bằng nội dung trong tệp.', confirmText: 'Thay thế', danger: true });
    if (ok) void run(async () => { const r = await call(true); setSaved(r.saved); setPv(null); onSaved(); });
  };
  return (
    <Card id="imp" title="Nhập câu hỏi" desc="Chọn loại tệp theo cách chọn đề trong Cấu hình. Kiểm tra tệp trước khi lưu.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loại tệp">
          <select value={format} onChange={(e) => { setFormat(e.target.value as 'forms-xlsx' | 'xlsx' | 'docx'); setMode('replace'); setFile(null); reset(); }} className={inputCls}>
            <option value="forms-xlsx">Excel 5 sheet · 5 đề cố định</option>
            <option value="xlsx">Excel 1 sheet · ngân hàng xáo trộn</option>
            <option value="docx">Word · ngân hàng xáo trộn</option>
          </select>
        </Field>
        {format !== 'forms-xlsx' && <Field label="Cách nhập">
          <select value={mode} onChange={(e) => { setMode(e.target.value as 'replace' | 'append'); reset(); }} className={inputCls}>
            <option value="replace">Thay thế toàn bộ câu hỏi hiện có</option>
            <option value="append">Thêm vào câu hỏi hiện có</option>
          </select>
        </Field>}
      </div>
      <p className="text-xs text-slate-600">{format === 'forms-xlsx' ? 'Tệp phải có đúng 5 sheet Đề 1–Đề 5; mỗi sheet đủ số câu theo Cấu hình. Nhập xong, bật “5 đề cố định” trong Cấu hình.' : 'Chế độ một đề xáo trộn chọn câu ngẫu nhiên từ toàn bộ ngân hàng hiện có, kể cả câu thuộc 5 sheet nếu đã nhập trước đó.'}</p>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-4">
        <input type="file" aria-label="Chọn tệp câu hỏi" accept={format === 'docx' ? '.docx' : '.xlsx'}
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
        <a className="ml-auto text-sm font-medium text-blue-800 underline-offset-2 hover:underline" href={`/api/admin/template?format=${format}`}>Tải tệp mẫu {format === 'forms-xlsx' ? '5 đề' : format === 'xlsx' ? 'Excel' : 'Word'}</a>
      </div>
      <div className="flex gap-2">
        <button disabled={!file} className={btnDark} onClick={() => void run(async () => setPv(await call(false)))}>Kiểm tra tệp</button>
        <button disabled={!file || !pv?.ok} className={btnPrimary} onClick={() => void commit()}>Lưu vào hệ thống</button>
      </div>
      {/* <p className="text-xs text-slate-500">Điểm mỗi câu được cấu hình trong tab Cấu hình.</p> */}
      {saved !== null && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Đã lưu {saved} câu hỏi.</p>}
      {pv && (
        <div className="space-y-3 text-sm">
          {pv.locked && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">Đã có thí sinh bắt đầu thi: không thể đổi câu hỏi (xoá bài thi thử trong bảng exam_attempts nếu đó chỉ là thử nghiệm).</p>}
          <p className="text-slate-700">Đọc được <b>{pv.total}</b> câu hợp lệ. {pv.fixedForms ? 'Mỗi đề cần đúng' : 'Bài thi cần'} <b>{pv.neededMultiple}</b> câu trắc nghiệm và <b>{pv.neededEssay}</b> câu tự luận.{pv.errors.length > 0 && <>, <b className="text-red-700">{pv.errors.length} lỗi</b></>}</p>
          {pv.errors.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-red-50 p-3 pl-8 text-red-800">{pv.errors.map((e, i) => <li key={i}><b>{e.ref}:</b> {e.message}</li>)}</ul>}
          {pv.preview.length > 0 && (
            <ol className="max-h-72 list-decimal space-y-3 overflow-auto rounded-xl border border-slate-200 p-4 pl-9">
              {pv.preview.map((q, i) => (
                <li key={i}>
                  <div>{q.formNo && <strong className="mr-2 text-blue-800">Đề {q.formNo}</strong>}{q.text} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{q.type === 'essay' ? 'tự luận, điểm theo cấu hình' : `${q.type === 'multiple' ? 'nhiều đáp án' : 'một đáp án'}, điểm theo cấu hình`}</span></div>
                  {q.type !== 'essay' && <div className="mt-1 flex flex-wrap gap-x-4 text-slate-600">{q.options.map((o) => <span key={o.id} className={q.correct.includes(o.id) ? 'font-semibold text-emerald-700' : ''}>{o.id.toUpperCase()}. {o.text}</span>)}</div>}
                  {q.type === 'essay' && <div className="mt-1 text-slate-600">Đáp án tham khảo: {q.referenceAnswer}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}

type DashboardResponse = {
  dashboard: ExamDashboard;
  levelOptions: string[];
  tabSwitchSummary: { total: number; violations: number };
};
type DashboardGroup = { label: string; metric: DashboardMetric };
const scoreLabels = ['Dưới 5', '5–6,9', '7–7,9', '8–8,9', 'Từ 9 trở lên'];
const countFormat = new Intl.NumberFormat('vi-VN');
const percentFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const scoreFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const displayPercent = (value: number | null) => value === null ? '—' : `${percentFormat.format(value)}%`;
const displayScore = (value: number | null) => value === null ? '—' : `${scoreFormat.format(value)} / 10`;

function DashboardChart({ metric }: { metric: DashboardMetric }) {
  const decided = metric.pass + metric.fail;
  const passPercentage = decided ? (metric.pass / decided) * 100 : 0;
  const gradient = decided
    ? `conic-gradient(#0f766e 0% ${passPercentage}%, #dc2626 ${passPercentage}% 100%)`
    : '#e2e8f0';
  const maxCount = Math.max(1, ...metric.scoreDistribution.map((bucket) => bucket.count));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="dashboard-pass-title" className="rounded-xl border border-slate-200 p-4">
        <h3 id="dashboard-pass-title" className="text-sm font-semibold text-slate-800">Tỷ lệ đạt / không đạt</h3>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <div role="img" aria-label={`Tỷ lệ đạt ${displayPercent(passPercentage)} trong ${countFormat.format(decided)} bài đã có kết quả`}
            className="flex h-36 w-36 items-center justify-center rounded-full"
            style={{ background: gradient }}>
            <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white text-center">
              <span className="text-lg font-bold text-slate-900">{displayPercent(decided ? passPercentage : null)}</span>
              <span className="text-xs text-slate-500">đạt</span>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-emerald-700" />Đạt: <b>{countFormat.format(metric.pass)}</b></p>
            <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-red-600" />Không đạt: <b>{countFormat.format(metric.fail)}</b></p>
            <p className="text-slate-500">Chưa có kết quả: {countFormat.format(metric.pending)}</p>
          </div>
        </div>
      </section>
      <section aria-labelledby="dashboard-score-title" className="rounded-xl border border-slate-200 p-4">
        <h3 id="dashboard-score-title" className="text-sm font-semibold text-slate-800">Phân bố điểm tổng kết (thang 10)</h3>
        <div role="img" aria-label="Biểu đồ số bài thi theo khoảng điểm trên thang 10"
          className="mt-4 flex h-40 items-end gap-1 border-b border-l border-slate-200 px-2">
          {metric.scoreDistribution.map((bucket) => (
            <div key={bucket.label} title={`${bucket.label}/10: ${countFormat.format(bucket.count)} bài`}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              {bucket.count > 0 && <span className="mb-1 text-[10px] text-slate-600">{countFormat.format(bucket.count)}</span>}
              <div className="w-full max-w-7 rounded-t bg-emerald-700 transition-all"
                style={{ height: `${bucket.count ? Math.max(4, (bucket.count / maxCount) * 100) : 0}%` }} />
              <span className="mt-1 whitespace-nowrap text-[9px] text-slate-500">{bucket.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Các khoảng: dưới 5; 5–6,9; 7–7,9; 8–8,9; từ 9 trở lên.</p>
      </section>
    </div>
  );
}

function ResultsDashboard({ summaryOnly = false }: { summaryOnly?: boolean }) {
  const [projectId, setProjectId] = useState('');
  const [level, setLevel] = useState('');
  const [scoreBucket, setScoreBucket] = useState('');
  const [compareBy, setCompareBy] = useState<'project' | 'level'>('project');
  const [response, setResponse] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setResponse(null);
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (level) params.set('level', level);
    if (scoreBucket) params.set('scoreBucket', scoreBucket);
    const query = params.size ? `?${params.toString()}` : '';
    api<DashboardResponse>(`admin/dashboard${query}`)
      .then((data) => { if (active) setResponse(data); })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, level, scoreBucket, refresh]);

  const dashboard = response?.dashboard;
  const metric = dashboard?.overall;
  const groups: DashboardGroup[] = compareBy === 'project'
    ? (dashboard?.projects ?? []).map((project) => ({ label: project.name, metric: project }))
    : (dashboard?.levels ?? []).map((item) => ({ label: item.level, metric: item }));

  return (
    <Card id={summaryOnly ? 'overview-dashboard' : 'res-dashboard'}
      title={summaryOnly ? 'Tóm tắt kết quả' : 'Thống kê kết quả thi'}
      desc="Chỉ tính các lượt đã nộp; bài đang làm không được đưa vào thống kê.">
      {!summaryOnly ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Công trình">
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Tất cả công trình</option>
              {dashboard?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.active ? '' : ' (đã ẩn)'}</option>)}
            </select>
          </Field>
          <Field label="Cấp bậc">
            <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Tất cả cấp bậc</option>
              {response?.levelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="Điểm tổng kết">
            <select className={inputCls} value={scoreBucket} onChange={(e) => setScoreBucket(e.target.value)}>
              <option value="">Tất cả điểm</option>
              {scoreLabels.map((label, index) => <option key={label} value={index}>{label} điểm</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <button type="button" className={btnGhost + ' w-full'} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
              {loading ? 'Đang tải…' : 'Làm mới số liệu'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button type="button" className={btnGhost} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
            {loading ? 'Đang tải…' : 'Làm mới số liệu'}
          </button>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && !metric && <p role="status" className="text-sm text-slate-500">Đang tải thống kê…</p>}
      {metric && (
        <div aria-busy={loading} className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Tổng lượt đã nộp', value: countFormat.format(metric.total), color: 'text-slate-900' },
              { label: 'Đạt', value: countFormat.format(metric.pass), color: 'text-emerald-700' },
              { label: 'Không đạt', value: countFormat.format(metric.fail), color: 'text-red-700' },
              { label: 'Điểm tổng kết trung bình', value: displayScore(metric.averageScore), color: 'text-slate-900' },
              {
                label: 'Lượt vi phạm / tổng nộp (toàn kỳ thi)',
                value: `${countFormat.format(response?.tabSwitchSummary.violations ?? 0)} / ${countFormat.format(response?.tabSwitchSummary.total ?? 0)}`,
                detail: displayPercent(response?.tabSwitchSummary.total
                  ? (response.tabSwitchSummary.violations / response.tabSwitchSummary.total) * 100
                  : null),
                color: 'text-amber-800',
              },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-500">{item.label}</p>
                <p className={'mt-1 text-2xl font-bold ' + item.color}>{item.value}</p>
                {'detail' in item && <p className="mt-1 text-xs text-slate-500">{item.detail} toàn bộ bài đã nộp</p>}
              </div>
            ))}
          </div>

          {!summaryOnly && (
            <>
              <DashboardChart metric={metric} />

              <section aria-labelledby="dashboard-groups-title" className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 id="dashboard-groups-title" className="text-sm font-semibold text-slate-800">So sánh tỷ lệ đạt theo nhóm</h3>
                    <p className="mt-1 text-xs text-slate-500">Tỷ lệ được tính trên các bài đã có kết quả đạt hoặc không đạt.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" aria-pressed={compareBy === 'project'} onClick={() => setCompareBy('project')}
                      className={compareBy === 'project' ? btnPrimary : btnGhost}>Công trình</button>
                    <button type="button" aria-pressed={compareBy === 'level'} onClick={() => setCompareBy('level')}
                      className={compareBy === 'level' ? btnPrimary : btnGhost}>Cấp bậc</button>
                  </div>
                </div>
                {groups.length === 0 || !metric.total ? (
                  <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Không có dữ liệu phù hợp với bộ lọc.</p>
                ) : (
                  <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                    {groups.map(({ label, metric: group }) => {
                      const completed = group.pass + group.fail;
                      const rate = completed ? (group.pass / completed) * 100 : 0;
                      return (
                        <div key={label} className="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_2fr_auto] sm:items-center">
                          <span className="truncate text-sm font-medium text-slate-700" title={label}>{label}</span>
                          <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="img"
                            aria-label={`${label}: tỷ lệ đạt ${displayPercent(completed ? rate : null)}`}>
                            <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${rate}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-slate-600">
                            {completed ? `${displayPercent(rate)} · ${group.pass}/${completed} đạt` : 'Chưa có kết quả'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ResultRecords({ run }: { run: Run }) {
  const { confirm, toast } = useUi();
  const [busy, setBusy] = useState(false);
  const downloadAndClear = async () => {
    const ok = await confirm({
      title: 'Tải hồ sơ rồi xóa dữ liệu kết quả?', confirmText: 'Tải và xóa', danger: true,
      message: 'Toàn bộ lượt thi đã hoàn tất cùng câu trả lời và sự kiện liên quan sẽ bị xóa sau khi tải. Ngân hàng câu hỏi, cấu hình và danh sách email được giữ nguyên.',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/export?clear=true', { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Không thể tạo bộ hồ sơ phúc khảo.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'examination-review.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      try {
        const result = await api<{ deleted: number }>('admin/clear-results', { method: 'POST', body: JSON.stringify({ confirm: true }) });
        toast('success', `Đã tải bộ hồ sơ và xóa ${result.deleted} lượt thi đã hoàn tất.`);
      } catch (e) {
        toast('error', `Đã tải bộ hồ sơ nhưng chưa xóa được dữ liệu: ${(e as Error).message}`);
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <Card id="res-export" title="Hồ sơ kết quả kiểm tra" desc="Tải một file ZIP gồm bảng Excel và PDF riêng cho từng bài thi đã nộp. Trong file Excel, sheet Hồ sơ phúc khảo có liên kết đến PDF tương ứng.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold">Tải hồ sơ (giữ dữ liệu)</h3>
            <p className="mt-1 text-xs text-slate-500">ZIP gồm Excel và PDF phúc khảo; dữ liệu vẫn được giữ trên hệ thống.</p>
            <a className={btnPrimary + ' mt-3'} href="/api/admin/export">Tải ZIP hồ sơ</a>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
            <h3 className="text-sm font-semibold text-red-900">Tải hồ sơ và xóa dữ liệu kết quả</h3>
            <p className="mt-1 text-xs text-red-800/80">Chỉ chạy khi kỳ thi đã đóng và không còn bài đang làm.</p>
            <button disabled={busy} className={btnDanger + ' mt-3'} onClick={() => void downloadAndClear()}>{busy ? 'Đang tải và xóa…' : 'Tải ZIP và xóa dữ liệu'}</button>
          </div>
        </div>
      </Card>
      <Card id="res-reconcile" title="Chốt bài hết hạn" desc="Tự động nộp các bài đã quá hạn mà thí sinh chưa nộp.">
        <button className={btnDark} onClick={() => void run(async () => {
          const r = await api<{ finalized: number }>('admin/reconcile', { method: 'POST', body: '{}' });
          toast('success', `Đã chốt ${r.finalized} bài hết hạn.`);
        })}>Chốt các bài hết hạn</button>
      </Card>
    </div>
  );
}

function EssayGrading({ run }: { run: Run }) {
  const { toast } = useUi();
  const [attempts, setAttempts] = useState<GradeAttempt[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<'pending' | 'all' | 'graded'>('pending');
  const [search, setSearch] = useState('');
  const [savingAttempt, setSavingAttempt] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [loadError, setLoadError] = useState('');
  const reload = async () => {
    setLoadError('');
    try {
      const response = await api<{ attempts: GradeAttempt[] }>('admin/grading');
      setAttempts(response.attempts);
      setSelectedId((current) => response.attempts.some((attempt) => attempt.id === current)
        ? current
        : response.attempts.find((attempt) => attempt.pendingEssayCount > 0)?.id
          ?? response.attempts[0]?.id
          ?? '');
    } catch (error) {
      setAttempts(null);
      setLoadError(error instanceof Error ? error.message : 'Không tải được danh sách bài thi.');
      throw error;
    }
  };
  useEffect(() => { void reload().catch((e: Error) => toast('error', e.message)); }, [toast]);

  const pendingCount = attempts?.filter((attempt) => attempt.pendingEssayCount > 0).length ?? 0;
  const gradedCount = (attempts?.length ?? 0) - pendingCount;
  const visibleAttempts = (attempts ?? []).filter((attempt) => {
    if (filter === 'pending' && attempt.pendingEssayCount === 0) return false;
    if (filter === 'graded' && attempt.pendingEssayCount > 0) return false;
    const query = search.trim().toLocaleLowerCase('vi');
    return !query || attempt.fullName.toLocaleLowerCase('vi').includes(query)
      || attempt.email.toLocaleLowerCase('vi').includes(query)
      || String(attempt.participantOrder ?? '').includes(query);
  });
  const selected = attempts?.find((attempt) => attempt.id === selectedId);

  const gradeFor = (attempt: GradeAttempt, essay: EssayGrade) =>
    drafts[attempt.id]?.[essay.questionId] ?? (essay.score === null ? '' : String(essay.score));
  const selectedCanSave = !!selected && selected.essays.every((essay) => {
    const rawScore = gradeFor(selected, essay);
    const score = Number(rawScore);
    return rawScore !== '' && Number.isFinite(score) && score >= 0
      && score <= essay.maxPoints && Math.abs(score * 100 - Math.round(score * 100)) < 1e-8;
  });
  const saveGrades = (attempt: GradeAttempt) => {
    const grades: { questionId: string; points: number }[] = [];
    for (const essay of attempt.essays) {
      const rawScore = gradeFor(attempt, essay);
      const points = Number(rawScore);
      if (rawScore === '' || !Number.isFinite(points) || points < 0
        || points > essay.maxPoints || Math.abs(points * 100 - Math.round(points * 100)) >= 1e-8) {
        toast('error', `Nhập điểm từ 0 đến ${essay.maxPoints} (tối đa 2 chữ số thập phân) cho từng câu.`);
        return;
      }
      grades.push({ questionId: essay.questionId, points });
    }
    void run(async () => {
      setSavingAttempt(attempt.id);
      try {
        await api('admin/grade-essay-attempt', {
          method: 'POST',
          body: JSON.stringify({
            attemptId: attempt.id,
            grades,
          }),
        });
        await reload();
        setDrafts((current) => {
          const next = { ...current };
          delete next[attempt.id];
          return next;
        });
        toast('success', 'Đã lưu kết quả chấm cho toàn bài và cập nhật điểm tổng.');
      } finally {
        setSavingAttempt('');
      }
    });
  };

  return (
    <Card id="essay-grading" title="Chấm điểm tự luận">
      <p className="text-sm text-slate-600">
        Nhập điểm riêng cho từng câu, từ 0 đến mức tối đa được cấu hình. Kết quả cuối chỉ chốt khi đã chấm đủ các câu tự luận.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-800">Cần chấm</p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs text-emerald-800">Đã chấm đủ</p>
          <p className="mt-1 text-2xl font-bold text-emerald-900">{gradedCount}</p>
        </div>
        <div className="flex items-end">
          <button type="button" className={btnGhost + ' w-full'} disabled={attempts === null || savingAttempt !== ''}
            onClick={() => void run(reload)}>
            {attempts === null ? 'Đang tải…' : 'Làm mới danh sách'}
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.8fr)]">
        <section aria-label="Danh sách bài thi cần chấm" className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Field label="Tìm thí sinh">
            <input className={inputCls} value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="STT, họ tên hoặc email" />
          </Field>
          <Field label="Trạng thái">
            <select className={inputCls} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="pending">Chưa chấm xong ({pendingCount})</option>
              <option value="all">Tất cả bài ({attempts?.length ?? 0})</option>
              <option value="graded">Đã chấm đủ ({gradedCount})</option>
            </select>
          </Field>
          {loadError ? (
            <div role="alert" className="space-y-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">
              <p>{loadError}</p>
              <button type="button" className={btnGhost} disabled={savingAttempt !== ''}
                onClick={() => void run(reload)}>Thử tải lại</button>
            </div>
          ) : attempts === null ? <p role="status" className="text-sm text-slate-500">Đang tải bài thi…</p>
            : visibleAttempts.length === 0
              ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Không có bài thi phù hợp.</p>
              : <ul className="max-h-[70vh] divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200">
                {visibleAttempts.map((attempt) => (
                  <li key={attempt.id}>
                    <button type="button" aria-pressed={selectedId === attempt.id}
                      onClick={() => setSelectedId(attempt.id)}
                      className={'w-full px-3 py-3 text-left transition ' + (selectedId === attempt.id ? 'bg-blue-50' : 'hover:bg-slate-50')}>
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-800">
                            {attempt.participantOrder ? `${attempt.participantOrder}. ` : ''}{attempt.fullName}{attempt.formNo ? ` · Đề ${attempt.formNo}` : ''}
                          </span>
                          <span className="block truncate text-xs text-slate-500">{attempt.email}</span>
                        </span>
                        <span className={'shrink-0 rounded-full px-2 py-1 text-xs font-medium ' +
                          (attempt.submitReason === 'tab_switch' ? 'bg-red-100 text-red-900'
                            : attempt.pendingEssayCount ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900')}>
                          {attempt.submitReason === 'tab_switch' ? 'Trượt: chuyển tab'
                            : attempt.pendingEssayCount ? `Còn ${attempt.pendingEssayCount} câu` : 'Đã chấm'}
                        </span>
                      </span>
                      <span className="mt-2 block text-xs text-slate-600">
                        Trắc nghiệm {attempt.mcPoints.toFixed(2)} / {attempt.mcMaxPoints.toFixed(2)} điểm
                      </span>
                    </button>
                  </li>
                ))}
              </ul>}
        </section>

        <section aria-label="Chi tiết chấm bài" className="min-w-0 space-y-4">
          {!selected ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-600">Chọn bài thi để xem câu trả lời tự luận.</p>
            : <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-semibold text-slate-900">
                  {selected.participantOrder ? `STT ${selected.participantOrder} · ` : ''}{selected.fullName}{selected.formNo ? ` · Đề ${selected.formNo}` : ''}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{selected.email} · {selected.mainProject} · {selected.candidateLevel}</p>
                {selected.submitReason === 'tab_switch' && (
                  <p className="mt-2 rounded-md bg-red-100 px-3 py-2 text-sm font-semibold text-red-900">
                    Tự động không đạt do vi phạm chuyển tab.
                  </p>
                )}
                <p className="mt-2 text-sm font-medium text-slate-800">
                  Trắc nghiệm: {selected.mcPoints.toFixed(2)} / {selected.mcMaxPoints.toFixed(2)} điểm
                  {selected.result
                    ? ` · Tổng: ${selected.scoredPoints?.toFixed(2)} / ${selected.totalPoints?.toFixed(2)} điểm · Đạt từ ${selected.passingScore.toFixed(2)} điểm · ${selected.result === 'PASS' ? 'ĐẠT' : 'KHÔNG ĐẠT'}`
                    : ` · Chờ chấm ${selected.pendingEssayCount} câu tự luận`}
                </p>
              </div>
              {selected.essays.map((essay) => (
                <EssayDecisionCard key={essay.questionId} essay={essay}
                  score={gradeFor(selected, essay)}
                  onChange={(score) => setDrafts((current) => ({
                    ...current,
                    [selected.id]: { ...current[selected.id], [essay.questionId]: score },
                  }))} />
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-600">
                  Nhập điểm cho toàn bộ {selected.essays.length} câu rồi lưu một lần cho bài thi này.
                </p>
                <button type="button" className={btnPrimary}
                  disabled={!selectedCanSave || savingAttempt !== ''}
                  onClick={() => saveGrades(selected)}>
                  {savingAttempt === selected.id ? 'Đang lưu toàn bài…' : 'Lưu kết quả cả bài'}
                </button>
              </div>
            </>}
        </section>
      </div>
    </Card>
  );
}

function EssayDecisionCard({
  essay, score, onChange,
}: {
  essay: EssayGrade; score: string; onChange: (score: string) => void;
}) {
  return (
    <article className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Câu {essay.number} · Tự luận</p>
        <h4 className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-900">{essay.text}</h4>
      </div>
      <div className="rounded-xl border-2 border-slate-300 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-900">Bài làm của thí sinh</p>
        <p className="mt-3 whitespace-pre-wrap text-base font-medium leading-7 text-slate-950">
          {essay.response || '(Thí sinh bỏ trống câu này)'}
        </p>
      </div>
      <Field label={`Điểm chấm (tối đa ${essay.maxPoints} điểm)`}>
        <input type="number" min={0} max={essay.maxPoints} step={0.01} inputMode="decimal"
          className={inputCls} value={score} onChange={(event) => onChange(event.target.value)} />
      </Field>
    </article>
  );
}

const TABS = [
  { id: 'overview', label: 'Tổng quan', icon: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z' },
  { id: 'active', label: 'Tiến độ dự thi', icon: 'M12 8v4l2.5 2.5M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5' },
  { id: 'retakes', label: 'Nhật ký thi lại', icon: 'M4 4v5h5M4.9 9a8 8 0 1 1-.4 5M12 7v5l3 2' },
  { id: 'settings', label: 'Cấu hình', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.2 4a8.3 8.3 0 0 0-.1-1.3l1.5-1.2-1.5-2.6-1.8.7a8.2 8.2 0 0 0-2.2-1.3L15.8 4h-3.1l-.3 2.3a8.2 8.2 0 0 0-2.2 1.3l-1.8-.7-1.5 2.6 1.5 1.2a8.3 8.3 0 0 0 0 2.6l-1.5 1.2 1.5 2.6 1.8-.7a8.2 8.2 0 0 0 2.2 1.3l.3 2.3h3.1l.3-2.3a8.2 8.2 0 0 0 2.2-1.3l1.8.7 1.5-2.6-1.5-1.2a8.3 8.3 0 0 0 .1-1.3Z' },
  { id: 'participants', label: 'Danh sách email', icon: 'M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 2 18.5V20m7-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1.5a4.5 4.5 0 0 0-3.5-4.4m-2-11a4 4 0 0 1 0 7.8' },
  { id: 'questions', label: 'Câu hỏi', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h8' },
  { id: 'grading', label: 'Chấm tự luận', icon: 'm15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Zm9-12 3 3' },
  { id: 'statistics', label: 'Bài làm & thống kê', icon: 'M4 19V5m0 14h17M8 15v-4m5 4V7m5 8v-6' },
  { id: 'records', label: 'Hồ sơ kết quả', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 16h8m-8-4h3' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const TAB_DESCRIPTIONS: Record<Tab, string> = {
  overview: 'Theo dõi trạng thái kỳ thi, mức sẵn sàng và tiến độ tham gia.',
  active: 'Theo dõi chi tiết trạng thái bắt đầu, đang làm và nộp bài.',
  retakes: 'Xem từng lần cấp quyền thi lại, thời điểm và lý do đã ghi nhận.',
  settings: 'Thiết lập lịch, cấu trúc đề thi và quyền truy cập.',
  participants: 'Quản lý email được phép tham gia và nhập danh sách thí sinh.',
  questions: 'Nhập, kiểm tra và cập nhật ngân hàng câu hỏi.',
  grading: 'Đọc bài làm và hoàn tất điểm tự luận.',
  statistics: 'Lọc, so sánh và phân tích kết quả các bài thi đã nộp.',
  records: 'Tải hồ sơ kết quả, xóa dữ liệu đã lưu hoặc chốt bài quá hạn.',
};

export default function Admin() {
  const { toast } = useUi();
  const [pw, setPw] = useState('');
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const run: Run = async (f) => { try { await f(); } catch (e) { toast('error', (e as Error).message); } };

  if (!ok) {
    return (
      <main className="admin-shell admin-login-screen flex min-h-screen items-center justify-center p-4 sm:p-6">
        <form className="admin-login-card w-full max-w-md space-y-6 bg-white p-6 sm:p-9"
          onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) }); setOk(true); }); }}>
          <div className="admin-login-heading">
            <img src="/logo.png" alt="Tân Minh Nhân" className="admin-login-logo" />
            <h1>Quản trị kỳ thi</h1>
            <p>Đăng nhập để theo dõi và quản lý kỳ thi.</p>
          </div>
          <Field label="Mật khẩu quản trị">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} autoComplete="current-password" autoFocus />
          </Field>
          <button className={btnPrimary + ' w-full'}>Đăng nhập</button>
        </form>
      </main>
    );
  }

  return (
    <div className="admin-shell min-h-screen">
      <div className="admin-frame">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <img src="/logo.png" alt="Tân Minh Nhân" className="admin-brand-logo" />
            <span className="admin-brand-caption">Hệ thống quản trị kỳ thi</span>
          </div>
          <p className="admin-nav-label">ĐIỀU HÀNH KỲ THI</p>
          <nav role="tablist" aria-label="Mục quản trị" className="admin-nav">
            {TABS.map((t) => (
              <button key={t.id} id={'admin-tab-' + t.id} type="button" role="tab"
                aria-controls={tab === t.id ? 'admin-panel' : undefined} aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={'admin-tab admin-tab-' + t.id + (tab === t.id ? ' is-active' : '')}>
                <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={t.icon} />
                </svg>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-footer"><strong>Hệ thống thi nội bộ</strong><span>Theo dõi và quản lý kỳ thi Tân Minh Nhân.</span></div>
        </aside>
        <div className="admin-workspace">
          <header className="admin-topbar">
            <img src="/logo.png" alt="Tân Minh Nhân" className="admin-topbar-logo" />
            <div className="admin-breadcrumb"><span>Hệ thống quản trị</span><span aria-hidden="true">/</span><strong>{TABS.find((item) => item.id === tab)?.label}</strong></div>
            <div className="admin-topbar-right"><span className="admin-topbar-pill">Kỳ thi nội bộ</span><span className="admin-avatar" aria-hidden="true">QT</span></div>
          </header>
          <main className="admin-content" id="admin-panel" role="tabpanel"
            aria-labelledby={'admin-tab-' + tab}>
            <div className="admin-content-heading">
              <span className="admin-heading-overline">TÂN MINH NHÂN / QUẢN TRỊ</span>
              <h1>{TABS.find((item) => item.id === tab)?.label}</h1>
              <p>{TAB_DESCRIPTIONS[tab]}</p>
            </div>
        {tab === 'overview' && <div className="space-y-6"><ExamOverview onViewParticipation={() => setTab('active')} /><ResultsDashboard summaryOnly /></div>}
        {tab === 'active' && <ParticipationMonitor run={run} onViewRetakeLog={() => setTab('retakes')} />}
        {tab === 'retakes' && <RetakeLog />}
        {tab === 'settings' && <div className="space-y-6"><SettingsForm run={run} /><Projects run={run} /></div>}
        {tab === 'participants' && <Participants run={run} />}
        {tab === 'questions' && <QuestionsPage run={run} />}
        {tab === 'grading' && <EssayGrading run={run} />}
        {tab === 'statistics' && <ResultsDashboard />}
        {tab === 'records' && <ResultRecords run={run} />}
          </main>
        </div>
      </div>
    </div>
  );
}
