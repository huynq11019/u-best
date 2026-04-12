# Tài liệu API Sportsbook (SABA Sports & 1xBET) - Đã Xác Minh

Tài liệu này tổng hợp các đầu API chính xác 100% dựa trên dữ liệu thực tế từ hệ thống SABA Sports trên trang web `https://f9e7gr.lcypyold.com`.

---

## 1. API Lấy Danh Sách Trận Đấu (ShowAllOdds)

Đây là API quan trọng nhất để lấy dữ liệu thô của tất cả các trận đấu.

- **URL**: `https://f9e7oo.lcypyold.com/BFOdds/ShowAllOdds`
- **Phương thức**: `POST`
- **Content-Type**: `multipart/form-data`

### Dữ liệu gửi đi (Request - Form Data)

| Tham số | Giá trị | Ý nghĩa |
| :--- | :--- | :--- |
| `GameId` | `1` | 1: Bóng đá, 2: Bóng rổ, 8: Quần vợt,... |
| `DateType` | `l` / `t` / `e` | `l`: Live, `t`: Today, `e`: Early |
| `BetTypeClass` | `HDP` / `OU` | Nhóm kèo chính muốn hiển thị |
| `GameType` | `0` | Thường là 0 |

### Dữ liệu trả về (Response - JSON)

Cấu trúc root của JSON:
- `ErrorCode`: `0` (Thành công)
- `ErrorMsg`: `"Success"`
- `Data`: Đối tượng chứa dữ liệu chính.

Bên trong `Data`:
- `NewMatch`: Mảng các trận đấu.
- `TeamN`: Object ánh xạ `ID đội -> Tên đội`.
- `LeagueN`: Object ánh xạ `ID giải -> Tên giải`.

**Chi tiết trường trong một trận đấu (`NewMatch`):**
- `MatchId`: ID nội bộ của trận đấu.
- `MatchCode`: Mã định danh duy nhất (dùng để đặt cược).
- `TeamId1` / `TeamId2`: ID đội nhà / đội khách.
- `LeagueId`: ID giải đấu.
- `T1V` / `T2V`: **Tỷ số hiện tại** (Team 1 Value / Team 2 Value).
- `IsLive`: `true`/`false`.
- `MaT`: Trạng thái (ví dụ: `"l"` là live).
- `Ktm`: Thời gian thi đấu (phút).

---

## 2. API Lấy Chi Tiết Tỷ Lệ Cược (GetMarkets)

Dùng để lấy chi tiết các dòng kèo (Odds) của một trận.

- **URL**: `https://f9e7oo.lcypyold.com/BFOdds/GetMarkets`
- **Phương thức**: `POST`
- **Content-Type**: `application/json`

### Dữ liệu gửi đi (Request Body)

```json
[
  {
    "GameId": 1,
    "DateType": "l",
    "BetTypeClass": "OU",
    "GameType": 0,
    "Matchid": 125387578
  }
]
```

### Dữ liệu trả về (Response Body)

Trả về mảng các loại kèo. Các trường quan trọng:
- `BetType`: Loại kèo (1: Chấp, 3: Tài xỉu, 5: 1X2,...).
- `Hdp`: Tỷ lệ chấp (Handicap).
- `Price1` / `Price2`: Tỷ lệ ăn (Odds) cho lựa chọn 1 / lựa chọn 2.

---

## 3. Header Bắt Buộc (Authentication)

Tất cả các API yêu cầu các header sau:

- `Authorization`: `Bearer <TOKEN>` (Lấy từ LocalStorage sau khi vào trang).
- `_mculture`: `vi-VN`
- `Origin`: `https://f9e7gr.lcypyold.com`

---

> [!TIP]
> Để lấy dữ liệu tự động, bạn nên khởi tạo một session bằng cách truy cập trang chủ trước, sau đó trích xuất Token từ header hoặc cookie để gắn vào các request sau này.

---

## 4. API 1xBET (Phiên bản Lite)

Nguồn dữ liệu dự phòng từ `https://1xlite-044647.top`. API này sử dụng phương thức `GET` và trả về dữ liệu nén JSON (Zip).

### 4.1. API Lấy Danh Sách Trận Đấu Live (Get1x2_VZip)

- **URL**: `https://1xlite-044647.top/service-api/LiveFeed/Get1x2_VZip`
- **Phương thức**: `GET`
- **Tham số (Query Params)**:
    - `sports`: `1` (Bóng đá)
    - `lng`: `vi` (Tiếng Việt)
    - `count`: `50` (Số trận trả về)
    - `mode`: `4`
    - `country`: `43`
    - `getEmpty`: `true`
    - `noFilterBlockEvent`: `true`

**Ví dụ Request:**
```http
GET /service-api/LiveFeed/Get1x2_VZip?sports=1&count=5&lng=vi&mode=4&country=43&getEmpty=true&noFilterBlockEvent=true HTTP/1.1
Host: 1xlite-044647.top
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Referer: https://1xlite-044647.top/en/live/football
```

**Ví dụ Response (JSON):**
```json
{
  "Error": "",
  "ErrorCode": 0,
  "Success": true,
  "Value": [
    {
      "I": 711888563,
      "L": "Australia. A League",
      "O1": "Melbourne City",
      "O2": "Wellington Phoenix",
      "SC": {
        "FS": {
          "S1": 2,
          "S2": 0
        }
      },
      "E": [
        { "T": 1, "C": 1.007 },
        { "T": 2, "C": 29.0 },
        { "T": 3, "C": 101.0 }
      ]
    }
  ]
}
```
*Giải thích:*
- `I`: ID của trận đấu (Game ID).
- `L`: Tên giải đấu.
- `O1` / `O2`: Tên đội nhà / đội khách.
- `SC.FS`: Tỷ số hiện tại (`S1`: Đội nhà, `S2`: Đội khách).
- `E`: Các kèo chính (1=Chủ nhà thắng, 2=Hòa, 3=Khách thắng).

### 4.2. API Lấy Chi Tiết Kèo O/U (GetGameZip)

- **URL**: `https://1xlite-044647.top/service-api/LiveFeed/GetGameZip`
- **Phương thức**: `GET`
- **Tham số (Query Params)**:
    - `id`: `{GAME_ID}` (Lấy từ trường `I` của API danh sách)
    - `lng`: `vi`
    - `isSubGames`: `true`
    - `GroupEvents`: `true`
    - `allEventsZip`: `true`

**Ví dụ Request:**
```http
GET /service-api/LiveFeed/GetGameZip?id=711888563&lng=vi&isSubGames=true&GroupEvents=true&allEventsZip=true HTTP/1.1
Host: 1xlite-044647.top
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Referer: https://1xlite-044647.top/en/live/football
```

**Ví dụ Response (JSON):**
```json
{
  "Error": "",
  "ErrorCode": 0,
  "Success": true,
  "Value": {
    "I": 711888563,
    "L": "Australia. A League",
    "O1": "Melbourne City",
    "O2": "Wellington Phoenix",
    "GE": [
      {
        "G": 17,
        "E": [
          [
            { "T": 9, "P": 2.5, "C": 2.744 },
            { "T": 10, "P": 2.5, "C": 1.49 }
          ],
          [
            { "T": 9, "P": 3.0, "C": 4.5 },
            { "T": 10, "P": 3.0, "C": 1.15 }
          ]
        ]
      }
    ]
  }
}
```

### 4.3. Cấu trúc ánh xạ Kèo (Market Mapping)

Dữ liệu kèo nằm trong mảng `Value.GE` (Group Events). Dưới đây là các ID nhóm quan trọng:

| Nhóm Kèo (Group) | ID (G) | Ý nghĩa |
| :--- | :--- | :--- |
| **1x2** | `1` | Thắng - Hòa - Thua |
| **Handicap** | `2` | Kèo chấp châu Á |
| **Total (O/U)** | `17` | Kèo Tài/Xỉu toàn trận |
| **First Half O/U** | `15` | Kèo Tài/Xỉu hiệp 1 |

**Chi tiết trong mảng `E` (Events):**
- `T`: Loại lựa chọn (Ví dụ: `9` là Tài, `10` là Xỉu).
- `P`: Mức kèo (Ví dụ: `2.5`).
- `C`: Tỷ lệ ăn (Odds).

### 4.4. Header Yêu Cầu

Không cần Token phức tạp như SABA, nhưng cần đảm bảo các header trình duyệt cơ bản:
- `User-Agent`: (Dùng của trình duyệt phổ biến)
- `Referer`: `https://1xlite-044647.top/en/live/football`

---

> [!NOTE]
> 1xBET Lite cập nhật dữ liệu qua cơ chế **Polling**. Để có dữ liệu real-time, bạn nên gọi API danh sách mỗi 10-15 giây và API chi tiết trận đấu quan tâm mỗi 5 giây.
