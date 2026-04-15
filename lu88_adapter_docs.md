# Lu88 Adapter Integration Guide

Tài liệu này mô tả chi tiết quy trình tích hợp bookmaker **Lu88** (`lu88.moe`) vào hệ thống `surebet_executor`. Quy trình này bao gồm việc mô phỏng thao tác đăng nhập của người dùng qua giao diện (Puppeteer/Playwright) và sau đó tương tác với API nội bộ để lấy đường dẫn phiên làm việc SportV.

## 1. Thông tin chung (Endpoint & Credentials)

- **Base URL:** `https://lu88.moe`
- **Tài khoản test:**
  - Username: `MIKAMIKA`
  - Password: `123321`

### Các biến môi trường (.env)
Để kích hoạt adapter này, hệ thống yêu cầu cấu hình các biến môi trường sau:
```env
ALLOWED_BOOKMAKERS=...,lu88
LU88_BASE_URL=https://lu88.moe
LU88_USERNAME=MIKAMIKA
LU88_PASSWORD=123321
```

## 2. Kịch bản Đăng nhập (Login Flow)

Lu88 cung cấp giao diện Single Page Application (SPA). Quá trình đăng nhập bắt buộc phải tương tác thông qua DOM UI thay vì gọi API trực tiếp, nhằm vượt qua các cơ chế kiểm tra bot ở mức độ mạng/cookie ban đầu.

### **Các bước thực thi (Playwright):**

1. **Truy cập Base URL:**
   - Điều hướng trình duyệt tới `https://lu88.moe`.
   - Đợi trang load hoàn tất (`domcontentloaded` + `2000ms` delay để nội dung SPA hiển thị hết).

2. **Kiểm tra trạng thái đăng nhập (Warm/Cached Session):**
   - Trước khi thao tác, adapter kiểm tra xem cookie/session cũ có còn hợp lệ không bằng cách tìm kiếm các chỉ báo đã đăng nhập trên UI (ví dụ: nút "Nạp tiền", username hiển thị ở header).
   - *Nếu đã đăng nhập:* Bỏ qua bước điền form.

3. **Mở Modal Đăng nhập:**
   - Tìm và click vào nút **"Đăng nhập"** màu xanh/vàng trên header (`button.bg-pri-main:has-text("Đăng nhập")`).

4. **Điền thông tin và Submit:**
   - Nhập Username vào trường `#username-login-input`.
   - Nhập Password vào trường `#password-login-input`.
   - Click nút Submit (nút có text "Đăng nhập" bên trong modal) hoặc gửi phím `Enter` từ trường password.

5. **Xác nhận kết quả:**
   - Chờ hệ thống chuyển trạng thái (hiển thị username trên header hoặc nút deposit).
   - Lắng nghe/Theo dõi lỗi: Nếu xuất hiện các dòng chữ báo lỗi (`sai tên người dùng`, `sai mật khẩu`, ...), adapter sẽ văng lỗi chi tiết.

### **Chi tiết API Đăng nhập dưới nền:**
Khi click submit, trình duyệt sẽ tự động gọi API:
- **Request:** `POST /gw/api/v2/auth/login`
- **Body:** `{ username, password }`
- **Cơ chế lưu trữ (Auth):** Kết quả trả về sẽ tự động set JWT token vào Cookie (`token`, `refresh_token`) và LocalStorage. Do Playwright chạy trong context của browser, các API call tiếp theo sẽ tự động kế thừa cookie này.

## 3. Khởi tạo phiên Game (Warm Up Flow)

Sau khi đăng nhập thành công, user không thể cược trực tiếp trên `lu88.moe` mà phải truy cập vào một iFrame/nhà cung cấp đối tác (Provider). Ở đây, nền tảng tích hợp là **SportV**.

### **Các bước thực thi:**

1. **Gọi API nhận Game URL:**
   - Nút/Link "Thể thao" trên UI sẽ trigger một API để xin cấp phát URL truy cập. Thay vì click UI, adapter dùng `page.evaluate()` gọi trực tiếp API này để lấy link ổn định hơn.
   - **Endpoint:** `GET /gw/api/v2/game/url`
   - **Query Params:**
     ```json
     {
       "partner_provider": "sportv",
       "partner_game_type": "",
       "home": "https://lu88.moe?ref_domain=false",
       "device": "pc"
     }
     ```
   - **Lưu ý quan trọng:** Để tránh lỗi **CORS**, trước khi gọi API này bằng `page.evaluate()`, trình duyệt bắt buộc phải đang ở trên domain `lu88.moe`. (Adapter đã xử lý check: nếu đang ở domain SportV thì navigate về lu88.moe trước).

2. **Dữ liệu trả về (Response):**
   ```json
   {
     "status": "OK",
     "code": 200,
     "data": "https://c0z0ob.bpjp45ee.com/Newindex?lang=vn&webskintype=3&homeURL=..."
   }
   ```
   Trường `data` chứa một URL có thời hạn, trỏ sang domain của SportV (mã domain có thể thay đổi liên tục như `bpjp45ee.com`, `bpah3tqv.com`).

3. **Điều hướng tới nhà cung cấp (Navigation):**
   - Trình duyệt điều hướng tới URL nhận được từ bước trên.
   - Wait condition: Dùng `{ waitUntil: 'commit', timeout: 60000 }` thay vì `domcontentloaded` vì SPA của SportV load component rất nặng và cơ chế domContentLoaded dễ bị timeout ảo. Thêm một hard-sleep `5000ms` để render list kèo.

## 4. Đặc tả Lấy Tỷ lệ cược (Active Odds) - Mở rộng

Hàm `getActiveOdds(page, sportType)` chịu trách nhiệm lấy odds.
- Trình duyệt **bắt buộc** phải đang ở trên trang SportV (domain xác thực bởi `bpjp45ee.com` hoặc cache URL từ lúc warm-up). Nếu trôi tab, adapter sẽ tự động gọi lại quy trình `warmUp()`.
- Việc lấy odds phụ thuộc hoàn toàn vào cấu trúc DOM của bảng kèo SportV. (Hiện tại hàm này đang ở trạng thái Cần Mở Rộng - Stub).

## 5. Cấu trúc Source Code

- **Adapter file:** `src/adapters/lu88Adapter.js`
  Kế thừa `BaseAdapter`. Chứa trọn vẹn Selector dictionary và quy trình check login 2 lớp.
- **Adapter Registration:** `src/services/adapterRegistry.js`
  Adapter được inject lúc boot application.
- **Config:** Cấu hình credentials trong `src/config/index.js`.
- **Smoke test:** Kiểm tra độc lập thông qua lệnh `node src/test_lu88.js` giúp dev verify luồng mà không cần start toàn bộ pool executor.
