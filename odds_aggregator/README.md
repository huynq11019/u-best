# Live Odds Aggregator MVP

Service Python async phục vụ mục đích tổng hợp (aggregate) kèo bóng đá (Live Odds) trực tiếp từ hai nguồn **SABA Sports** và **1xBET**.

Hệ thống fetch dữ liệu song song từ 2 nguồn (polling), chuẩn hóa thành schema chung (Canonical Schema), sau đó dùng Fuzzy Matching để ghép các trận đấu giống nhau lại với nhau, và xuất dữ liệu liên tục qua **n8n Webhook** và **Redis Pub/Sub**. Mặc dù ghép dữ liệu theo trận, hệ thống vẫn đảm bảo giữ tách biệt tỷ lệ kèo (odds) của từng nguồn để phục vụ thiết kế Surewin downstream.

## 🌟 Tính Năng Chính

- **Ingestor Đa Chiều**: Tự động lấy danh sách và chi tiết tỷ lệ kèo `1x2` và `Over/Under` (O/U).
- **Anti-Ban/WAF Bypass**: Tích hợp bypass WAF cơ bản cho 1xBET và Backoff Retry cho cả 2 API.
- **Fuzzy Matcher**: Khắc phục tình trạng lệch tên đội bóng bằng thư viện so khớp chuỗi `rapidfuzz` kết hợp với từ điển bí danh (Alias Dictionary).
- **Idempotency Cache**: Không phát lại (publish) các thay đổi trùng lặp chưa có diễn biến mới, tiết kiệm bằng thông.
- **Auto-Retry Webhook**: n8n Webhook Sink tích hợp Retry Queue độc lập với RAM, đảm bảo không mất dữ liệu nếu đầu n8n đang bận.

---

## 🚀 Kiến Trúc Pipeline

`Ingestors (SABA, 1xBET)` ➔ `Queue` ➔ `Normalizer` ➔ `Merger` ➔ `State Cache (Redis)` ➔ `Sinks (n8n, Pub/Sub)`

---

## 📦 Yêu Cầu Hệ Thống

- **Python**: `3.9+` (Đã test và tương thích với `3.13`)
- **Redis**: Chạy local (mặc định cổng `6379`) hoặc remote server.

## 🛠 Lắp Đặt & Cấu Hình

**1. Clone dự án và cài thư viện**

```bash
cd odds_aggregator
python3 -m pip install -r requirements.txt
```

**2. Cấu hình biến môi trường**
Copy file `.env.example` thành `.env`:

```bash
cp .env.example .env
```

Mở file `.env` và điền quan trọng nhất là `SABA_TOKEN` (Ví dụ: chuỗi Bearer token lấy từ F12/Network của trang chủ SABA).
_(1xBET không yêu cầu Token cấu hình)._

**3. Bật Redis**
Nếu chưa bật Redis, hãy bật nó. Ví dụ qua brew trên Mac:

```bash
brew services start redis
```

---

## 🏃 Thao Tác Cơ Bản

### Chạy Service Chính (Aggregator Pipeline)

Khi bật công tắc này, con Bot sẽ liên tục chạy ngầm, kéo dữ liệu mỗi `3-5s` và đẩy thẳng ra các Sinks.

```bash
python3 main.py
```

### Chạy Thử Demo

Để test một lượt lấy thông tin và xem định dạng gộp mà không cần bật Queue hay Sinks.

```bash
python3 demo.py
```

### Chạy Unit Test

Pipeline được bảo vệ bởi 22 kịch bản Test tự động (Bao phủ Ingestors, Fuzzy Merger, Normalizer...).

```bash
python3 -m pytest tests/ -v
```

---

## 🔌 API Giám Sát (Ops API)

Khi ứng dụng chạy (qua `main.py`), một máy chủ API nội bộ sẽ được mở ở `http://localhost:8080`.

- **Máu/Sức khỏe**: `GET /health` (Báo tình trạng kết nối SABA / 1xBET, Lỗi Token).
- **Thống kê**: `GET /stats` (Báo cáo số lượng Event đã gửi/lỗi sang n8n/Redis, số trận live đang theo dõi).
- **Trận đấu**: `GET /live` (Lấy mảng Match Keys của mọi trận bóng cỏ).
- **Danh sách sự kiện**: `GET /events` (Chỉ trả metadata cấp trận: match_key, đội, giải, trạng thái, phút, score, two_sources).
- **Chi tiết odds theo sự kiện**: `GET /events/{match_key}` (Trả full kèo/odds theo từng nguồn cho trận đó).
- **Cập nhật Token SABA siêu tốc**:
  Nếu token SABA chết, thay vì tắt App, bạn dán post URL này:
  ```bash
  curl -X POST http://localhost:8080/admin/reload-token \
     -H "Content-Type: application/json" \
     -d '{"token":"<NEW_BEARER_TOKEN>"}'
  ```

---

## 📝 Chú Ý

- API 1xBET sử dụng module `requests` + `to_thread` thay vì Async httpx/aiohttp nhằm mục đích Bypass Cloudflare/WAF 406 Error.
- **Fuzzy Matcher** có thể ghép sai lệch do rủi ro tên giải/đội bị trùng âm. Hãy cập nhật từ điển `TEAM_ALIASES` bên trong thư mục `merger/merger.py` nếu phát hiện Bot ghép nhầm trận.

chạy test:

python3 -m pytest tests/ -v
