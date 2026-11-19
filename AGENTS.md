# Hướng dẫn AI Coding Agent

## Mục tiêu dự án

Đây là ứng dụng thi nội bộ bằng tiếng Việt cho Tân Minh Nhân. Frontend cung cấp trang thí sinh và trang quản trị; API chạy dưới Vercel Functions; dữ liệu, chấm điểm và các chuyển trạng thái quan trọng nằm trong Prisma Postgres.

Khi README và source không khớp, ưu tiên source hiện tại cùng migration mới nhất. `README.md` đang có một số nội dung cũ; các sai khác đã biết được ghi trong `PROJECT_HANDOFF.md`.

## Công nghệ và phiên bản đã xác minh

Các phiên bản dưới đây là những gì `npm ls --depth=0` báo trong workspace tại lần lập tài liệu này. `package.json` và `package-lock.json` là nguồn quản lý phụ thuộc.

| Thành phần | Phiên bản hiện có |
|---|---:|
| React / React DOM | 18.3.1 |
| Vite | 6.4.4 |
| TypeScript | 5.9.3 |
| Tailwind CSS / `@tailwindcss/vite` | 4.3.3 |
| `@vitejs/plugin-react` | 4.7.0 |
| `@vercel/node` | 3.2.29 |
| `@prisma/client` / `prisma` | 6.19.2 / 6.19.2 |
| Zod | 3.25.76 |
| Vitest | 2.1.9 |
| ExcelJS / Mammoth | 4.4.0 / 1.13.0 |
| PDFKit / Archiver / docx | 0.20.2 / 8.0.0 / 9.13.0 |
| Tinos (`@fontsource/tinos`) | 5.3.0 |

Node.js version và Prisma Postgres version không được pin trong manifest; xác minh runtime thực tế trước khi nâng cấp hoặc triển khai.

## Kiến trúc và cấu trúc thư mục

- `src/main.tsx`: chọn trang quản trị khi URL hash là `#/admin`, nếu không hiển thị trang thi.
- `src/App.tsx`: luồng thí sinh, bắt đầu/tiếp tục/nộp bài và khôi phục bản nháp.
- `src/AdminPanel.tsx`: đăng nhập và các tab quản trị (tổng quan, tiến độ dự thi, cấu hình, email, câu hỏi, chấm tự luận, thống kê, hồ sơ kết quả).
- `src/api.ts`: client gọi `/api/*`, xử lý lỗi JSON và định dạng thời gian.
- `src/ui.tsx`: hộp thoại xác nhận và toast dùng chung.
- `src/index.css`, `src/admin.css`: Tailwind và kiểu giao diện; `admin.css` tập trung vào giao diện quản trị.
- `src/utils/`: helper thuần dùng chung phía frontend.
- `api/exam/[action].ts`: Vercel Function cho các hành động thí sinh.
- `api/admin/[action].ts`: Vercel Function cho các hành động quản trị; nhiều endpoint cùng được phân luồng theo `action`.
- `api/_lib/`: client/server helpers, parse dữ liệu import, chấm điểm, dashboard, workbook, PDF, ZIP và các unit tests.
- `prisma/migrations/`: thay đổi schema/RPC theo thứ tự số; hiện có `001`–`025`.
- `public/`: tài nguyên tĩnh như logo/favicon.
- `loadtest/`: kịch bản k6. `participants.local.txt` là file cục bộ bị ignore; không đọc, chia sẻ hoặc đưa nội dung vào tài liệu.
- `.agents/skills/`, `.github/prompts/`, `skills-lock.json`: hướng dẫn/skill cho agent, không phải runtime của ứng dụng.
- `dist/`, `node_modules/`, `.vercel/`: artefact/dependency/deployment output; không sửa tay.

## Cài đặt, chạy, build và test

1. Cài phụ thuộc bằng `npm install`.
2. Tạo Prisma Postgres riêng cho dev/staging. Chạy `npx prisma migrate deploy` để áp dụng đủ 25 migration trong `prisma/migrations/` trên database mới.
3. Nếu chưa có `.env.local`, trên PowerShell tạo từ mẫu bằng `Copy-Item .env.example .env.local`; điền các biến cần thiết trực tiếp trong môi trường cục bộ. Tên biến được dùng: `DATABASE_URL`, `ADMIN_PASSWORD`, `ADMIN_AUTH_SECRET`, `APP_ORIGIN`. Không ghi giá trị vào tài liệu hoặc commit.
4. Chạy `npx vercel dev` để chạy cả frontend và Vercel Functions. `npm run dev` chỉ chạy Vite; không giả định nó cung cấp các API backend. Cấu hình `APP_ORIGIN` cho local theo README và Vercel CLI đang dùng.
5. Kiểm tra:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`

`npm run build` chạy TypeScript (`tsc --noEmit`) rồi Vite. Vitest tìm test trong `api/**/*.test.ts` và `src/**/*.test.ts`. Hiện chưa có script lint/format riêng trong `package.json`.

## API quan trọng

Các URL là cùng origin với frontend. Handler từ chối action hoặc HTTP method không được hỗ trợ; mọi admin action ngoại trừ đăng nhập cần cookie quản trị hợp lệ.

**Thí sinh — `/api/exam/:action`:**

- `GET info`, `POST start`
- `GET state`, `PUT answer`, `PUT answers`
- `POST submit`, `POST reset`
- `GET review-pdf`, `GET export`

**Quản trị — `/api/admin/:action`:**

- Đăng nhập: `POST login`.
- Đọc: `GET settings`, `overview`, `participation`, `participants`, `questions`, `participant-template`, `projects`, `dashboard`, `grading`, `export`, `template`; luồng SSE riêng `GET /api/admin/stream/participation`.
- Ghi: `PUT settings`, `POST participants`, `POST participants-import`, `POST import`, `POST grade-essay-attempt`, `POST reconcile`, `POST clear-results`, `POST projects`, `PUT projects`, `DELETE projects`.

Tham khảo handler để biết chính xác schema/request limits. `api/_lib/server.ts` thiết lập Prisma Client, request ID, body limit, `no-store` và kiểm tra same-origin cho request ghi.

## Database và nghiệp vụ

Các bảng nền trong migration 001:

- `exam_settings`: cấu hình singleton, `id=1`.
- `exam_questions` và `question_keys`: ngân hàng câu hỏi và đáp án; key liên kết một-một, xóa theo câu hỏi.
- `exam_attempts`: lượt thi; giữ trạng thái, thời hạn, thông tin thí sinh và ảnh chụp cấu hình chấm ở thời điểm bắt đầu.
- `exam_answers`: đáp án theo lượt/câu; khóa chính ghép `(attempt_id, question_id)`.
- `exam_events`: sự kiện gắn với lượt thi.
- `invitation_codes`: dữ liệu mã mời.
- `rate_limits`: cửa sổ giới hạn tần suất, khóa ghép `(key, window_start)`.

Migration sau bổ sung `exam_projects`, `participant_email_allowlist`, loại câu hỏi/đáp án, trường điểm, chấm tự luận, batch lưu đáp án, dữ liệu xuất và `bank_order`. `exam_attempts.project_id` tham chiếu công trình với `ON DELETE RESTRICT`; bảng câu trả lời/sự kiện được cascade theo lượt thi. Prisma Postgres không dùng các role/RLS của Supabase; API dùng database credential server-only nên kiểm tra quyền ở handler là bắt buộc.

## Quy tắc không được phá vỡ

- Không đưa `correct_options` hoặc `reference_answer` vào API thí sinh. Chỉ truy vấn đáp án trong nhánh admin đã xác thực hoặc quy trình server-side cần thiết.
- Không đưa `DATABASE_URL`, mật khẩu hoặc secret vào biến `VITE_*`, frontend, log, commit hay tài liệu. `.env*` là cấu hình local; chỉ `.env.example` được chia sẻ.
- Giữ cookie lượt thi `HttpOnly` và cookie admin đã ký; không thay bằng token trong `localStorage`. Mọi write API phải giữ kiểm tra same-origin, xác thực, giới hạn body, validation và rate limit phù hợp.
- Không thay logic giao dịch trong RPC bắt đầu/lưu/nộp/chốt bài nếu chưa kiểm thử race condition, timeout và tính lặp an toàn. Hạn nộp bị chặn bởi thời lượng lượt thi và thời điểm đóng kỳ thi.
- Mỗi email công ty chỉ được bắt đầu một lượt; email phải thuộc allowlist và miền công ty; allowlist giới hạn tối đa 199 email.
- Đề được chọn ngẫu nhiên theo cấu hình; câu tự luận ở cuối; ngân hàng thiếu số câu đang hoạt động thì không được bắt đầu. Câu nhiều đáp án chỉ đúng khi khớp toàn bộ đáp án chuẩn.
- Điểm theo cấu hình được snapshot theo lượt thi; trắc nghiệm chấm tự động, tự luận do admin chấm. Không làm thay đổi kết quả lịch sử khi cấu hình mới được lưu.
- Import câu hỏi bị khóa khi đã tồn tại lượt thi. `024_question_bank_order.sql` thêm thứ tự ngân hàng; import RPC phải tiếp tục ghi `bank_order` theo thứ tự phần tử trong file.
- Xóa kết quả là thao tác phá hủy dữ liệu; chỉ chạy theo xác nhận và điều kiện trong API. Không chạy SQL dọn dữ liệu hoặc k6 trên production.
- `vercel.json` đặt CSP và security headers; chỉ thay đổi CSP khi hiểu tác động tới script/assets và kiểm tra deployment thực tế.
- Migration đã áp dụng không được sửa lại; thêm migration mới đánh số tiếp theo và kiểm tra đường nâng cấp từ schema hiện hành.
- Prisma Migrate quản lý SQL trong `prisma/migrations/`; không dùng `prisma db push` hoặc `prisma migrate reset` trên database có dữ liệu. `prisma/schema.prisma` hiện chỉ chứa model tối thiểu để sinh client; kiểm tra drift trước khi dùng `prisma migrate dev`.

## Phong cách và quy trình thay đổi

- TypeScript strict, ES modules; React function components/hooks. Component đặt `PascalCase`, biến/hàm `camelCase`, cột DB `snake_case`.
- Giữ style hiện có: dấu nháy đơn trong TypeScript, Tailwind utility classes và CSS dùng chung; thay đổi nhỏ, theo đúng pattern ở file lân cận.
- API input cần validate bằng Zod hoặc helper hiện có; lỗi DB/API phải được xử lý rõ, không trả fallback thành công.
- Ưu tiên helper hiện có trong `api/_lib/`; thêm test tập trung cạnh helper tương ứng trong `api/_lib/*.test.ts`.
- Trước khi sửa luồng thí sinh/admin, lần theo UI → action API → RPC/migration. Không giả định README là bản mô tả hoàn toàn mới.
- Không tự ý thay đổi hành vi thi, schema, retention dữ liệu, export, xác thực hoặc quy tắc bảo vệ bài thi khi yêu cầu chỉ là chỉnh giao diện.
- Giữ nguyên thay đổi chưa commit trong worktree; kiểm tra `git status` trước thao tác lớn. Đọc `PROJECT_HANDOFF.md` để biết trạng thái hiện tại.

## Triển khai

- Dùng database Prisma Postgres tách biệt cho dev/staging/production; áp dụng migration đúng thứ tự trên đúng project trước khi deploy code phụ thuộc schema/RPC đó.
- `APP_ORIGIN` chỉ gồm scheme + host, không path/hash/trailing slash; đổi environment variables trên Vercel cần redeploy.
- Chỉ chạy load test trên staging với email test mới, allowlist và cấu hình đề phù hợp. Các script k6 tự tạo lượt thi thật; operator phải xác minh `BASE`/`ORIGIN` là staging trước khi chạy.
- Sao lưu trước thao tác xóa; xác nhận export và quy trình lưu trữ dữ liệu theo chính sách nội bộ.
