# Bàn giao dự án

**Ngày lập:** 2026-11-16
**Branch/commit nền:** `main` / `a16bc43` (`Add participant status monitoring and filters`)
**Phạm vi kiểm tra:** source frontend/API, migration, test, cấu hình build/deploy và tài liệu hiện có. Không truy cập giá trị trong file môi trường local, không kết nối Supabase/Vercel production.

## Tóm tắt trạng thái

Đây là cổng thi nội bộ chạy React/Vite trên Vercel, dùng Supabase Postgres cho cấu hình, ngân hàng câu hỏi, lượt thi và kết quả. Nhiều chức năng đã có trong source và unit test; trạng thái production, cấu hình môi trường thật và migration đã chạy ở các project Supabase **chưa được xác minh**.

Tại lần kiểm tra này:

- `npm run build`: thành công.
- `npm test`: 36 test / 9 file thành công ở lần chạy gần nhất.
- Không tìm thấy test tích hợp API handler với Supabase hoặc end-to-end qua trình duyệt.
- Không xác minh kết nối database, đăng nhập thật, triển khai Vercel hoặc kết quả chạy k6.

## Chức năng đã xác minh trong source

### Thí sinh

- Ứng dụng tại `src/App.tsx` thu thập hồ sơ, xác nhận nội quy, bắt đầu bài thi, lưu/khôi phục bản nháp, gửi đáp án theo lô, nộp bài và xem trạng thái sau nộp.
- Cookie lượt thi do API quản lý; trạng thái bài thi/kết quả lưu phía server/DB. Client khôi phục đáp án chưa đồng bộ bằng `localStorage`.
- Trang thi yêu cầu fullscreen khi bắt đầu. Bảo vệ chuyển tab mặc định bật ở client; `Ctrl+Shift+F8` có thể tắt bảo vệ riêng ở lượt đó. Đây không phải trạng thái global được lưu trong cấu hình admin.
- Trắc nghiệm được chấm tự động; tự luận chờ admin chấm. Thí sinh có thể tải PDF đối chiếu trong điều kiện API cho phép.

### Admin

- Trang `#/admin` có đăng nhập và sidebar gồm Tổng quan, Tiến độ dự thi, Cấu hình, Danh sách email, Câu hỏi, Chấm tự luận, Bài làm & thống kê, Hồ sơ kết quả.
- Tổng quan hiển thị lịch/thời lượng/trạng thái kỳ thi, mức sẵn sàng của câu hỏi và danh sách email, tiến độ tham gia tóm tắt, việc cần làm và tóm tắt kết quả.
- Tab Tiến độ dự thi có danh sách chi tiết trạng thái theo email, lọc và phân trang; tab Danh sách email quản lý allowlist riêng.
- Tab Câu hỏi có khối nhập Excel/Word, xem trước lỗi trước khi lưu, và ngân hàng câu hỏi hiện đáp án đúng/đáp án tham khảo.
- Cấu hình hỗ trợ lịch, số câu từng loại, điểm, điểm đạt, kiểu hiển thị, bật/tắt kỳ thi; quản lý danh mục công trình.
- Có chấm tự luận, dashboard thống kê, tải hồ sơ ZIP (Excel + PDF) và thao tác xóa dữ liệu theo điều kiện.

### Backend và vận hành

- Hai route handler chính: `api/exam/[action].ts` và `api/admin/[action].ts`.
- API có auth cookie, kiểm tra same-origin cho write, giới hạn body/rate limit tại các luồng cần thiết; database access dùng service role.
- Migration chain có 24 file, `001`–`024`. Migration `024_question_bank_order.sql` bổ sung `exam_questions.bank_order`; API đọc ngân hàng và import RPC hiện phụ thuộc cột này.
- Kịch bản load test có `loadtest/k6.js` và `loadtest/k6-core-flows.js`; cả hai tạo lượt thi thật và chỉ được chạy trên staging.
- `api/_lib/` có 36 unit tests hiện tại cho helper import, scoring, dashboard, workbook, PDF, ZIP, participant import và một số logic thuần.

## Đang phát triển và chưa triển khai

- Không thể xác định từ source một task đang được tác giả chủ động làm dở. Các thay đổi trong worktree có code triển khai nhưng chưa commit; mức hoàn tất end-to-end/triển khai của chúng chưa được xác minh.
- Chưa có test tích hợp handler ↔ Supabase hoặc browser E2E trong bộ test đã kiểm tra.
- Không thấy một cài đặt global cho chế độ thử; chế độ thử hiện là toggle theo từng lượt ở client. Nếu cần quản trị chế độ toàn kỳ thi, cần yêu cầu riêng và thiết kế API/DB trước khi triển khai.
- Theo luồng hiện tại, danh sách tiến độ tải khi mở tab hoặc bấm làm mới; không thấy cơ chế realtime/polling tự động. Chưa xác minh đây có phải yêu cầu sản phẩm hay không.
- Không thể xác nhận tính năng nào đã deploy hoặc migration nào đã chạy trên môi trường thật.

## Thay đổi gần đây trong worktree

Các thay đổi đang có trong worktree, chưa được commit tại thời điểm kiểm tra:

- Admin UX: sidebar, tab riêng cho tiến độ, tổng quan readiness/việc cần làm, phân trang bảng dài, danh sách câu hỏi/đáp án, logo lớn hơn và bỏ topbar.
- Admin API: participation/overview/question-bank actions và participant import code.
- Database: migration `024_question_bank_order.sql` để giữ thứ tự câu hỏi khi import.
- Load test: `k6-core-flows.js` và thay đổi trong `k6.js`.
- Contributor assets: `.agents/skills/`, `.github/prompts/`, `skills-lock.json`.
- Các file đang modified/untracked còn gồm `.gitignore`, `README.md`, `api/admin/[action].ts`, `src/AdminPanel.tsx`, `src/admin.css`, module/test participant import và các file nêu trên.

Không giả định mọi thay đổi này được tạo trong cùng một lượt làm việc. **Không reset, checkout hoặc xóa các thay đổi chưa commit để làm sạch worktree.** Hai file handoff này là file mới được thêm theo yêu cầu hiện tại.

## Đang chờ xác nhận / chưa thể xác minh

1. **Migration 024 chưa được xác nhận đã chạy trên bất kỳ Supabase project nào.** Nếu chưa chạy, API `GET /api/admin/questions` sẽ truy vấn cột `bank_order` chưa tồn tại. Xác minh từng môi trường trước khi deploy.
2. Backfill ở migration 024 sắp thứ tự dữ liệu cũ theo `created_at` và `ctid`; không thể đảm bảo khôi phục chính xác thứ tự file gốc cho dữ liệu cũ. Import mới có ghi thứ tự theo mảng đầu vào. Nếu cần chuẩn hóa thứ tự cũ, xem xét re-import file nguồn sau khi xác nhận điều kiện khóa import.
3. Chưa xác minh `.env`/`.env.local`, giá trị secrets, kết nối staging/production, migration history thực tế, backups hoặc Vercel environment.
4. Không chạy browser E2E; trạng thái UI/API được xác minh bằng source, build và unit tests.
5. Chế độ “Chính thức” trong tổng quan mô tả cơ chế bảo vệ mặc định. Chế độ thử có thể bật riêng từng lượt qua `Ctrl+Shift+F8`; không có cài đặt global được xác minh trong admin settings.

## Lỗi đã biết và sai khác tài liệu

- Không có lỗi build/unit test được phát hiện trong lần kiểm tra này.
- README hiện có nội dung cũ so với source: danh sách tab admin và cấu hình/import được mô tả theo giao diện cũ; hướng dẫn migration dừng ở `023_numeric_essay_grading.sql` trong khi source có migration 024.
- README nói sự kiện `blur` được xác nhận sau 300 ms; handler hiện tại trong `src/App.tsx` gọi nộp ngay khi bảo vệ bật. Đây là sai khác cần xác minh và cập nhật tài liệu hoặc behavior, không tự đoán ý định.
- README mô tả `EMAIL_FILE` của kịch bản k6 theo đường dẫn tương đối trong `loadtest/`; script chuyển giá trị sang `open()` của k6. Xác minh working directory trước khi dùng hướng dẫn.
- `supabase/seed_example_questions.sql` tự ghi “EXAMPLE ONLY”, chèn 50 câu mẫu và đáp án `"a"` cho từng câu. File không giới hạn bằng cơ chế môi trường; không chạy trên database kỳ thi thật nếu chưa thay dữ liệu.
- Các test hiện là unit tests helper; authorization boundary, RPC transaction và API route chưa được xác minh end-to-end.
- `vercel.json` chứa CSP với hash script cố định. Thay đổi script/header có thể làm frontend bị chặn và cần kiểm thử deployment.

## Ưu tiên tiếp theo cho AI Coding Agent

1. Kiểm tra `git status` và giữ nguyên mọi thay đổi chưa commit; đọc `AGENTS.md` trước khi sửa code.
2. Xác nhận migration 024 đã chạy ở dev/staging; kiểm tra `GET /api/admin/overview`, `GET /api/admin/questions` và import/append/replace với database thử nghiệm.
3. Trước khi áp dụng migration 024 lên production, backup và xác minh migration history. Không sử dụng seed mẫu trên production.
4. Đồng bộ `README.md` với tabs, routes, migration 024, anti-focus behavior và cách dùng k6; đây là việc cần làm riêng, không được thay đổi README trong lúc tạo tài liệu handoff này.
5. Bổ sung integration tests cho auth/admin-only data, start/submit/timeout, khóa import, order bank và export/clear-results trước các thay đổi nghiệp vụ quan trọng.
6. Chỉ chạy k6 sau khi xác nhận `BASE`/`ORIGIN` là staging, có email test mới và ngân hàng/cấu hình đã đủ; không chạy production.

## Cách tiếp tục an toàn

- Dùng `AGENTS.md` làm quy tắc lâu dài; tài liệu này chỉ ghi nhận snapshot của worktree ngày 2026-11-16.
- Source và migration mới nhất là căn cứ cho behavior hiện tại; đánh dấu rõ mọi giả định chưa xác minh.
- Không chia sẻ nội dung `.env`, `.env.local` hoặc `loadtest/participants.local.txt`; các giá trị này đã không được đưa vào handoff.
- Với sửa đổi UI, giữ nguyên API/business behavior. Với sửa đổi API/DB, kiểm tra auth, validation, transaction, thứ tự migration và dữ liệu lịch sử.
