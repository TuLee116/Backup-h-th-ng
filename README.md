# Hệ thống thi trắc nghiệm trực tuyến an toàn

React + Vite + Tailwind (frontend) · Vercel Functions (API) · Prisma Client + Prisma Postgres (dữ liệu, chấm điểm, khoá giao dịch). Xem [quy trình chuyển dữ liệu](PRISMA_POSTGRES_MIGRATION.md) trước khi cấu hình database.

## 1. Chạy cục bộ
1. `npm install`
2. Tạo database Prisma Postgres **dev**; chạy đủ 25 migration trong `prisma/migrations/` bằng `npx prisma migrate deploy` theo [quy trình chuyển dữ liệu](PRISMA_POSTGRES_MIGRATION.md).
3. Sao chép `.env.example` thành `.env.local`; điền `DATABASE_URL` và các bí mật server (không bao giờ dùng tiền tố `VITE_`). Chạy `npm run db:generate` và `npm run db:verify`.
4. `npx vercel dev` (cần `APP_ORIGIN=http://localhost:3000`).

Admin và thí sinh dùng chung một website/domain. Trên Vercel, đặt `APP_ORIGIN` thành origin mà thí sinh mở, ví dụ `https://ten-mien.vercel.app` (chỉ giao thức + domain, không có dấu `/` cuối, path hoặc `#/admin`). Trang admin là cùng trang đó với hash `/#/admin`; không cần tạo domain admin riêng. API chấp nhận origin cấu hình hoặc origin khớp chính xác host hiện tại do Vercel chuyển tiếp, và từ chối domain khác. Nếu dùng nhiều domain chính thức, có thể khai báo danh sách origin cách nhau bằng dấu phẩy. Thay đổi biến môi trường Vercel cần redeploy để có hiệu lực.

## 2. Cấu hình kỳ thi (không hardcode)
Vào `#/admin` (giao diện chia tab Cấu hình / Mã mời / Câu hỏi / Kết quả), tab **Cấu hình** để đặt tiêu đề, thời gian bắt đầu/kết thúc (giờ Việt Nam), thời lượng, số câu trắc nghiệm và số câu tự luận riêng (mỗi loại có thể đặt 0; tổng phải từ 1 đến 1.000), **điểm mỗi câu trắc nghiệm**, **điểm mỗi câu tự luận** và **điểm đạt**. Điểm từng loại áp dụng đồng đều cho mọi câu cùng loại; tổng điểm tối đa được tính từ số câu thực tế của đề và điểm mỗi câu. Điểm đạt phải nằm trong khoảng 0 đến tổng điểm tối đa. Mặc định là 18 câu trắc nghiệm, 1 câu tự luận; mỗi câu 0,5 điểm và đạt từ 7 điểm. Điểm bài thi hiển thị theo thang điểm cấu hình; dashboard phân tích tiếp tục chuẩn hóa về thang 10. Có thể đặt **cách hiển thị bài làm** (từng câu một hoặc hiện tất cả câu cùng lúc) và bật/tắt: mở kỳ thi, yêu cầu mã mời, hiện điểm. Tại **Danh sách công trình**, có thể thêm, ẩn/kích hoạt hoặc xóa công trình chưa từng được dùng. Công trình đã gắn với bài thi cũ chỉ có thể ẩn, không xóa, để giữ lịch sử và thống kê. Danh sách dài có thanh cuộn riêng. Logo dùng mặc định `/logo.png`, không cấu hình trong giao diện. Bấm **Lưu cấu hình**. Tắt "Mở kỳ thi" để đóng ngay lập tức. Mọi xác nhận/thông báo dùng hộp thoại và toast của ứng dụng, không dùng hộp thoại mặc định của trình duyệt.
(Có thể sửa trực tiếp bảng `exam_settings` trong Prisma Postgres nếu cần.)
Thay `public/logo.png` bằng logo công ty nếu cần.
Hạn nộp = `LEAST(giờ bắt đầu theo server + duration, closing_at)`, tính trong DB (`start_attempt`).

Trong tab **Kết quả**, dashboard thống kê các bài đã nộp (không tính bài đang làm), có thể lọc theo công trình, cấp bậc và khoảng điểm trên thang 10. Chỉ số vi phạm chuyển tab luôn hiển thị số lượt vi phạm trên tổng số lượt đã nộp và tỷ lệ tương ứng, không phụ thuộc các bộ lọc hay kết quả đậu/rớt. Biểu đồ vòng thể hiện tỷ lệ đạt/không đạt; biểu đồ cột thể hiện phân bố điểm; biểu đồ thanh so sánh tỷ lệ đạt theo công trình hoặc cấp bậc. Điểm trung bình được tính từ phần trắc nghiệm đã chấm tự động; bài chưa có kết quả được thống kê riêng.

## 3. Câu hỏi
Mỗi câu có loại `single` (một đáp án), `multiple` (chọn nhiều đáp án, phải khớp chính xác toàn bộ đáp án đúng) hoặc `essay` (tự luận chấm thủ công trong trang quản trị). Điểm mỗi câu trắc nghiệm và mức điểm tối đa mỗi câu tự luận được đặt trong cấu hình; điểm trắc nghiệm được cộng khi chọn đúng toàn bộ, còn người chấm nhập điểm riêng cho từng bài tự luận từ 0 đến mức tối đa. Điểm đạt được cấu hình theo tổng điểm tối đa của đề. Mỗi lượt thi lưu ảnh chụp cấu hình điểm tại thời điểm bắt đầu để thay đổi cấu hình không làm thay đổi kết quả lượt đang làm hoặc lịch sử. Hệ thống chọn ngẫu nhiên đúng số câu đã cấu hình theo từng loại; ngân hàng không đủ câu thì không cho bắt đầu thi. Câu tự luận luôn được xếp cuối đề. Cần ít nhất một câu hoạt động để bắt đầu thi. Đáp án và đáp án tham khảo chỉ được admin truy cập, không gửi cho trình duyệt thí sinh.
Cần có đủ số câu đang hoạt động theo cấu hình của từng loại; nếu thiếu, hệ thống không cho bắt đầu thi. Không dùng câu hỏi mẫu trong kỳ thi thật.

### Nhập danh sách email và câu hỏi
Mẫu danh sách email gồm các cột **Số thứ tự**, **Họ và tên** (có thể để trống) và **Email công ty**. STT phải liên tục từ 1; email phải thuộc miền `@tanminhnhan.com.vn`. Tệp Excel danh sách tối đa 199 email.

### Nhập câu hỏi bằng Excel hoặc Word (trang `#/admin`)
Trong mục "Nhập câu hỏi từ tệp": chọn **Excel** hoặc **Word**, chọn *Thay thế* hoặc *Thêm vào*, tải tệp mẫu, điền câu hỏi, bấm **Kiểm tra tệp** (xem trước + lỗi theo dòng/câu), rồi **Lưu vào hệ thống**.
- Excel: A câu hỏi, B–G lựa chọn A–F, H đáp án đúng (`A` hoặc `A,C`), I loại (`single`, `multiple`, `essay`), J điểm (không dùng; điểm đặt trong cấu hình), K đáp án tham khảo cho tự luận. I mặc định `single`. Câu tự luận bỏ trống B–H và cần đáp án tham khảo. Chỉ đọc sheet đầu tiên.
- Word: bắt đầu câu bằng `1. Nội dung`; thêm `Loại: single|multiple|essay`; lựa chọn dùng `A. …`; đáp án trắc nghiệm dùng `Đáp án: A,C`; câu tự luận dùng `Đáp án tham khảo: ...`. Loại mặc định là `single`. Câu/đáp án có thể xuống dòng. Hình ảnh, bảng, công thức không được đọc.
- Việc nhập bị **khoá khi đã có bất kỳ bài thi nào** (kể cả thi thử): xoá thi thử bằng `delete from exam_attempts;` rồi nhập lại.
- Chỉ lưu khi toàn bộ tệp hợp lệ; việc lưu là một giao dịch DB duy nhất.

Người dự thi bắt buộc nhập họ tên, email công ty có đuôi `@tanminhnhan.com.vn`, chức danh/vị trí, cấp bậc và chọn công trình chính trong danh mục; trước khi bắt đầu cần xác nhận đã đọc và đồng ý tuân thủ nội quy. Giao diện và API đều kiểm tra miền email và công trình. Mỗi email chỉ được bắt đầu một lượt thi; hệ thống khóa kiểm tra này trong giao dịch DB để ngăn yêu cầu đồng thời dùng cùng địa chỉ. Khi thí sinh bấm bắt đầu, ứng dụng yêu cầu trình duyệt mở toàn màn hình; nếu không bật được, có thể nhấn F11. Khi cửa sổ mất focus hoặc trang thi bị ẩn trong lúc bật chế độ chống chuyển tab, bài thi tự động nộp. Nếu cấu hình bật **Hiện điểm**, điểm bài thi theo cấu hình được hiển thị sau khi nộp; nếu tắt, thí sinh thấy lời cảm ơn kèm tiêu đề bài kiểm tra. Sau khi nộp, thí sinh có thể tải PDF bài làm của mình, gồm nội dung câu hỏi, điểm tối đa từng câu và lựa chọn/bài làm đã nộp, không kèm đáp án chuẩn. Tất cả PDF bài làm/hồ sơ có logo công ty ở góc trên trái; nếu bài bị nộp tự động do chuyển tab, PDF ghi rõ vi phạm ở góc trên phải. Trong khi thi, đáp án hiển thị ngay và được giữ thành bản nháp trong `localStorage`; hệ thống gửi lô tối đa 5 câu khi đủ thay đổi hoặc sau 120 giây kể từ thay đổi đầu tiên chưa đồng bộ. Khi nộp, các đáp án chưa đồng bộ phải được server xác nhận trước khi chốt bài; DB mới là nguồn dữ liệu chính thức. Câu tự luận được chấm trong tab **Chấm tự luận** của trang quản trị: admin nhập điểm riêng cho từng bài trong khoảng 0 đến điểm tối đa đã cấu hình rồi lưu để cập nhật tổng điểm.
Trong tab **Danh sách email**, admin có thể xem ai chưa bắt đầu, ai đang làm/quá hạn chưa chốt và ai đã nộp (kể cả tự nộp). Trạng thái chỉ tải khi mở trang hoặc bấm **Làm mới**, không dùng cập nhật realtime.

## 4. Mã mời (mã dùng chung)
Mở `https://<app>/#/admin`, mục **Mã mời dùng chung**: nhập **số người được dùng mã** (ví dụ 300) rồi bấm "Tạo mã mới". Hệ thống tạo **một mã duy nhất** cho tối đa 300 lượt thi; mỗi thí sinh vào thi thành công tốn một lượt. Mã chỉ hiển thị một lần; DB chỉ lưu HMAC. Panel hiển thị số lượt đã dùng / giới hạn.
Tạo mã mới sẽ **thu hồi mã cũ** (thí sinh đã thi bằng mã cũ không bị ảnh hưởng).
Nếu tắt mã mời (`invitation_required=false`) thì **không thể chống mạo danh/trùng lặp** chỉ bằng thông tin tự nhập.

## 5. Triển khai (Vercel)
1. Push lên Git, import vào Vercel (Framework: Vite).
2. Đặt biến môi trường như `.env.example` (Production ≠ Preview/Dev; dùng database Prisma Postgres riêng).
3. Với database mới, chạy `npx prisma migrate deploy` để áp dụng 25 migration. Với dữ liệu cũ, xem [quy trình chuyển dữ liệu](PRISMA_POSTGRES_MIGRATION.md) để restore và đánh dấu migration đã áp dụng; không chạy migration tạo bảng chồng lên schema đã restore. Chạy `npm run db:verify` trước khi chuyển traffic.
4. Kiểm tra: vào trang, thi thử bằng 1 mã, đăng nhập `#/admin`, tải ZIP hồ sơ.
5. Sao lưu bằng `pg_dump` và xác minh restore. Rollback cần đổi lại cả deployment và `DATABASE_URL` tương ứng; giữ nguồn cũ đến khi đối chiếu dữ liệu xong.

## 6. Chính sách vận hành
- Khi bảo vệ đang bật, chuyển tab/ẩn trang (`visibilitychange`) hoặc cửa sổ thi mất focus (`blur`) → nộp bài tự động; mất focus được xác nhận sau 300 ms để tránh sự kiện thoáng qua.  trạng thái được hiển thị rõ trên màn hình và không đổi cấu hình chung. Không sử dụng chế độ thử trong kỳ thi thật. Trang thi chặn chọn/copy/cut/paste, chuột phải và một số phím tắt ở mức trình duyệt. Đây chỉ là biện pháp cản trở: không thể ngăn chia đôi cùng cửa sổ, chụp ảnh màn hình, thiết bị khác hoặc người dùng vô hiệu hóa JavaScript; có thể nộp nhầm khi hệ điều hành làm cửa sổ mất focus, vì vậy cần thông báo trước.
- Tải lại trang: giữ nguyên thứ tự câu và hạn nộp (lưu trong DB, cookie httpOnly); đáp án chưa đồng bộ được khôi phục từ bản nháp `localStorage` theo mã lượt thi. Mỗi thay đổi cập nhật bản nháp ngay, gửi theo lô tối đa 5 câu khi đủ 5 câu thay đổi hoặc sau 120 giây kể từ thay đổi đầu tiên chưa đồng bộ; lỗi mạng thì giữ bản nháp và thử lại. Khi nộp, client chờ đồng bộ các đáp án còn lại trước khi yêu cầu server chốt bài. DB vẫn là nguồn dữ liệu chính thức. Quá hạn thì server tự chốt bằng các đáp án đã lưu khi bài được truy cập, hoặc khi bấm "Chốt các bài hết hạn" / tải Excel (tự chốt trước khi xuất).
- Không dùng cron (Vercel Hobby chỉ chạy 1 lần/ngày); luôn bấm "Chốt các bài hết hạn" sau 09:30.
- Tải kết quả tạo một file ZIP gồm workbook Excel và thư mục `pdfs/` với một phiếu PDF cho mỗi thí sinh đã nộp. Tên PDF theo dạng `0001_Ten_ThiSinh_Ten_CongTrinh.pdf` (số thứ tự ở đầu tên). Workbook có 5 sheet: **Kết quả** (mỗi thí sinh một dòng, gồm điểm trắc nghiệm, tự luận và tổng điểm theo cấu hình của lượt thi), **Kết quả tổng kết** (thông tin, thời gian, số câu đúng, tổng điểm chuẩn hóa trên thang 10 và xếp loại), **Kết quả tự luận** (bài làm, đáp án tham khảo, điểm đã chấm và điểm tối đa của từng câu), **Hồ sơ phúc khảo** (thông tin thí sinh và liên kết tới PDF tương ứng trong ZIP) và **Đáp án** (đáp án chuẩn và đáp án tham khảo). Phiếu PDF có thông tin/thời gian thi, điểm theo cấu hình lúc bắt đầu thi và từng câu hỏi; lựa chọn thí sinh đã chọn được tô xanh nếu đúng hoặc đỏ nếu sai. Nếu thí sinh trả lời sai hoặc chọn thiếu/thừa đáp án, PDF hiển thị thêm các chữ cái đáp án đúng ngay dưới các lựa chọn; câu trả lời đúng hoàn toàn không có dòng này. Phần tự luận chỉ hiển thị bài làm thí sinh. PDF dùng Tinos, phông serif tương thích Times New Roman, kết hợp các bộ ký tự Latin mở rộng và tiếng Việt (nội dung 13pt); đây không phải tệp Times New Roman thương mại. Chỉ admin tải được. Trang quản trị có lựa chọn tải và giữ dữ liệu hoặc tải rồi xóa các lượt thi đã hoàn tất cùng câu trả lời/sự kiện liên quan. Chức năng xóa chỉ chạy khi kỳ thi đã đóng hoặc chưa kích hoạt và không còn bài đang làm; ngân hàng câu hỏi, cấu hình và lượt dùng mã mời được giữ nguyên. Nên tải và lưu file ZIP an toàn trước khi xóa.
- Giới hạn: không chống được điện thoại/máy thứ hai, chụp màn hình, trình duyệt bị sửa, mạo danh khi không có mã mời. Với kỳ thi quan trọng cần giám thị.
- Dữ liệu cá nhân: dùng nút **Tải ZIP và xóa dữ liệu kết quả** sau kỳ thi theo chính sách lưu trữ của công ty; thao tác này cascade xóa đáp án/sự kiện nhưng không xóa ngân hàng câu hỏi, cấu hình hoặc lượt dùng mã mời.

## 7. Kiểm thử
`npm run typecheck && npm test && npm run build`.

### Load test với k6 (chỉ chạy trên staging)
Bảo đảm kỳ thi staging đang mở, ngân hàng có đủ số câu trắc nghiệm/tự luận theo cấu hình và công trình đã chọn đang hoạt động. Chuẩn bị một email test mới cho mỗi VU trong allowlist. Có thể đặt mỗi email một dòng trong `loadtest/participants.local.txt`; tệp này bị loại khỏi Git.
```powershell
k6 run -e BASE=https://staging.example.com -e ORIGIN=https://staging.example.com -e EMAIL_FILE=participants.local.txt -e PROJECT="KHU VỰC ĐÀ NẴNG" -e VUS=171 -e JITTER_SECONDS=20 .\loadtest\k6.js
```
Mỗi VU tạo và nộp một lượt thi; đáp án được gửi theo lô 5 câu. `VUS` tối đa 199. `EMAIL_FILE` được mở tương đối với thư mục `loadtest`; `PROJECT` phải khớp tên công trình đang hoạt động. `JITTER_SECONDS=0` tạo burst bắt đầu gần như đồng thời; đặt `20` để dàn lượt bắt đầu trong tối đa 20 giây. Để đồng bộ lượt bắt đầu và nộp, thêm `-e SYNC_START=true -e SYNC_LEAD_SECONDS=10 -e SUBMIT_AFTER_SECONDS=180`: VU chờ một mốc bắt đầu chung, làm bài, rồi chờ mốc nộp chung tính từ lúc bắt đầu. Kết quả có `start_request_offset_ms` và `submit_request_offset_ms` để xem độ lệch thời điểm gửi request; mạng và máy chạy k6 không thể đảm bảo request đến server cùng mili giây. Chọn thời gian nộp dài hơn thời gian làm và đồng bộ toàn bộ đáp án. Mỗi email chỉ thi được một lần, vì vậy không dùng lại email test nếu lượt thi đã được tạo. Không chạy trên production.

Kết quả k6 cũng báo riêng thời gian `start_duration_ms`, `state_duration_ms`, `answer_batch_duration_ms`, `soak_batch_duration_ms` và `submit_duration_ms` để xác định endpoint nào đang chậm; các chỉ số này gồm cả thời gian mạng từ máy chạy k6.

Để chỉ đo ba luồng bắt đầu, tải trạng thái và nộp bài (không gửi đáp án), chạy:
```powershell
k6 run `
  -e 'BASE=https://staging.example.com' `
  -e 'ORIGIN=https://staging.example.com' `
  -e 'EMAIL_FILE=participants.local.txt' `
  -e 'PROJECT=KHU VỰC ĐÀ NẴNG' `
  -e 'VUS=171' `
  -e 'SYNC_LEAD_SECONDS=10' `
  -e 'SUBMIT_AFTER_SECONDS=30' `
  .\loadtest\k6-core-flows.js
```
Kịch bản đồng bộ thời điểm bắt đầu và nộp, hiển thị riêng thời gian từng API, và tạo lượt thi thật trên staging nhưng không lưu câu trả lời. Cần 171 email test mới, chưa sử dụng và có trong allowlist. Các ngưỡng thời gian kế thừa mục tiêu p95 < 800 ms, p99 < 2 giây; vượt ngưỡng sẽ làm k6 kết thúc với trạng thái lỗi dù request vẫn thành công. Không chạy trên production.

Để chạy soak 25 phút với 171 VU, bắt đầu đồng loạt, gửi lô 5 đáp án định kỳ khoảng 120 giây (được dàn tối đa 30 giây) và nộp đồng loạt cuối bài, dùng:
```powershell
k6 run -e BASE=https://staging.example.com -e ORIGIN=https://staging.example.com -e EMAIL_FILE=participants.local.txt -e PROJECT="KHU VỰC ĐÀ NẴNG" -e VUS=171 -e TEST_MODE=soak -e SOAK_MINUTES=25 -e SOAK_INTERVAL_SECONDS=120 -e ANSWER_JITTER_SECONDS=30 -e SYNC_LEAD_SECONDS=10 .\loadtest\k6.js
```
Kịch bản chờ 25 phút rồi nộp, với tối đa 5 phút dự phòng để hoàn tất các request, nên bài chạy có thể kéo dài gần 30 phút. Kỳ thi staging phải còn mở trong suốt bài test; đặt thời lượng thi tối thiểu 27 phút. Cần 171 email test mới, chưa dùng và có trong allowlist. Bài test ghi dữ liệu thật vào staging và mỗi email chỉ dùng được một lần; không chạy trên production.

Ngưỡng mặc định: tỷ lệ check trên 99%, lỗi request dưới 1%, p95 dưới 800 ms và p99 dưới 2 giây. Một lần chạy có thể tạo dữ liệu thi thử trong staging; kiểm tra và dọn dữ liệu theo quy trình staging trước khi chạy lại. Không chạy trên production.
