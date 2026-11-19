# Prisma Postgres: schema và dữ liệu

25 migration SQL nằm trong `prisma/migrations/`, từ `001_init` đến `025_admin_retake`. Prisma Migrate quản lý thứ tự và trạng thái áp dụng. Chúng giữ nguyên bảng, constraint, trigger và hàm PostgreSQL; chỉ bỏ câu lệnh gắn với role `anon`, `authenticated`, `service_role`, RLS của Supabase và `pgcrypto` (PostgreSQL có sẵn `gen_random_uuid`). Prisma Postgres từ chối `GRANT`/`REVOKE` với lỗi `restricted superuser`, nên migration không chứa các câu lệnh này. Chỉ cấp `DATABASE_URL` cho server. Không dùng `prisma db push` hay `prisma migrate reset` trên database có dữ liệu.

## Database mới, chưa có dữ liệu

Tạo Prisma Postgres dev/staging riêng và dùng **URL trực tiếp** cho Prisma Migrate. `DATABASE_URL` đặt bằng secret manager, không đưa vào Git hoặc log:

```powershell
$env:DATABASE_URL = $env:TARGET_DIRECT_URL
npx prisma migrate deploy
npm run db:verify
```

Sau đó đặt `DATABASE_URL` cho Vercel Functions thành URL **pooled** của cùng database, và redeploy. Cần kiểm thử API với database thật vì môi trường phát triển hiện tại chưa có URL database và không chạy được PostgreSQL cục bộ.

## Dữ liệu đang ở Supabase

Xác nhận nguồn đã áp dụng đủ 001–025, nhất là `exam_retake_archives` và `authorize_exam_retake`. Sao lưu nguồn; dừng ghi trước bản dump cuối. Dùng PostgreSQL client tools tương thích với Prisma Postgres. Ví dụ PowerShell cho staging:

```powershell
pg_dump --format=custom --schema=public --no-owner --no-acl --file=exam-staging.dump "$env:SOURCE_DATABASE_URL"
pg_restore --verbose --exit-on-error --no-owner --no-privileges --dbname="$env:TARGET_DIRECT_URL" exam-staging.dump
$env:DATABASE_URL = $env:TARGET_DIRECT_URL
npm run db:verify
Get-ChildItem prisma/migrations -Directory | Sort-Object Name | ForEach-Object { npx prisma migrate resolve --applied $_.Name }
npx prisma migrate status
```

Bản restore đã chứa schema và dữ liệu, vì vậy **không chạy `migrate deploy` trước khi đánh dấu 25 migration đã áp dụng**. Chỉ đánh dấu sau khi đối chiếu schema, hàm và số bản ghi với nguồn. Nếu `pg_restore` báo lỗi role, extension hay policy, xử lý trên staging và kiểm tra lại toàn bộ; không bỏ qua lỗi. Bản dump chứa dữ liệu thí sinh, phải lưu trong vùng bảo mật ngoài repo.

Trên staging, kiểm tra đăng nhập admin, bắt đầu/lưu/nộp bài, chấm tự luận, PDF, import và cấp thi lại; chạy load test với email test mới. Khi chuyển production, restore bản dump cuối vào database đích mới, đối chiếu dữ liệu, sau đó mới đặt URL pooled cho Vercel và redeploy. Giữ nguồn cũ để rollback.
