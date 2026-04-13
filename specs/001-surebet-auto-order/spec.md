# Feature Specification: Auto Surebet Order Execution

**Feature Branch**: `001-setup-speckit-branch`  
**Created**: 2026-04-12  
**Status**: Draft  
**Input**: User description: "phân tích yêu cầu đề bài của tôi"

## Clarifications

### Session 2026-04-12

- Q: Khi vế 1 đã đặt thành công nhưng vế 2 thất bại, hệ thống nên xử lý mặc định thế nào? → A: Ưu tiên tự đặt lệnh hedge thay thế theo ngưỡng lỗ tối đa cấu hình; nếu không thực hiện được thì chuyển sang hủy/void vế 1, nếu vẫn không hủy/void được thì cảnh báo để xử lý thủ công.
- Q: Quy tắc nhận diện cơ hội trùng cho cơ chế chống đặt lặp nên là gì? → A: Ưu tiên dùng opportunity_id từ upstream; nếu thiếu thì fallback sang khóa ghép match + market + line + from_books + odds hai vế trong cửa sổ thời gian chống trùng.
- Q: Phạm vi cặp nhà cái nào được phép auto đặt trong MVP? → A: Dùng danh sách cặp nhà cái cho phép bằng cấu hình, mặc định là cặp saba + x1.
- Q: Ngưỡng lợi nhuận tối thiểu để hệ thống cho phép auto đặt nên là gì? → A: Cấu hình toàn cục, mặc định 3%.
- Q: Cơ chế tiếp nhận cơ hội surebet nên dùng kênh nào để đạt <20s? → A: Webhook từ upstream (push).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Execute Qualified Surebet Quickly (Priority: P1)

Là vận hành giao dịch, tôi muốn hệ thống tự động đặt đủ 2 vế kèo OU surebet ngay khi nhận tín hiệu, để chốt cơ hội trước khi odds thay đổi.

**Why this priority**: Đây là giá trị cốt lõi của tính năng; nếu không đặt đủ 2 vế nhanh thì không đạt mục tiêu surebet.

**Independent Test**: Có thể kiểm thử độc lập bằng cách gửi một cơ hội surebet hợp lệ vào hệ thống và xác nhận trạng thái đặt lệnh cho cả 2 vế được hoàn tất trong thời gian mục tiêu.

**Acceptance Scenarios**:

1. **Given** cơ hội surebet OU hợp lệ với đủ dữ liệu 2 vế và tài khoản đã sẵn sàng, **When** hệ thống nhận thông báo cơ hội, **Then** hệ thống hoàn tất đặt lệnh cả 2 vế và trả kết quả cuối cùng trong dưới 20 giây.
2. **Given** cơ hội surebet được nhận nhưng odds tại một vế thay đổi làm lợi nhuận dưới ngưỡng cho phép, **When** hệ thống kiểm tra trước khi xác nhận lệnh, **Then** hệ thống không hoàn tất cặp lệnh và phát cảnh báo có lý do cụ thể.

---

### User Story 2 - Protect Capital With Trading Rules (Priority: P2)

Là vận hành giao dịch, tôi muốn hệ thống tự động kiểm tra điều kiện rủi ro trước khi đặt, để tránh đặt sai hạn mức hoặc đặt vào cơ hội không phù hợp.

**Why this priority**: Sau tốc độ, kiểm soát rủi ro là yêu cầu quan trọng nhất để tránh thua lỗ vận hành.

**Independent Test**: Có thể kiểm thử độc lập bằng cách gửi các cơ hội vi phạm từng quy tắc (hạn mức, số dư, thị trường) và xác nhận hệ thống từ chối đặt lệnh kèm lý do.

**Acceptance Scenarios**:

1. **Given** một cơ hội surebet có stake vượt trần cấu hình, **When** hệ thống đánh giá điều kiện trước giao dịch, **Then** hệ thống từ chối thực thi và ghi nhận lý do từ chối.
2. **Given** một cơ hội surebet hợp lệ về odds nhưng tài khoản một nhà cái không đủ số dư, **When** hệ thống thực hiện kiểm tra trước giao dịch, **Then** hệ thống không gửi lệnh và phát cảnh báo thiếu số dư.

---

### User Story 3 - Track And Recover Failed Executions (Priority: P3)

Là vận hành giao dịch, tôi muốn xem được nhật ký đầy đủ và trạng thái xử lý cho từng cơ hội, để có thể truy vết và can thiệp thủ công khi cần.

**Why this priority**: Tính minh bạch giúp giảm rủi ro vận hành khi có lỗi một phần và hỗ trợ cải tiến hiệu năng sau MVP.

**Independent Test**: Có thể kiểm thử độc lập bằng cách tạo các tình huống thành công, lỗi một phần, thất bại hoàn toàn và xác nhận mỗi tình huống đều có bản ghi đầy đủ cùng cảnh báo tương ứng.

**Acceptance Scenarios**:

1. **Given** một lần thực thi kết thúc ở trạng thái lỗi một phần, **When** vận hành mở nhật ký thực thi, **Then** hệ thống hiển thị đầy đủ thời điểm, giá trị odds, stake, trạng thái từng vế và hành động yêu cầu xử lý tiếp theo.

---

### Edge Cases

- Cùng một cơ hội được gửi lặp lại nhiều lần trong khoảng thời gian ngắn: hệ thống phải ưu tiên chống trùng theo opportunity_id; nếu thiếu thì dùng khóa ghép match + market + line + from_books + odds hai vế trong cửa sổ chống trùng.
- Cơ hội đến trễ (stale) so với thời điểm cập nhật odds.
- Cơ hội có cặp nhà cái không nằm trong allowlist cấu hình: hệ thống từ chối auto đặt và phát cảnh báo lý do từ chối.
- Kèo bị khóa/tạm dừng giữa lúc xử lý hai vế.
- Phiên đăng nhập tại một nhà cái hết hạn ngay trước lúc đặt lệnh.
- Lệnh vế thứ nhất thành công nhưng vế thứ hai bị từ chối: hệ thống phải ưu tiên tự hedge trong ngưỡng lỗ tối đa cấu hình; nếu không hedge được thì chuyển sang hủy/void vế thứ nhất, nếu vẫn không hủy/void được thì chuyển xử lý thủ công.
- Mất kết nối tạm thời trong quá trình gửi xác nhận lệnh.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST tiếp nhận thông báo cơ hội surebet OU thông qua webhook endpoint từ upstream, chứa đầy đủ thông tin trận đấu, thị trường, line, 2 vế odds và phân bổ stake.
- **FR-002**: System MUST xác thực độ mới của cơ hội dựa trên thời gian cập nhật và từ chối cơ hội quá hạn theo ngưỡng cấu hình.
- **FR-003**: System MUST kiểm tra điều kiện đủ để đặt cặp lệnh trước khi thực thi, bao gồm tính khả dụng của 2 vế và ngưỡng lợi nhuận tối thiểu; hệ thống MUST xác nhận profit_pct_calc >= ngưỡng lợi nhuận toàn cục (mặc định 3.0%), nếu thấp hơn thì từ chối auto đặt.
- **FR-004**: System MUST áp dụng quy tắc quản trị rủi ro trước giao dịch, gồm hạn mức stake, số dư tài khoản và phạm vi thị trường được phép giao dịch.
- **FR-005**: System MUST thực thi đặt lệnh cho 2 vế như một cặp giao dịch phối hợp và xác định rõ kết quả cuối cùng: thành công đủ cặp, lỗi một phần, thất bại, hoặc chờ xử lý thủ công.
- **FR-006**: System MUST đảm bảo tổng thời gian từ lúc nhận cơ hội đến khi có kết quả cuối cùng không vượt quá 20 giây đối với cơ hội đủ điều kiện.
- **FR-007**: System MUST ngăn đặt trùng cho cùng một cơ hội bằng cách ưu tiên nhận diện theo opportunity_id từ upstream; nếu thiếu opportunity_id thì fallback sang khóa ghép match + market + line + from_books + odds hai vế trong cửa sổ thời gian chống trùng được cấu hình.
- **FR-008**: System MUST phát cảnh báo ngay cho vận hành khi xảy ra lỗi một phần, thất bại hoặc vi phạm quy tắc trước giao dịch.
- **FR-009**: System MUST lưu vết kiểm toán cho mọi lần xử lý, gồm dữ liệu đầu vào, stake từng vế, odds tại thời điểm đặt, mốc thời gian theo từng bước và trạng thái cuối cùng.
- **FR-010**: System MUST cho phép vận hành tạm dừng và bật lại cơ chế auto đặt lệnh mà không làm mất khả năng tiếp nhận thông báo.
- **FR-011**: System MUST ghi nhận đầy đủ chuỗi hành động xử lý lệnh để phục vụ giai đoạn tối ưu hóa tốc độ đặt lệnh trong các phiên bản tiếp theo.
- **FR-012**: System MUST khi xảy ra lỗi lệch vế (vế 1 thành công, vế 2 thất bại) thì ưu tiên tự đặt lệnh hedge thay thế theo ngưỡng lỗ tối đa cấu hình; nếu không thể hedge thì phải thực hiện bước hủy/void vế đã khớp, nếu vẫn không hủy/void được thì phải phát cảnh báo và chuyển xử lý thủ công.
- **FR-013**: System MUST chỉ auto đặt cho các cặp nhà cái thuộc allowlist cấu hình; mặc định allowlist của MVP là cặp saba + x1.
- **FR-014**: System MUST duy trì trạng thái "warm-up" (mở sẵn/đăng nhập sẵn trang thao tác của các nhà cái trong pool) trong thời gian rỗi để đảm bảo khi webhook tới, hệ thống có thể điền vé cược ngay lập tức mà không mất thời gian nạp trang hay đăng nhập lặp lại.
- **FR-015**: System MUST thực hiện thao tác đặt vé cược tới các nhà cái song song (concurrent execution) thay vì tuần tự, nhằm đạt độ trễ thấp nhất.
- **FR-016**: System kiến trúc MUST cho phép dễ dàng mở rộng thêm Adapter nhà cái mới trong tương lai mà không làm ảnh hưởng đến luồng xử lý đồng thời cốt lõi.

### Key Entities *(include if feature involves data)*

- **Surebet Opportunity**: Đại diện một cơ hội surebet OU tại thời điểm cụ thể; chứa trận đấu, thị trường, line, nguồn nhà cái, lợi nhuận dự kiến và thời điểm cập nhật.
- **Bet Leg**: Đại diện một vế lệnh (Over hoặc Under) với nhà cái, odds, stake và nhãn line tương ứng.
- **Execution Attempt**: Đại diện một lần hệ thống xử lý cơ hội surebet từ lúc nhận tín hiệu đến lúc kết thúc; chứa trạng thái tổng, trạng thái từng vế và mốc thời gian thực thi.
- **Risk Policy**: Bộ quy tắc vận hành quyết định cơ hội nào được phép auto đặt, gồm ngưỡng lợi nhuận, hạn mức stake, whitelist/blacklist phạm vi giao dịch.
- **Execution Alert**: Bản ghi cảnh báo sinh ra khi có lỗi hoặc ngoại lệ cần can thiệp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ít nhất 95% cơ hội đủ điều kiện được xử lý ra trạng thái cuối trong vòng 20 giây trong điều kiện vận hành bình thường.
- **SC-002**: Tỷ lệ hoàn tất đủ 2 vế trên các cơ hội đã vượt kiểm tra rủi ro đạt tối thiểu 92% theo chu kỳ theo dõi 7 ngày.
- **SC-003**: 100% trường hợp lỗi một phần hoặc thất bại phát sinh cảnh báo cho vận hành trong vòng 5 giây kể từ khi phát hiện.
- **SC-004**: Tối thiểu 99% thông báo trùng không tạo thêm lần đặt lệnh mới cho cùng cơ hội.
- **SC-005**: 100% lần xử lý có bản ghi kiểm toán đầy đủ, có thể truy xuất để đối soát trong vòng 1 phút.

## Assumptions

- Hệ thống upstream đã cung cấp cơ hội surebet với stake phân bổ đề xuất cho từng vế.
- Tài khoản tại các nhà cái đã được xác thực và nạp đủ số dư trước khi bật chế độ auto.
- Phạm vi MVP tập trung vào kèo OU bóng đá toàn trận (FT) theo cấu trúc dữ liệu hiện tại.
- Có ít nhất một vận hành trực trong khung giờ chạy để xử lý các tình huống cần can thiệp thủ công.
- Giai đoạn đầu sử dụng kênh thao tác có sẵn trên giao diện nhà cái; tối ưu hóa kênh đặt lệnh nhanh hơn là phạm vi của các phiên bản sau.
