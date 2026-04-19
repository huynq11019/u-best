# Hướng dẫn API Events (Lấy thông tin trận đấu và kèo)

Tài liệu này mô tả các API endpoints thuộc `surebet_executor` để lấy danh sách trận đấu và chi tiết kèo (odds) đã được chuẩn hóa từ các nhà cái (Adapters). 

Các API này phục vụ cho việc theo dõi, hiển thị và phân tích dữ liệu thể thao đang diễn ra (Live) hoặc sắp diễn ra (Prematch).

## 1. Lấy danh sách trận đấu (Events)

Lấy danh sách tất cả các trận đấu đang có của một nhà cái, mỗi trận đấu chứa đầy đủ các tỷ lệ kèo (markets) bên trong.

- **URL**: `/api/:bookmakerKey/events`
- **Phương thức**: `GET`

### Tham số (Path Parameters & Query)

| Tham số | Loại | Bắt buộc | Mô tả |
| :--- | :--- | :---: | :--- |
| `bookmakerKey` | Path | ✅ | Mã nhà cái (VD: `saba`, `x1`, `lu88`) |
| `sport` | Query | ❌ | Môn thể thao (Mặc định: `football`) |

**Ví dụ Request:**
```http
GET /api/lu88/events?sport=football
```

### Dữ liệu trả về (Response)

Trả về danh sách các trận đấu đã được gom nhóm (group theo eventId hoặc theo tên đội/giải đấu). Mỗi trận sẽ bao gồm nhiều loại kèo (1X2, OU, AH...).

**Ví dụ JSON:**
```json
{
  "status": "success",
  "bookmakerKey": "lu88",
  "sport": "football",
  "count": 1,
  "events": [
    {
      "eventId": "124545450",
      "sport": "football",
      "league": "Premier League",
      "home": "Manchester United",
      "away": "Liverpool",
      "startTime": "15:30",
      "markets": [
        {
          "eventId": "124545450",
          "sport": "football",
          "league": "Premier League",
          "home": "Manchester United",
          "away": "Liverpool",
          "startTime": "15:30",
          "π": "OU",
          "selections": [
            { "label": "Over", "odds": 0.82, "line": 2.5 },
            { "label": "Under", "odds": 0.92, "line": 2.5 }
          ],
          "scope": "live"
        },
        {
          "eventId": "124545450",
          "sport": "football",
          "league": "Premier League",
          "home": "Manchester United",
          "away": "Liverpool",
          "startTime": "15:30",
          "marketType": "1X2",
          "selections": [
            { "label": "1", "odds": 1.85 },
            { "label": "X", "odds": 3.20 },
            { "label": "2", "odds": 4.10 }
          ],
          "scope": "live"
        }
      ]
    }
  ]
}
```

---

## 2. Lấy chi tiết một trận đấu cụ thể

Dùng để lấy chi tiết các dòng kèo (Odds) chỉ của một trận đấu dựa vào `eventId`.

- **URL**: `/api/:bookmakerKey/events/:eventId`
- **Phương thức**: `GET`

### Tham số (Path Parameters & Query)

| Tham số | Loại | Bắt buộc | Mô tả |
| :--- | :--- | :---: | :--- |
| `bookmakerKey` | Path | ✅ | Mã nhà cái (VD: `saba`, `x1`, `lu88`) |
| `eventId` | Path | ✅ | ID của trận đấu (lấy từ API danh sách events) |
| `sport` | Query | ❌ | Môn thể thao (Mặc định: `football`) |

**Ví dụ Request:**
```http
GET /api/lu88/events/124545450?sport=football
```

### Dữ liệu trả về (Response)

Chỉ trả về 1 object `event` tương tự như API trên. Nếu không tìm thấy, hệ thống sẽ trả về lỗi `404 Not Found`.

**Ví dụ JSON (Thành công):**
```json
{
  "status": "success",
  "bookmakerKey": "lu88",
  "sport": "football",
  "event": {
    "eventId": "124545450",
    "sport": "football",
    "league": "Premier League",
    "home": "Manchester United",
    "away": "Liverpool",
    "startTime": "15:30",
    "markets": [
      {
        "eventId": "124545450",
        "sport": "football",
        "league": "Premier League",
        "home": "Manchester United",
        "away": "Liverpool",
        "startTime": "15:30",
        "marketType": "OU",
        "selections": [
          { "label": "Over", "odds": 0.82, "line": 2.5 },
          { "label": "Under", "odds": 0.92, "line": 2.5 }
        ],
        "scope": "live"
      }
    ]
  }
}
```

**Ví dụ JSON (Thất bại - 404):**
```json
{
  "error": "Not Found",
  "message": "Event with id \"124545450_invalid\" not found."
}
```

---

## 3. Cấu trúc chuẩn hóa của một Market (Kèo)

Trong mảng `markets`, dữ liệu kèo sẽ luôn theo chuẩn dưới đây, tùy theo nhà cái và loại kèo (OU, 1X2, AH...):

| Trường | Kiểu dữ liệu | Ý nghĩa |
| :--- | :--- | :--- |
| `eventId` | `string` | ID mãng số định danh trận đấu |
| `sport` | `string` | Môn thể thao (VD: `football`) |
| `league` | `string` | Tên giải đấu |
| `home` | `string` | Tên đội nhà |
| `away` | `string` | Tên đội khách |
| `marketType` | `string` | Loại kèo: `OU` (Tài xỉu), `1X2` (Châu Âu), `AH` (Chấp CHâu Á) |
| `startTime` | `string` | Thời gian bắt đầu trận đấu hoặc phút thi đấu hiện tại |
| `scope` | `string` | Trạng thái: `live` (Đang đá) hoặc `prematch` (Sắp đá) |
| `selections` | `array` | Mảng các lựa chọn đặt cược bao gồm `label`, `odds` và `line` (nếu có) |

**Chi tiết trường `selections`:**
- `label`: Nhãn (Ví dụ: `"Over"`, `"Under"`, `"1"`, `"X"`, `"2"`).
- `odds`: Tỷ lệ cược (Odds dạng thập phân).
- `line` *(optional)*: Mức kèo (Ví dụ: `2.5`, `3.0`). Thường sử dụng cho O/U và Handicap.
