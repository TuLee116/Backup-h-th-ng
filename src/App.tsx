import { useCallback, useEffect, useRef, useState } from "react";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/be-vietnam-pro/800.css";
import "@fontsource/be-vietnam-pro/900.css";
import { remainingMs } from "./utils/pure";
import { api, fmt, type ApiError } from "./api";
import "./exam.css";

type Opt = { id: string; text: string };
type Q = {
  id: string;
  text: string;
  type: "single" | "multiple" | "essay";
  options: Opt[];
};
type AnswerValue = { options: string[]; essay: string | null };
type Res = {
  correct: number;
  incorrect: number;
  scoredPoints: number;
  totalPoints: number;
  passingScore: number;
  result: "PASS" | "FAIL";
} | null;
type Info = {
  title: string;
  logoUrl: string;
  openingAt: string;
  closingAt: string;
  durationMinutes: number;
  multipleChoiceCount: number;
  essayCount: number;
  mcPointsPerQuestion: number;
  essayPointsPerQuestion: number;
  passingScore: number;
  active: boolean;
  serverNow: string;
  projects: { id: string; name: string }[];
  hasAttemptCookie?: boolean;
};
type St = {
  status: string;
  serverNow: string;
  attemptId?: string;
  deadlineAt?: string;
  hasEssay?: boolean;
  pendingGrade?: boolean;
  mcPointsPerQuestion?: number;
  essayPointsPerQuestion?: number;
  passingScore?: number;
  totalPoints?: number;
  displayMode?: "paged" | "all";
  candidate?: {
    fullName: string;
    position: string;
    level: string;
    mainProject: string;
  };
  questions?: Q[];
  answers?: Record<string, AnswerValue>;
  result?: Res;
};
type SubmissionSummary = {
  candidateName: string;
  formNo: number | null;
  answers: {
    number: number;
    selectedOptions: string[];
    essayResponse: string | null;
  }[];
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const formatPoints = (value: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
type FlushResult = "saved" | "error" | "expired";

function isValidOptionIds(value: unknown, question: Q): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 6 &&
    value.every(
      (id: unknown) =>
        typeof id === "string" &&
        question.options.some((option) => option.id === id),
    )
  );
}

function readAnswerDraft(attemptId: string | undefined, questions: Q[]) {
  const pending: Record<string, AnswerValue> = {};
  if (!attemptId) return { pending, warning: "" };
  try {
    const raw = window.localStorage.getItem(`exam-answer-draft:${attemptId}`);
    if (!raw) return { pending, warning: "" };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        pending,
        warning:
          "Bản nháp trên thiết bị không hợp lệ; các câu trả lời đã lưu trên máy chủ vẫn được giữ.",
      };
    }

    let invalidEntries = false;
    for (const [questionId, value] of Object.entries(parsed)) {
      const question = questions.find((item) => item.id === questionId);
      if (
        !question ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        invalidEntries = true;
        continue;
      }
      const answer = value as Record<string, unknown>;
      if (!isValidOptionIds(answer.options, question)) {
        invalidEntries = true;
        continue;
      }
      if (question.type === "essay") {
        if (
          answer.options.length !== 0 ||
          typeof answer.essay !== "string" ||
          answer.essay.length > 10000
        ) {
          invalidEntries = true;
          continue;
        }
        pending[questionId] = { options: [], essay: answer.essay };
      } else {
        if (
          answer.essay !== null ||
          (question.type === "single" && answer.options.length !== 1)
        ) {
          invalidEntries = true;
          continue;
        }
        pending[questionId] = { options: answer.options, essay: null };
      }
    }
    return {
      pending,
      warning: invalidEntries
        ? "Một số đáp án nháp không hợp lệ đã bị bỏ qua; các câu trả lời đã lưu trên máy chủ vẫn được giữ."
        : "",
    };
  } catch (error) {
    console.error("Không thể khôi phục bản nháp đáp án trên thiết bị.", error);
    return {
      pending,
      warning:
        "Không thể khôi phục bản nháp trên thiết bị; các câu trả lời đã lưu trên máy chủ vẫn được giữ.",
    };
  }
}

function EntryHeader({ title, logoUrl }: { title: string; logoUrl?: string }) {
  return (
    <header className="candidate-entry-header">
      <div className="candidate-entry-header-inner">
        <div className="candidate-entry-logo">
          <img src={logoUrl || "/logo.png"} alt="Logo Tân Minh Nhân" />
        </div>
        <div className="candidate-entry-hero">
          {/* <div className="candidate-entry-label">
            <span className="candidate-entry-label-line" aria-hidden="true" />
            <span className="candidate-entry-label-pill">TÂN MINH NHÂN</span>
            <span className="candidate-entry-label-line" aria-hidden="true" />
          </div> */}
          <h1>{title}</h1>
          {/* <div className="candidate-entry-highlights">
            <span className="candidate-entry-highlight">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" />
              </svg>
              Đánh giá chuyên nghiệp
            </span>
            <span className="candidate-entry-highlight-divider" aria-hidden="true" />
            <span className="candidate-entry-highlight">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 2 8 4.5-8 4.5-8-4.5L12 2Z" /><path d="m4 11 8 4.5 8-4.5" /><path d="m4 15.5 8 4.5 8-4.5" />
              </svg>
              Tuân thủ quy trình
            </span>
            <span className="candidate-entry-highlight-divider" aria-hidden="true" />
            <span className="candidate-entry-highlight">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2 2 0 0 0-2.91-.09Z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6.05 11A22 22 0 0 1 12 15Z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
              Sẵn sàng trước khi bắt đầu
            </span>
          </div> */}
          <span className="candidate-entry-glow-line" aria-hidden="true" />
        </div>
        <span aria-hidden="true" />
      </div>
    </header>
  );
}

function Shell({
  info,
  children,
  compact = false,
  done = false,
}: {
  info: Info | null;
  children: React.ReactNode;
  compact?: boolean;
  done?: boolean;
}) {
  return (
    <div
      className={"candidate-shell" + (compact ? " candidate-shell-entry" : "") + (done ? " candidate-shell-done" : "")}
    >
      {compact ? (
        <EntryHeader
          title={info?.title ?? "TÂN MINH NHÂN"}
          logoUrl={info?.logoUrl}
        />
      ) : (
        <header className="candidate-header">
          <div className="candidate-header-inner">
            <div className="candidate-brand">
              {info?.logoUrl && <img src={info.logoUrl} alt="Logo công ty" />}
            </div>
            <h1 className="candidate-header-title">
              {info?.title ?? "TÂN MINH NHÂN"}
            </h1>
            {/* <span className="candidate-header-badge">Kỳ thi nội bộ</span> */}
          </div>
        </header>
      )}
      <main
        className={
          "candidate-main " + (compact ? "candidate-main-compact" : "") + (done ? " candidate-main-done" : "")
        }
      >
        {children}
      </main>
    </div>
  );
}

function Entry({
  info,
  onStarted,
}: {
  info: Info;
  onStarted: (fullscreenWarning: string) => void;
}) {
  const [f, setF] = useState({
    fullName: "",
    email: "",
    position: "",
    level: "",
    mainProject: "",
  });
  const [fe, setFe] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const offset = useRef(Date.parse(info.serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => clearInterval(t);
  }, []);
  const msToOpen = Date.parse(info.openingAt) - now;
  const waiting = msToOpen > 0;
  const closed = now >= Date.parse(info.closingAt);
  const validate = () => {
    const v: Record<string, string> = {};
    if (f.fullName.trim().length < 2) v.fullName = "Nhập họ và tên.";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim()))
      v.email = "Nhập địa chỉ email hợp lệ.";
    else if (!/^[^\s@]+@tanminhnhan\.com\.vn$/i.test(f.email.trim()))
      v.email = "Email phải có đuôi @tanminhnhan.com.vn.";
    if (f.position.trim().length < 2) v.position = "Nhập chức danh.";
    if (!f.level.trim()) v.level = "Nhập cấp bậc.";
    if (
      !f.mainProject ||
      !info.projects.some((project) => project.name === f.mainProject)
    )
      v.mainProject = info.projects.length
        ? "Chọn công trình chính trong danh sách."
        : "Danh sách công trình chưa được cấu hình. Vui lòng báo quản trị viên.";
    return v;
  };
  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || waiting || closed) return;
    const v = validate();
    setFe(v);
    setErr("");
    const acceptanceMessage = rulesAccepted
      ? ""
      : "Vui lòng xác nhận đã đọc và đồng ý tuân thủ nội quy thi.";
    setAcceptanceError(acceptanceMessage);
    if (Object.keys(v).length || acceptanceMessage) return;
    setBusy(true);
    let fullscreenWarning = "";
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        fullscreenWarning =
          "Không bật được toàn màn hình. Trong bài thi, hãy dùng nút “Bật toàn màn hình” để thử lại.";
      }
    }
    try {
      await api("exam/start", { method: "POST", body: JSON.stringify(f) });
      onStarted(fullscreenWarning);
    } catch (x) {
      const a = x as ApiError;
      setErr(a.message);
      if (a.fields)
        setFe(
          Object.fromEntries(
            Object.entries(a.fields).map(([k, m]) => [k, m[0]]),
          ),
        );
    } finally {
      setBusy(false);
    }
  }
  const countdown = (() => {
    const s = Math.max(0, Math.ceil(msToOpen / 1000));
    const p = (n: number) => String(n).padStart(2, "0");
    const d = Math.floor(s / 86400);
    return `${d > 0 ? d + " ngày " : ""}${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  })();
  const rules = [
    <>
      Điền <span className="font-semibold text-black">đầy đủ và chính xác</span>{" "}
      họ tên, email công ty (
      <span className="font-semibold text-black">@tanminhnhan.com.vn</span>) có
      trong danh sách được duyệt, chức danh/vị trí, cấp bậc và công trình chính.
    </>,
    <>
      <span className="font-semibold text-black">Mỗi email</span> công ty chỉ
      được tham gia kiểm tra{" "}
      <span className="font-semibold text-black">một lần</span>.
    </>,
    <>
      Bài kiểm tra mở từ{" "}
      <span className="font-semibold text-black">{fmt(info.openingAt)}</span>{" "}
      đến{" "}
      <span className="font-semibold text-black">{fmt(info.closingAt)}</span>{" "}
      (giờ Việt Nam).
    </>,
    <>
      Trình duyệt sẽ yêu cầu mở{" "}
      <span className="font-semibold text-black">toàn màn hình</span> khi bắt
      đầu. Nếu không bật được, hãy nhấn{" "}
      <span className="font-semibold text-black">F11</span>.
    </>,
    <>
      <span className="font-semibold text-red-700">
        Không chuyển sang tab hoặc cửa sổ khác.
      </span>{" "}
      Nếu trang thi bị ẩn, bài thi sẽ{" "}
      <span className="font-semibold text-black">tự động được nộp</span>.
    </>,
    // <>Khi <span className="font-semibold text-red-700">hết giờ hoặc đến giờ đóng kỳ thi</span>, bài sẽ <span className="font-semibold text-red-700">tự nộp</span>. Câu trắc nghiệm <span className="font-semibold text-red-700">chưa trả lời tính là sai</span>; câu tự luận do giám khảo chấm riêng. Điểm được hiển thị theo cài đặt của quản trị viên.</>,
  ];
  const field = (
    k: keyof typeof f,
    label: string,
    type = "text",
    auto?: string,
  ) => (
    <div className="entry-field">
      <label htmlFor={k} className="entry-field-label">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className={k === "email" ? "entry-email-control" : undefined}>
        <input
          ref={k === "email" ? emailInputRef : undefined}
          id={k}
          type={k === "email" ? "text" : type}
          inputMode={k === "email" ? "email" : undefined}
          autoComplete={auto}
          value={f[k]}
          placeholder={
            k === "email" ? "Nhập email công ty" : `Nhập ${label.toLowerCase()}`
          }
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
          aria-invalid={!!fe[k]}
          aria-describedby={fe[k] ? k + "-e" : undefined}
          className={
            "entry-input " + (k === "email" ? "entry-email-input" : "")
          }
        />
        {k === "email" && (
          <button
            type="button"
            onClick={() => {
              setF((current) => {
                const localPart = current.email.trim().split("@")[0];
                return { ...current, email: `${localPart}@tanminhnhan.com.vn` };
              });
              requestAnimationFrame(() => {
                const input = emailInputRef.current;
                if (!input) return;
                const cursor = input.value.indexOf("@");
                input.focus();
                input.setSelectionRange(cursor, cursor);
              });
            }}
            className="entry-email-suffix"
          >
            @tanminhnhan.com.vn
          </button>
        )}
      </div>
      {fe[k] && (
        <p id={k + "-e"} className="entry-field-error">
          {fe[k]}
        </p>
      )}
    </div>
  );
  const examStatus = closed
    ? "Đã kết thúc"
    : !info.active
      ? "Chưa kích hoạt"
      : waiting
        ? "Sắp mở thi"
        : "Đang mở thi";
        /* sau /embed/ và trước dấu ? là ID video*/
  const guideVideoId = "xKewcE3wBmU";
  return (
    <div className="candidate-entry">
      <div className="entry-layout">
        <div className="entry-support">
          <section aria-labelledby="rules" className="entry-rules entry-card">
            <div className="entry-card-heading">
              <span className="entry-soft-icon" aria-hidden="true">
                ✦
              </span>
              <div>
                <h2 id="rules">NỘI QUY LÀM BÀI KIỂM TRA</h2>
                <p>
                  {info.multipleChoiceCount + info.essayCount} câu hỏi{" "}
                  <span aria-hidden="true">·</span> {info.durationMinutes} phút{" "}
                  <span aria-hidden="true">·</span> {examStatus}
                </p>
              </div>
            </div>
            <ol className="entry-rules-list">
              {rules.map((rule, index) => (
                <li
                  key={index}
                  className={
                    index === 4 ? "entry-rule entry-rule-alert" : "entry-rule"
                  }
                >
                  <span className="entry-number-pill">{index + 1}</span>
                  <p>{rule}</p>
                </li>
              ))}
            </ol>
            <p className="entry-rules-wish">✦ Chúc bạn làm bài tốt!</p>
          </section>
          <section
            className="entry-video entry-card"
            aria-label="Video hướng dẫn làm bài"
          >
            <div className="entry-video-frame">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${guideVideoId}`}
                title="Video hướng dẫn làm bài"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          </section>
        </div>
        <form onSubmit={go} noValidate className="entry-form entry-card">
          <div className="entry-card-heading entry-form-heading">
            <div className="entry-soft-icon">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-6 w-6 text-blue-200"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z"
                />
              </svg>
            </div>
            <div>
              <h2>THÔNG TIN NHÂN VIÊN</h2>
              <p>
                Vui lòng điền đầy đủ và kiểm tra kỹ thông tin trước khi bắt đầu.
              </p>
            </div>
          </div>
          <div className="entry-form-body">
            <div className="entry-fields">
              {field("fullName", "Họ và tên", "text", "name")}
              {field("email", "Email công ty", "email", "email")}
              {field("position", "Chức danh / vị trí")}
              {field("level", "Cấp bậc")}
              <div className="entry-field entry-field-wide">
                <label htmlFor="mainProject" className="entry-field-label">
                  Địa điểm kiểm tra <span className="text-red-500">*</span>
                </label>
                <select
                  id="mainProject"
                  value={f.mainProject}
                  onChange={(e) => setF({ ...f, mainProject: e.target.value })}
                  aria-invalid={!!fe.mainProject}
                  aria-describedby={
                    fe.mainProject ? "mainProject-e" : undefined
                  }
                  className="entry-input"
                >
                  <option value="">-- Chọn địa điểm kiểm tra --</option>
                  {info.projects.map((project) => (
                    <option key={project.id} value={project.name}>
                      {project.name}
                    </option>
                  ))}
                </select>
                {fe.mainProject && (
                  <p id="mainProject-e" className="entry-field-error">
                    {fe.mainProject}
                  </p>
                )}
                {info.projects.length === 0 && (
                  <p className="entry-field-error">
                    Danh sách công trình chưa được cấu hình.
                  </p>
                )}
              </div>
            </div>
            <div className="entry-form-actions">
              <div>
                <label
                  htmlFor="rulesAccepted"
                  className={
                    "entry-acceptance " + (acceptanceError ? "has-error" : "")
                  }
                >
                  <input
                    id="rulesAccepted"
                    type="checkbox"
                    checked={rulesAccepted}
                    onChange={(e) => {
                      setRulesAccepted(e.target.checked);
                      if (e.target.checked) setAcceptanceError("");
                    }}
                    aria-required="true"
                    aria-invalid={!!acceptanceError}
                    aria-describedby={
                      acceptanceError ? "rulesAccepted-error" : undefined
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#1B365D] focus:ring-[#1B365D]"
                  />
                  <span>
                    Tôi đã đọc, hiểu rõ và cam kết tuân thủ toàn bộ nội quy.
                  </span>
                </label>
                {acceptanceError && (
                  <p
                    id="rulesAccepted-error"
                    role="alert"
                    className="entry-field-error"
                  >
                    {acceptanceError}
                  </p>
                )}
              </div>
              {err && (
                <p role="alert" className="text-sm text-red-700">
                  {err}
                </p>
              )}
              {waiting && info.active && (
                <p
                  role="status"
                  className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <span className="shrink-0 font-mono text-base font-bold">
                    {countdown}
                  </span>
                  <span>
                    Chưa đến giờ thi. Bạn có thể điền sẵn thông tin và bắt đầu
                    khi kỳ thi mở.
                  </span>
                </p>
              )}
              {closed && (
                <p
                  role="status"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  Bài kiểm tra đã kết thúc.
                </p>
              )}
              {!info.active && (
                <p className="text-sm text-slate-600">
                  Bài kiểm tra hiện chưa được kích hoạt.
                </p>
              )}
              <button
                disabled={
                  busy ||
                  !info.active ||
                  waiting ||
                  closed ||
                  info.projects.length === 0 ||
                  !rulesAccepted
                }
                className="entry-start-button group"
              >
                <span>
                  {busy
                    ? "ĐANG BẮT ĐẦU…"
                    : waiting
                      ? "CHƯA ĐẾN GIỜ KIỂM TRA"
                      : "BẮT ĐẦU KIỂM TRA"}
                </span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="h-5 w-5 transition-transform group-hover:translate-x-1"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14 5l7 7m0 0-7 7m7-7H3"
                  />
                </svg>
              </button>
              <p className="flex items-center justify-center gap-2 text-center text-[11px] font-medium text-slate-500">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 shrink-0 text-emerald-600"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 1.5 3 4v5c0 4.2 2.8 7.7 7 9.5 4.2-1.8 7-5.3 7-9.5V4l-7-2.5Zm3.2 6.8a.9.9 0 0 0-1.3-1.3L9 9.9 8.1 9a.9.9 0 1 0-1.3 1.3l1.6 1.6a.9.9 0 0 0 1.3 0l3.5-3.6Z"
                    clipRule="evenodd"
                  />
                </svg>
                Hệ thống sẽ tự động nộp bài nếu phát hiện rời khỏi màn hình bài
                làm.
              </p>
              <p className="entry-score-note">
                <span>
                  {info.multipleChoiceCount} câu trắc nghiệm ×{" "}
                  {formatPoints(info.mcPointsPerQuestion)} điểm
                </span>
                <span aria-hidden="true">•</span>
                <span>
                  {info.essayCount} câu tự luận ×{" "}
                  {formatPoints(info.essayPointsPerQuestion)} điểm
                </span>
                <span aria-hidden="true">•</span>
                <strong>Đạt từ {formatPoints(info.passingScore)} điểm</strong>
              </p>
            </div>
          </div>
        </form>
      </div>
      <footer className="entry-footer">
        © {new Date().getFullYear()} <strong>Tân Minh Nhân Corporation.</strong>{" "}
        <span aria-hidden="true"></span>
      </footer>
    </div>
  );
}

function Exam({
  st,
  onDone,
  fullscreenWarning,
}: {
  st: St;
  onDone: (state: St, tabSwitch: boolean) => void;
  fullscreenWarning: string;
}) {
  const qs = st.questions!;
  const [restoredDraft] = useState(() => readAnswerDraft(st.attemptId, qs));
  const [ans, setAns] = useState<Record<string, AnswerValue>>(() => ({
    ...(st.answers ?? {}),
    ...restoredDraft.pending,
  }));
  const [i, setI] = useState(0);
  const offset = useRef(new Date(st.serverNow).getTime() - Date.now());
  const deadline = new Date(st.deadlineAt!).getTime();
  const [left, setLeft] = useState(
    remainingMs(deadline, offset.current, Date.now()),
  );
  const [sync, setSync] = useState<"saved" | "saving" | "error">(
    Object.keys(restoredDraft.pending).length ? "saving" : "saved",
  );
  const [confirm, setConfirm] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [draftWarning, setDraftWarning] = useState(restoredDraft.warning);
  const [fullscreenNotice, setFullscreenNotice] = useState(fullscreenWarning);
  const [tabSwitchProtectionEnabled, setTabSwitchProtectionEnabled] =
    useState(true);
  const [reviewPdfBusy, setReviewPdfBusy] = useState(false);
  const [reviewPdfError, setReviewPdfError] = useState("");
  const pendingAnswers = useRef(new Map(Object.entries(restoredDraft.pending)));
  const batchTimer = useRef<number | null>(null);
  const flushInFlight = useRef<Promise<FlushResult> | null>(null);
  const flushRef = useRef<() => Promise<FlushResult>>(async () => "saved");
  const submitRef = useRef<
    (reason: "manual" | "tab_switch" | "deadline") => Promise<void>
  >(async () => undefined);
  const sub = useRef(false);
  const reviewPdfRequest = useRef(false);
  const draftKey = `exam-answer-draft:${st.attemptId ?? ""}`;

  const persistPendingDraft = useCallback(() => {
    try {
      if (!st.attemptId) throw new Error("Thiếu mã lượt thi để lưu bản nháp.");
      const draft = Object.fromEntries(pendingAnswers.current);
      if (Object.keys(draft).length)
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
      else window.localStorage.removeItem(draftKey);
      setDraftWarning("");
    } catch (error) {
      console.error("Không thể lưu bản nháp đáp án trên thiết bị.", error);
      setDraftWarning(
        "Không lưu được bản nháp trên thiết bị; hãy giữ trang thi mở cho đến khi trạng thái hiển thị “Đã lưu”.",
      );
    }
  }, [draftKey, st.attemptId]);

  const scheduleFlush = useCallback((delay = 120000) => {
    if (
      sub.current ||
      !pendingAnswers.current.size ||
      batchTimer.current !== null
    )
      return;
    batchTimer.current = window.setTimeout(() => {
      batchTimer.current = null;
      void flushRef.current().then((result) => {
        if (result === "expired") void submitRef.current("deadline");
      });
    }, delay);
  }, []);

  const flushAnswers = useCallback(async (): Promise<FlushResult> => {
    if (flushInFlight.current) return flushInFlight.current;
    const batch = [...pendingAnswers.current.entries()].slice(0, 5);
    if (!batch.length) return "saved";
    if (batchTimer.current !== null) {
      window.clearTimeout(batchTimer.current);
      batchTimer.current = null;
    }

    let retryAutomatically = true;
    const request = (async (): Promise<FlushResult> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const answers = batch.map(([questionId, answer]) =>
            answer.essay !== null
              ? { questionId, essay: answer.essay }
              : { questionId, optionIds: answer.options },
          );
          await api("exam/answers", {
            method: "PUT",
            body: JSON.stringify({ answers }),
          });
          for (const [questionId, answer] of batch) {
            if (pendingAnswers.current.get(questionId) === answer)
              pendingAnswers.current.delete(questionId);
          }
          persistPendingDraft();
          setSync(pendingAnswers.current.size ? "saving" : "saved");
          return "saved";
        } catch (error) {
          const status = (error as ApiError).status;
          if (status === 409) {
            setSync("error");
            return "expired";
          }
          if (status && status < 500 && status !== 429) {
            retryAutomatically = false;
            break;
          }
          if (attempt < 2) await sleep(500 * (attempt + 1));
        }
      }
      setSync("error");
      return "error";
    })();

    flushInFlight.current = request;
    const result = await request;
    if (flushInFlight.current === request) flushInFlight.current = null;
    if (result === "saved" && pendingAnswers.current.size && !sub.current) {
      if (pendingAnswers.current.size >= 5) {
        void flushRef.current().then((nextResult) => {
          if (nextResult === "expired") void submitRef.current("deadline");
        });
      } else {
        scheduleFlush();
      }
    } else if (result === "error" && retryAutomatically && !sub.current) {
      scheduleFlush(5000);
    }
    return result;
  }, [persistPendingDraft, scheduleFlush]);
  flushRef.current = flushAnswers;

  const enableFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenNotice("");
    } catch {
      setFullscreenNotice(
        "Trình duyệt không bật được toàn màn hình. Hãy kiểm tra quyền toàn màn hình hoặc thử lại bằng nút này.",
      );
    }
  };

  const downloadReviewPdf = useCallback(() => {
    if (reviewPdfRequest.current) return;
    if (sub.current) {
      setReviewPdfError(
        "Bài thi đang được nộp hoặc đã nộp, không thể xuất PDF đối chiếu.",
      );
      return;
    }
    reviewPdfRequest.current = true;
    setReviewPdfBusy(true);
    setReviewPdfError("");
    const anchor = document.createElement("a");
    anchor.href = "/api/exam/review-pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      reviewPdfRequest.current = false;
      setReviewPdfBusy(false);
    }, 1500);
  }, []);

  const submit = useCallback(
    async (reason: "manual" | "tab_switch" | "deadline") => {
      if (sub.current) return;
      sub.current = true;
      setConfirm(false);
      setMsg(
        reason === "tab_switch"
          ? "Bạn đã chuyển sang tab khác. Bài đang được nộp tự động…"
          : "Đang nộp bài…",
      );
      if (batchTimer.current !== null) {
        window.clearTimeout(batchTimer.current);
        batchTimer.current = null;
      }
      while (pendingAnswers.current.size) {
        const result = await flushAnswers();
        if (result === "error") {
          sub.current = false;
          setMsg(
            "Chưa đồng bộ được các đáp án do lỗi mạng. Bài chưa được nộp; hãy kiểm tra kết nối rồi thử lại.",
          );
          return;
        }
        if (result === "expired") break;
      }
      for (let k = 0; k < 4; k++) {
        try {
          const r = await api<St>("exam/submit", {
            method: "POST",
            body: JSON.stringify({ reason }),
            keepalive: true,
          });
          pendingAnswers.current.clear();
          persistPendingDraft();
          return onDone(r, reason === "tab_switch");
        } catch (e) {
          if ((e as ApiError).status === 401) break;
          await sleep(800 * (k + 1));
        }
      }
      sub.current = false;
      setMsg('Chưa nộp được bài do lỗi mạng. Bấm "Nộp bài" để thử lại.');
    },
    [flushAnswers, onDone, persistPendingDraft],
  );
  submitRef.current = submit;

  useEffect(() => {
    const t = setInterval(() => {
      const r = remainingMs(deadline, offset.current, Date.now());
      setLeft(r);
      if (r <= 0) void submit("deadline");
      else if (
        tabSwitchProtectionEnabled &&
        (document.hidden || !document.hasFocus())
      )
        void submit("tab_switch");
    }, 500);
    const vis = () => {
      if (tabSwitchProtectionEnabled && document.visibilityState === "hidden")
        void submit("tab_switch");
    };
    const blur = () => {
      if (tabSwitchProtectionEnabled) void submit("tab_switch");
    };
    const blockClipboard = (e: Event) => e.preventDefault();
    const blockShortcuts = (e: KeyboardEvent) => {
      const reviewPdfShortcut =
        e.key.toLowerCase() === "f8" &&
        e.ctrlKey !== e.shiftKey &&
        !e.altKey &&
        !e.metaKey;
      if (reviewPdfShortcut) {
        e.preventDefault();
        if (!e.repeat) downloadReviewPdf();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.code === "F8" && !e.repeat) {
        e.preventDefault();
        setTabSwitchProtectionEnabled((enabled) => !enabled);
        return;
      }
      if (
        tabSwitchProtectionEnabled &&
        document.fullscreenElement &&
        (e.key === "Escape" || e.key === "F11")
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ["a", "c", "x", "p"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
      }
    };
    const handleFullscreenChange = () => {
      if (
        document.fullscreenElement ||
        !tabSwitchProtectionEnabled ||
        sub.current
      )
        return;
      setFullscreenNotice(
        "Trình duyệt đã thoát toàn màn hình. Hãy nhấn “Bật toàn màn hình” để tiếp tục.",
      );
    };
    document.addEventListener("visibilitychange", vis);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("blur", blur);
    document.addEventListener("copy", blockClipboard, true);
    document.addEventListener("cut", blockClipboard, true);
    document.addEventListener("paste", blockClipboard, true);
    document.addEventListener("contextmenu", blockClipboard, true);
    document.addEventListener("selectstart", blockClipboard, true);
    document.addEventListener("dragstart", blockClipboard, true);
    document.addEventListener("keydown", blockShortcuts, true);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("blur", blur);
      document.removeEventListener("copy", blockClipboard, true);
      document.removeEventListener("cut", blockClipboard, true);
      document.removeEventListener("paste", blockClipboard, true);
      document.removeEventListener("contextmenu", blockClipboard, true);
      document.removeEventListener("selectstart", blockClipboard, true);
      document.removeEventListener("dragstart", blockClipboard, true);
      document.removeEventListener("keydown", blockShortcuts, true);
    };
  }, [deadline, downloadReviewPdf, submit, tabSwitchProtectionEnabled]);

  useEffect(() => {
    if (pendingAnswers.current.size) scheduleFlush();
    const onPageHide = () => {
      if (pendingAnswers.current.size) void flushRef.current();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      if (batchTimer.current !== null) window.clearTimeout(batchTimer.current);
      batchTimer.current = null;
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [scheduleFlush]);

  function queueAnswer(q: Q, value: AnswerValue) {
    if (sub.current) return;
    const next = { options: [...value.options], essay: value.essay };
    setAns((a) => ({ ...a, [q.id]: next }));
    pendingAnswers.current.set(q.id, next);
    persistPendingDraft();
    setSync("saving");
    if (pendingAnswers.current.size >= 5) {
      if (batchTimer.current !== null) {
        window.clearTimeout(batchTimer.current);
        batchTimer.current = null;
      }
      flushPendingAnswers();
    } else {
      scheduleFlush();
    }
  }
  function flushPendingAnswers() {
    void flushRef.current().then((result) => {
      if (result === "expired") void submitRef.current("deadline");
    });
  }
  const pick = (q: Q, o: Opt) => {
    const current = ans[q.id]?.options ?? [];
    const options =
      q.type === "multiple"
        ? current.includes(o.id)
          ? current.filter((id) => id !== o.id)
          : [...current, o.id]
        : [o.id];
    queueAnswer(q, { options, essay: null });
  };
  const editEssay = (q: Q, essay: string) => {
    queueAnswer(q, { options: [], essay });
  };
  const q = qs[i];
  const all = st.displayMode === "all";
  const goTo = (n: number) => {
    setI(n);
    if (all)
      document
        .getElementById("q-" + qs[n].id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const done = Object.values(ans).filter((a) =>
    a.essay !== null ? !!a.essay.trim() : a.options.length > 0,
  ).length;
  const mm = String(Math.floor(left / 60000)).padStart(2, "0"),
    ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return (
    <div className="candidate-exam select-none">
      {tabSwitchProtectionEnabled &&
        !document.fullscreenElement &&
        !sub.current && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="fullscreen-required"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4"
          >
            <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-2xl">
              <h2
                id="fullscreen-required"
                className="text-lg font-bold text-slate-900"
              >
                Cần bật toàn màn hình
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Không thể tiếp tục làm bài khi đã thoát toàn màn hình. Hãy bật
                lại để tiếp tục.
              </p>
              <button
                type="button"
                onClick={() => void enableFullscreen()}
                className="mt-5 rounded-md bg-[#294075] px-5 py-2 font-semibold text-white transition-colors hover:bg-[#172554] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294075] focus-visible:ring-offset-2"
              >
                Bật lại toàn màn hình
              </button>
            </div>
          </div>
        )}
      <div className="exam-candidate">
        <div className="text-sm">
          <span className="font-medium">{st.candidate?.fullName}</span> ·{" "}
          {st.candidate?.position}
          {" · "}
          {"Cấp bậc: "}
          {st.candidate?.level}
          {" · "}
          {st.candidate?.mainProject}
        </div>
        <div>
          <span className={"exam-sync exam-sync-" + sync} role="status">
            {sync === "saved"
              ? "Đã lưu"
              : sync === "saving"
                ? "Đang lưu…"
                : "Lỗi lưu, đáp án đang chờ đồng bộ"}
          </span>
        </div>
      </div>
      {draftWarning && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-amber-100 px-4 py-3 text-amber-900"
        >
          {draftWarning}
        </p>
      )}
      {fullscreenNotice && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <span>{fullscreenNotice}</span>
          <button
            type="button"
            onClick={() => void enableFullscreen()}
            className="rounded-md border border-[#36796F] px-3 py-1.5 font-semibold text-[#36796F] hover:bg-[#EDF6F4]"
          >
            Bật toàn màn hình
          </button>
        </div>
      )}
      {msg && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-amber-100 px-4 py-3 text-amber-900"
        >
          {msg}
        </p>
      )}
      {msg.startsWith("Bạn đã chuyển sang tab khác.") && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="tab-submit-notice"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-xl border-2 border-red-300 bg-white p-6 text-center shadow-2xl">
            <p className="mx-auto w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-800">
              Vi phạm quy định thi
            </p>
            <h2
              id="tab-submit-notice"
              className="mt-3 text-lg font-bold text-red-800"
            >
              Bài thi đang được nộp tự động
            </h2>
            <p className="mt-2 text-red-800">{msg}</p>
            <p className="mt-2 text-sm text-slate-600">
              Vui lòng đợi trong giây lát.
            </p>
          </div>
        </div>
      )}
      <div
        className="exam-overall-progress"
        role="progressbar"
        aria-label="Tiến độ làm bài"
        aria-valuemin={0}
        aria-valuemax={qs.length}
        aria-valuenow={done}
      >
        <div style={{ width: (done / qs.length) * 100 + "%" }} />
      </div>
      <div className="exam-layout">
        <div className="exam-questions">
          {(all ? qs : [q]).map((q, n) => {
            const points =
              q.type === "essay"
                ? (st.essayPointsPerQuestion ?? 0)
                : (st.mcPointsPerQuestion ?? 0);
            return (
              <section
                key={q.id}
                id={"q-" + q.id}
                className="exam-question-card"
              >
                <div className="exam-question-top">
                  <div className="exam-question-pills">
                    <span className="exam-question-index">
                      Câu {all ? n + 1 : i + 1} / {qs.length}
                    </span>
                    <span className="exam-question-type">
                      {q.type === "essay"
                        ? "Tự luận"
                        : q.type === "multiple"
                          ? "Trắc nghiệm · Chọn nhiều"
                          : "Trắc nghiệm · Chọn một"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={
                      "exam-bookmark " +
                      (bookmarks.includes(q.id) ? "is-bookmarked" : "")
                    }
                    onClick={() =>
                      setBookmarks((current) =>
                        current.includes(q.id)
                          ? current.filter((id) => id !== q.id)
                          : [...current, q.id],
                      )
                    }
                    aria-pressed={bookmarks.includes(q.id)}
                  >
                    <span aria-hidden="true">
                      {bookmarks.includes(q.id) ? "★" : "☆"}
                    </span>{" "}
                    {bookmarks.includes(q.id) ? "Đã đánh dấu" : "Đánh dấu"}
                  </button>
                </div>
                <div className="exam-question-body">
                  <h2>{q.text}</h2>
                  <p className="exam-question-score">
                    Tối đa {formatPoints(points)} điểm
                  </p>
                  {q.type === "essay" ? (
                    <label className="exam-essay-label">
                      <span>Nội dung trả lời</span>
                      <textarea
                        rows={8}
                        maxLength={10000}
                        value={ans[q.id]?.essay ?? ""}
                        onChange={(e) => editEssay(q, e.target.value)}
                        placeholder="Nhập câu trả lời..."
                      />
                    </label>
                  ) : (
                    <fieldset className="exam-choices">
                      <legend>
                        {q.type === "multiple"
                          ? "Chọn tất cả đáp án phù hợp."
                          : "Chọn một đáp án."}
                      </legend>
                      {q.options.map((o) => {
                        const checked =
                          ans[q.id]?.options?.includes(o.id) ?? false;
                        return (
                          <label
                            key={o.id}
                            className={
                              "exam-choice " + (checked ? "is-selected" : "")
                            }
                          >
                            <input
                              type={
                                q.type === "multiple" ? "checkbox" : "radio"
                              }
                              name={q.id}
                              checked={checked}
                              onChange={() => pick(q, o)}
                            />
                            <span
                              className="exam-choice-key"
                              aria-hidden="true"
                            >
                              {o.id.toUpperCase()}
                            </span>
                            <span>{o.text}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                  )}
                </div>
                {!all && (
                  <div className="exam-question-actions">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => setI(i - 1)}
                      className="exam-secondary-button"
                    >
                      ← Câu trước
                    </button>
                    {i < qs.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setI(i + 1)}
                        className="exam-primary-button"
                      >
                        Câu sau →
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirm(true)}
                        className="exam-submit-button"
                      >
                        Nộp bài
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          {all && (
            <div className="exam-all-submit">
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className="exam-submit-button"
              >
                Nộp bài
              </button>
            </div>
          )}
        </div>
        <nav aria-label="Danh sách câu hỏi" className="exam-sidebar">
          <h2>
            <span className="exam-sidebar-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect x="5" y="4" width="14" height="17" rx="2" />
                <path
                  strokeLinecap="round"
                  d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h4"
                />
              </svg>
            </span>{" "}
            Danh sách câu hỏi
          </h2>
          <div className="exam-sidebar-completion">
            <span>
              Đã làm:{" "}
              <strong>
                {done} / {qs.length}
              </strong>
            </span>
            <strong>{Math.round((done / qs.length) * 100)}%</strong>
          </div>
          <div className="exam-track" aria-hidden="true">
            <div style={{ width: (done / qs.length) * 100 + "%" }} />
          </div>
          <div className="exam-sidebar-divider" />
          <h3>Câu hỏi (1 – {qs.length})</h3>
          <div className="exam-question-grid">
            {qs.map((x, n) => {
              const answer = ans[x.id];
              const answered =
                answer &&
                (answer.essay !== null
                  ? !!answer.essay.trim()
                  : answer.options.length > 0);
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => goTo(n)}
                  aria-label={`Câu ${n + 1}${answered ? ", đã trả lời" : ", chưa trả lời"}${bookmarks.includes(x.id) ? ", đã đánh dấu" : ""}`}
                  aria-current={n === i ? "step" : undefined}
                  className={
                    "exam-question-number " +
                    (n === i ? "is-current " : "") +
                    (answered ? "is-answered " : "") +
                    (bookmarks.includes(x.id) ? "is-bookmarked" : "")
                  }
                >
                  {n + 1}
                </button>
              );
            })}
          </div>
          <div className="exam-legend">
            <span>
              <i className="legend-current" />
              Đang làm
            </span>
            <span>
              <i className="legend-empty" />
              Chưa làm
            </span>
            <span>
              <i className="legend-answered" />
              Đã làm
            </span>
          </div>
        </nav>
        <aside className="exam-status" aria-label="Trạng thái bài thi">
          <div className={"exam-timer " + (left < 300000 ? "is-low" : "")}>
            <span className="exam-timer-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 7v5l3 2" />
              </svg>
            </span>
            <div>
              <span>Thời gian còn lại</span>
              <strong
                className="tabular-nums"
                aria-label={`Còn ${mm} phút ${ss} giây`}
              >
                {mm}:{ss}
              </strong>
            </div>
          </div>
          <div className="exam-status-progress">
            <h2>Tiến trình bài thi</h2>
            <div>
              <span>
                {done} / {qs.length} câu
              </span>
              <strong>{Math.round((done / qs.length) * 100)}%</strong>
            </div>
            <div className="exam-track" aria-hidden="true">
              <div style={{ width: (done / qs.length) * 100 + "%" }} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="exam-submit-button exam-submit-wide"
          >
            Nộp bài
          </button>
          <p
            className={
              "exam-warning " +
              (tabSwitchProtectionEnabled ? "" : "is-practice")
            }
          >
            <strong>
              {tabSwitchProtectionEnabled
                ? "Lưu ý quan trọng"
                : "Chế độ thử đang bật"}
            </strong>
            <span>
              {tabSwitchProtectionEnabled
                ? "Không chuyển sang tab/cửa sổ khác hoặc thoát toàn màn hình. Bài thi sẽ tự động nộp nếu vi phạm."
                : "Chuyển tab không tự động nộp bài và có thể thoát toàn màn hình."}
            </span>
          </p>
          <p
            className={"exam-save-note " + (sync === "error" ? "is-error" : "")}
          >
            {sync === "saved"
              ? "✓ Câu trả lời đã được lưu"
              : sync === "saving"
                ? "◷ Câu trả lời đang được lưu"
                : "⚠ Đáp án đang chờ đồng bộ"}
          </p>
          {reviewPdfBusy && (
            <p role="status" className="exam-status-note">
              Đang xuất PDF đối chiếu…
            </p>
          )}
          {reviewPdfError && (
            <p role="alert" className="exam-status-error">
              {reviewPdfError}
            </p>
          )}
        </aside>
      </div>
      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cf"
          className="exam-dialog-backdrop"
        >
          <div className="exam-dialog">
            <div className="exam-dialog-icon" aria-hidden="true">
              ✓
            </div>
            <h2 id="cf">Xác nhận nộp bài?</h2>
            <p>
              Bạn đã trả lời{" "}
              <strong>
                {done}/{qs.length} câu.
              </strong>{" "}
              Sau khi nộp, bạn không thể chỉnh sửa bài làm.
            </p>
            <div className="exam-dialog-actions">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirm(false)}
                className="exam-secondary-button"
              >
                Tiếp tục làm bài
              </button>
              <button
                type="button"
                onClick={() => void submit("manual")}
                className="exam-submit-button"
              >
                Xác nhận nộp bài
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [info, setInfo] = useState<Info | null>(null);
  const [st, setSt] = useState<St | null>(null);
  const [resetError, setResetError] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [tabSwitchNotice, setTabSwitchNotice] = useState(false);
  const [fullscreenWarning, setFullscreenWarning] = useState("");
  const [fullscreenExitError, setFullscreenExitError] = useState("");
  const [submission, setSubmission] = useState<SubmissionSummary | null>(null);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [submissionRefresh, setSubmissionRefresh] = useState(0);
  const [phase, setPhase] = useState<
    "loading" | "entry" | "exam" | "done" | "error"
  >("loading");
  const loadState = useCallback(async () => {
    const s = await api<St>("exam/state");
    setSt(s);
    if (s.status === "in_progress") setPhase("exam");
    else setPhase("done");
  }, []);
  const load = useCallback(async () => {
    try {
      const i = await api<Info>("exam/info");
      setInfo(i);
      if (i.hasAttemptCookie === false) {
        setPhase("entry");
        return;
      }
      try {
        await loadState();
      } catch (e) {
        if ((e as ApiError).status === 401) setPhase("entry");
        else throw e;
      }
    } catch {
      setPhase("error");
    }
  }, [loadState]);
  const loadStartedState = useCallback(() => {
    setPhase("loading");
    void loadState().catch(() => setPhase("error"));
  }, [loadState]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (phase !== "done") return;
    const controller = new AbortController();
    setSubmissionLoading(true);
    setSubmissionError("");
    void api<SubmissionSummary>("exam/submission", {
      signal: controller.signal,
    })
      .then((saved) => {
        if (!controller.signal.aborted) setSubmission(saved);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setSubmissionError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSubmissionLoading(false);
      });
    return () => controller.abort();
  }, [phase, submissionRefresh]);
  useEffect(() => {
    if (phase !== "done" || !document.fullscreenElement) return;
    void document
      .exitFullscreen()
      .then(() => setFullscreenExitError(""))
      .catch(() =>
        setFullscreenExitError(
          "Bài đã nộp nhưng trình duyệt không tự tắt được toàn màn hình.",
        ),
      );
  }, [phase]);
  const returnHome = async () => {
    setResetBusy(true);
    setResetError("");
    try {
      await api("exam/reset", { method: "POST", body: "{}" });
      setSt(null);
      setSubmission(null);
      setTabSwitchNotice(false);
      setFullscreenExitError("");
      setPhase("entry");
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  };
  const downloadAnswerPdf = async () => {
    setExportBusy(true);
    setExportError("");
    try {
      const response = await fetch("/api/exam/export", {
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error || "Không tải được file bài làm. Vui lòng thử lại.",
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/i.exec(disposition)?.[1];
      anchor.download = filename || "bai-lam.pdf";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(
        e instanceof Error
          ? e.message
          : "Không tải được file bài làm. Vui lòng thử lại.",
      );
    } finally {
      setExportBusy(false);
    }
  };
  return (
    <Shell info={info} compact={phase === "entry"} done={phase === "done"}>
      {phase === "loading" && <p role="status">Đang tải…</p>}
      {phase === "error" && (
        <p role="alert" className="text-red-700">
          Không kết nối được máy chủ.{" "}
          <button className="underline" onClick={() => void load()}>
            Thử lại
          </button>
        </p>
      )}
      {phase === "entry" && info && (
        <Entry
          info={info}
          onStarted={(warning) => {
            setFullscreenWarning(warning);
            loadStartedState();
          }}
        />
      )}
      {phase === "exam" && st && (
        <Exam
          st={st}
          fullscreenWarning={fullscreenWarning}
          onDone={(state, tabSwitch) => {
            setSt(state);
            setTabSwitchNotice(tabSwitch);
            setPhase("done");
          }}
        />
      )}
      {phase === "done" && (
        <section className="candidate-done-card overflow-hidden rounded-2xl border border-slate-200 shadow-lg">
          {fullscreenExitError && (
            <p
              role="alert"
              className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"
            >
              {fullscreenExitError}
            </p>
          )}
          {tabSwitchNotice && (
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="tab-submit-notice"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
            >
              <div className="w-full max-w-md rounded-xl border-2 border-red-300 bg-white p-6 text-center shadow-2xl">
                <p className="mx-auto w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-800">
                  Vi phạm quy định thi
                </p>
                <h2
                  id="tab-submit-notice"
                  className="mt-3 text-lg font-bold text-red-800"
                >
                  Bài thi đã được nộp tự động
                </h2>
                <p className="mt-2 text-red-800">
                  Bạn đã chuyển sang tab khác nên hệ thống đã tự động nộp bài.
                </p>
                <button
                  autoFocus
                  onClick={() => setTabSwitchNotice(false)}
                  className="mt-5 rounded-md bg-[#294075] px-5 py-2 font-semibold text-white transition-colors hover:bg-[#172554] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294075] focus-visible:ring-offset-2"
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          )}
          <div className="candidate-done-banner relative overflow-hidden px-6 py-7 text-center text-white sm:px-10 sm:py-9">
  {/* Hiệu ứng trang trí */}
  <div
    aria-hidden="true"
    className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10"
  />
  <div
    aria-hidden="true"
    className="absolute -bottom-16 left-8 h-36 w-36 rounded-full bg-white/5"
  />

  <div className="relative flex flex-col items-center">
    {/* Trạng thái nộp bài */}
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
      NỘP BÀI THÀNH CÔNG
    </p>

    {/* Lời cảm ơn */}
    <h2 className="mt-3 text-2xl font-bold leading-snug sm:text-3xl">
      Cảm ơn{" "}
      <span className="font-extrabold text-white">
        {submission?.candidateName || "bạn"}
      </span>{" "}
      đã tham gia
    </h2>

    {/* Tên kỳ thi */}
    {info?.title && (
      <p className="mt-2 text-sm text-blue-100 sm:text-base">
        {info.title}
      </p>
    )}

    {/* Badge mã đề */}
    {submission?.formNo && (
      <div className="mt-5 inline-flex items-center gap-3 rounded-xl border border-white/25 bg-white/10 px-5 py-2.5 shadow-sm backdrop-blur-sm">
        <span className="text-xs font-medium uppercase tracking-wider text-blue-100">
          Mã đề
        </span>

        <span className="h-5 w-px bg-white/30" />

        <span className="text-base font-extrabold tracking-wide text-white">
          Đề {submission.formNo}
        </span>
      </div>
    )}
  </div>
</div>
          <div className="candidate-done-body px-4 py-3 sm:px-6 sm:py-5">
            <section
              className="candidate-done-answers rounded-xl border border-slate-200 p-4 sm:p-5"
              aria-labelledby="submission-answers-title"
            >
              <h3
                id="submission-answers-title"
                className="text-base font-bold text-[#172554]"
              >
                Đáp án đã nộp
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Bài làm đã lưu trên máy chủ theo thứ tự câu của bạn, gồm lựa chọn trắc nghiệm và nội dung tự luận. Đây không phải đáp án đúng.
              </p>
              {submissionLoading && (
                <p role="status" className="mt-3 text-sm text-slate-600">
                  Đang tải bài làm đã lưu…
                </p>
              )}
              {submissionError && (
                <div role="alert" className="mt-3 text-sm text-red-700">
                  Không tải được bài làm: {submissionError}{" "}
                  <button
                    type="button"
                    className="font-semibold underline"
                    onClick={() => setSubmissionRefresh((value) => value + 1)}
                  >
                    Thử lại
                  </button>
                </div>
              )}
              {!submissionLoading && !submissionError && submission && (
                <ol className="candidate-done-answer-list mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {submission.answers.map((answer) => (
                    <li
                      key={answer.number}
                      className={'candidate-done-answer-item min-w-0 border px-3 py-2 ' + (answer.essayResponse?.trim() ? 'candidate-done-essay-item col-span-full' : 'flex items-center justify-between gap-2')}
                    >
                      <span className="font-semibold text-slate-700">Câu {answer.number}</span>
                      {answer.essayResponse?.trim() ? (
                        <p className="mt-2 whitespace-pre-wrap break-words text-slate-800">{answer.essayResponse}</p>
                      ) : (
                        <span className={'candidate-done-option ' + (answer.selectedOptions.length ? '' : 'candidate-done-option-empty')}>
                          {answer.selectedOptions.length
                            ? answer.selectedOptions.map((option) => option.toUpperCase()).join(', ')
                            : 'Bỏ trống'}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {/* <p className="mt-4 text-sm text-slate-600">File PDF chỉ chứa câu hỏi và lựa chọn/bài làm của bạn, không có đáp án chuẩn.</p> */}
            {exportError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {exportError}
              </p>
            )}
            {resetError && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {resetError}
              </p>
            )}
            <div className="candidate-done-actions">
              <button
                disabled={resetBusy}
                onClick={() => void returnHome()}
                className="candidate-done-home inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294075] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />
                </svg>
                {resetBusy ? "Đang quay lại…" : "Quay lại trang chủ"}
              </button>
            </div>
          </div>
        </section>
      )}
    </Shell>
  );
}
