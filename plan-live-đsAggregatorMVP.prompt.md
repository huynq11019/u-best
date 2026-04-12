## Plan: Live Odds Aggregator MVP

Xây một dịch vụ aggregator live odds lấy dữ liệu từ SABA và 1xBET theo chu kỳ 3-5 giây, chuẩn hóa về schema chung, merge theo trận nhưng giữ riêng odds của từng nguồn, rồi phát đồng thời ra n8n webhook (để ghi Google Sheets) và Redis Pub/Sub. MVP dùng token SABA thủ công để đi nhanh, nhưng kiến trúc tách lớp auth để nâng cấp tự động hóa đăng nhập/token ở phase sau.

**Steps**
1. Chốt kiến trúc runtime và chuẩn dữ liệu canonical cho football live với market 1X2 + O/U, đồng thời để cờ mở rộng cho basketball và AH. Bao gồm quy ước trạng thái trận, timestamp, và trường nào bắt buộc. *blocking step*
2. Thiết kế provider interface thống nhất cho 2 nguồn: fetch match list, fetch market details, parse response, retry/backoff, timeout, và health check. *depends on 1*
3. Xây luồng SABA ingestor: gọi ShowAllOdds + GetMarkets, map TeamN/LeagueN, quản lý token thủ công qua config, xử lý lỗi 401/429/5xx với retry có jitter. *depends on 2*
4. Xây luồng 1xBET ingestor: gọi Get1x2_VZip + GetGameZip, giải nén/parse dữ liệu market groups, chuẩn hóa fields theo provider contract. *depends on 2, parallel with 3*
5. Xây normalizer chuyển dữ liệu SABA và 1xBET về canonical schema: match identity, score, marketType, line/handicap, selection, odds, source timestamp. Bỏ qua record lỗi schema và ghi metric lỗi parse. *depends on 3 and 4*
6. Xây merger layer theo nguyên tắc giữ cả 2 nguồn trên cùng một trận: ghép trận bằng khóa league-team-team-time-window, lưu source_odds riêng, gắn metadata chênh lệch odds để lọc surewin downstream. *depends on 5*
7. Xây state cache cho trận đang live và snapshot mới nhất của odds nhằm tránh publish trùng: TTL theo vòng đời trận, cleanup định kỳ, và idempotency key theo match+market+selection+source+line. *depends on 6*
8. Xây sink adapter n8n webhook: gọi POST endpoint n8n webhook với merged event, để n8n thực hiện batch upsert vào Google Sheets theo chu kỳ của nó, cột dữ liệu thể hiện rõ odds từng nguồn, và cột latency/freshness để theo dõi chất lượng feed. Config webhook URL qua env var. *depends on 7*
9. Xây sink adapter Redis Pub/Sub: publish event canonical đã merge lên channel theo sport hoặc match id, có version schema trong payload để consumer tương thích ngược. *depends on 7, parallel with 8*
10. Bổ sung API nội bộ phục vụ vận hành: health endpoint, stats endpoint (events/sec, parse errors, stale matches), và cấu hình polling interval theo từng nguồn. *depends on 8 and 9*
11. Viết test và checklist vận hành: unit test parser/normalizer, integration test end-to-end 2 nguồn -> merge -> 2 sinks, test chịu lỗi token/rate limit, và kiểm thử freshness ở mức 3-5 giây. *depends on 10*
12. Phase mở rộng sau MVP: thêm basketball và AH theo feature flag, rollout theo từng market để kiểm soát rủi ro mapping. *depends on 11*

**Relevant files**
- /Users/macbookpro/Documents/freelance/best_bot/bet_sports_api_docs.md — nguồn mapping endpoint, fields, headers và polling baseline cho SABA/1xBET
- Root workspace (/Users/macbookpro/Documents/freelance/best_bot) — sẽ khởi tạo cấu trúc service mới theo module: ingestors, normalizers, merger, sinks, api, tests

**Verification**
1. Kiểm thử parser theo fixture thực tế của 4 endpoint: ShowAllOdds, GetMarkets, Get1x2_VZip, GetGameZip.
2. Chạy integration flow mô phỏng polling 3-5 giây trong ít nhất 15 phút, xác nhận không crash khi một nguồn tạm fail.
3. Xác nhận output n8n webhook (quản lý bởi n8n) và Redis nhận cùng một event set (khác format nhưng cùng dữ liệu lõi).
4. Xác nhận merger giữ cả 2 odds sources cho cùng market/selection, không overwrite lẫn nhau.
5. Đo freshness p95 của update stream và xác nhận đạt mục tiêu realtime (xấp xỉ 3-5 giây theo yêu cầu).
6. Test recovery: token SABA sai/hết hạn, rate limit 429, timeout mạng, và service tự hồi phục theo retry policy.

**Decisions**
- Đầu ra MVP: n8n webhook (→ Google Sheets) + Redis Pub/Sub chạy song song.
- Scope chính MVP: football live với market 1X2 + O/U.
- Mở rộng gần: basketball và AH khi ổn định feed cốt lõi.
- Merge policy: giữ cả 2 nguồn để so sánh tỷ lệ ăn/surewin.
- Realtime target: polling mức cao 3-5 giây.
- Auth SABA: MVP dùng token thủ công, kiến trúc mở để tự động hóa về sau.

**Further Considerations**
1. Matching trận liên nguồn nên dùng thêm alias dictionary tên đội để giảm sai lệch do khác format tên (viết tắt, ngôn ngữ).
2. Nếu tần suất 3-5 giây gây rate limit, ưu tiên hạ tần suất cho chi tiết market trước, giữ tần suất cao cho match list.
3. Khi cần scale nhiều consumer (bot, dashboard, lưu lịch sử), có thể thêm Kafka như tầng fan-out mà không thay đổi lõi ingest/normalize/merge.
4. n8n webhook workflow nên bao gồm: nhận event từ aggregator, batch collect 50-100 events hoặc 5-10 giây, transform payload → bảng Google Sheets format, append rows vào Sheet, log errors và retry failed batches.