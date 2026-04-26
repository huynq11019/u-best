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

| Nhóm Kèo (Group) | ID (G) | Ý nghĩa (Description) |
| :--- | :--- | :--- |
| **1x2 Full Time** | `1` | Thắng - Hòa - Thua (Cả trận) |
| **Handicap** | `2` | Kèo chấp Châu Á (HDP) |
| **Total (O/U)** | `17` | Kèo Tài/Xỉu (Over/Under) toàn trận |
| **BTTS** | `19` | Hai đội cùng ghi bàn (Both Teams To Score) |
| **1st Half O/U** | `15` | Kèo Tài/Xỉu hiệp 1 |
| **Special/Prop** | `2882`| Kèo phụ đặc biệt (Thẻ phạt/Phạt góc theo mốc `P`) |

**Giải nghĩa hằng số (Constants) trong `GE` và mảng con `E`:**

- `G` (**Group / Market ID**): Định nghĩa **Nhóm Kèo Chính** (Loại hình cược).
  - Ví dụ `1` là kèo 1X2 toàn trận, `2` là Chấp (Handicap), `17` là Tài Xỉu.
  - Ví dụ trong data tham khảo: `G: 19` là kèo **Hai đội cùng ghi bàn (Both Teams To Score)**.
- `GS` (**Group Sub-ID / Period Extension**): Định nghĩa **Mức phụ / Phân khúc hiệp đấu** (Sub-market).
  - Ví dụ: Thường `GS` được gán để tách biệt luật áp dụng trong cùng 1 loại kèo. Một kèo `G` có thể mở ra nhiều `GS` (áp dụng cho Hiệp 1, Hiệp 2, phase đặc thù, hoặc gộp penalty). Mã `GS: 21` thường được hệ thống quy chuẩn ngầm chỉ định "Phạm vi Toàn thời gian 90 phút".
- `T` (**Type / Selection ID**): **Mã Lựa chọn cửa cược**. Đây là tham số bắt buộc dùng để chốt bill. Từ UI và JSON, có thể map: 
  - `T: 1` = Đội nhà thắng (1), `T: 2` = Hòa (X), `T: 3` = Đội khách thắng (2).
  - Đối với Kèo Cược Chấp (Handicap - G: 2): `T: 7` = Chọn Đội 1, `T: 8` = Chọn Đội 2.
  - Đối với Tài/Xỉu (O/U - G: 17): `T: 9` mã hoá cửa **Tài (Over)**, và `T: 10` mã hoá cửa **Xỉu (Under)**.
- `V`: **Không tồn tại trong object tỷ lệ cược (E)**. Trong JSON của 1xBet, chữ `V` thường chỉ xuất hiện ở mảng `MIS` (với ý nghĩa là **V**alue đi kèm cặp với **K**ey cho các thông tin thống kê như: thời tiết, vòng đấu, thành phố) hoặc là object `Value` báo hiệu dữ liệu cốt lõi tổng thể của API. Khả năng cao bạn gõ nhầm từ `G` (Group ID) hoặc `GS` (Group Sub-ID).
- `C` (**Coefficient**): **Tỷ lệ Odds (bằng số thực)** - Đây là tỷ lệ thanh toán dùng để tính tiền thắng thua lợi nhuận khi gửi dữ liệu lên server. 
- `CV` (**Coefficient Value**): **Tỷ lệ hiển thị (dạng chuỗi Text)** - Đây chính là đoạn Text định dạng sẵn sẽ được in/parse trực tiếp lên lưới giao diện thẻ `<canvas>` cho người dùng xem trên UI (VD: `"1.45"`, `"1.015"`, `"33"`).
- `P` (**Parameter - Tuỳ chọn mốc kèo**): **Mốc Điểm/Cột Mốc**. Chỉ xuất hiện ở các kèo có tính hệ số biên như Cấp Chấp hoặc Tài Xỉu. 
  - Dựa trên UI/JSON: Trong kèo Chấp Châu Á, `P` sử dụng dấu để phân chia chấp/được chấp (VD: `P: 1.5` nghĩa là Đội nhà hưởng lợi +1.5 trái, trong khi `P: -1.5` là Đội khách bị trừ -1.5 trái). Ở kèo tổng (O/U), `P` luôn là mốc bàn thắng kỳ vọng (VD: `P: 2.5` - Tài xỉu 2.5).

### 4.4. Header Yêu Cầu

Không cần Token phức tạp như SABA, nhưng cần đảm bảo các header trình duyệt cơ bản:
- `User-Agent`: (Dùng của trình duyệt phổ biến)
- `Referer`: `https://1xlite-044647.top/en/live/football`

---

> [!NOTE]
> 1xBET Lite cập nhật dữ liệu qua cơ chế **Polling**. Để có dữ liệu real-time, bạn nên gọi API danh sách mỗi 10-15 giây và API chi tiết trận đấu quan tâm mỗi 5 giây.

### 4.5. API Cấp Dữ Liệu Lưới Canvas (Chi Tiết Trận Thực Tế)

Đây là phiên bản đầy đủ của endpoint `GetGameZip` mà 1xBet/1xLite gọi tĩnh tiến để lấy dữ liệu Odds trực tiếp vẽ lên thẻ `<canvas>` ở màn Hình chi tiết trận (`market-grid-canvas`).

- **URL**: `https://1xfun888bet.com/service-api/LiveFeed/GetGameZip`
- **Phương thức**: `GET`
- **Tham số (Query Params) Cụ Thể Hơn**:
    - `id`: `{GAME_ID}` (Ví dụ: `714290039`)
    - `lng`: `vi`
    - `countevents`: `250` (Tối đa load 250 kèo)
    - `grMode`: `4` (Chế độ nhóm Group Mode)
    - `marketType`: `1`
    - `isNewBuilder`: `true` (Xác định phiên bản App/Web mới)

**Headers Đặc Biệt / Chống Bot Mở Rộng:**
Bên cạnh các Headers cơ bản, API LiveFeed cho màn hình chi tiết thỉnh thoảng sử dụng một số Header đánh dấu:
- `x-app-n`: `__BETTING_APP__`
- `x-svc-source`: `__BETTING_APP__`
- `x-requested-with`: `XMLHttpRequest`
- `x-hd`: Chuỗi mã hóa (Signature/Salt) được sinh ra bằng JS để chống Bot cào dữ liệu tự động. Nếu bị block CORS hoặc 403, có thể bạn sẽ phải giả lập signature này.

**Ví dụ cURL Request Đầy Đủ:**
```bash
curl 'https://1xlite-044647.top/service-api/LiveFeed/GetGameZip?id=714290039&lng=vi&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&topGroups=&country=43&marketType=1&isNewBuilder=true' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'x-app-n: __BETTING_APP__' \
  -H 'x-requested-with: XMLHttpRequest' \
  -H 'x-svc-source: __BETTING_APP__' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Mac OS X 10_15_7) Chrome/147.0.0.0 Safari/537.36'
```

**Ví dụ Response (JSON):**
Dưới đây là một phần dữ liệu thực tế API trả về cho ứng dụng vẽ lên lưới canvas (chứa tất tần tật tỷ lệ và loại kèo):
```json
{
  "Error": "",
  "ErrorCode": 0,
  "Guid": "",
  "Id": 0,
  "Success": true,
  "Value": {
    "CE": "Indonesia",
    "CID": 1,
    "CN": "Indonesia",
    "CO": 9,
    "COI": 72,
    "DI": "",
    "EC": 355,
    "EGC": 59,
    "GE": [
      {
        "G": 1,
        "GS": 1,
        "E": [
          [
            { "C": 1.675, "CV": "1.675", "G": 1, "GS": 1, "T": 1 },
            { "C": 3.56,  "CV": "3.56",  "G": 1, "GS": 1, "T": 2 },
            { "C": 5.22,  "CV": "5.22",  "G": 1, "GS": 1, "T": 3 }
          ]
        ]
      },
      {
        "G": 19,
        "GS": 21,
        "E": [
          [
            { "C": 1.54, "CV": "1.54", "G": 19, "GS": 21, "T": 180 },
            { "C": 9.29, "CV": "9.29", "G": 19, "GS": 21, "P": 2, "T": 11273 }
          ],
          [
            { "C": 2.408, "CV": "2.408", "G": 19, "GS": 21, "T": 181 },
            { "C": 1.016, "CV": "1.016", "G": 19, "GS": 21, "P": 2, "T": 11274 }
          ]
        ]
      }
    ]
  }
}
```
*Giải thích chi tiết Response:*
- `Value.GE`: Mảng Group Events (Nhóm kèo tỷ lệ).
- `G` / `GS`: Thay vì text, API trả mã số tương đương loại kèo (VD `1` = 1X2 Toàn trận, `19` = Tài Xỉu/Chấp...).
- Trong mảng con `Value.GE[].E[][]`:
  - `T`: Id của lựa chọn đánh (Bet Type). Gửi `T` này khi đặt cược.
  - `C`: Tỷ lệ ăn (Odds thực tế số thập phân).
  - `CV`: Chuỗi String hiển thị trực tiếp lên từng pixel của Canvas.
  - `P`: Mốc kèo (Handicap / Cột mốc Tài Xỉu), VD như `P: 2` là kèo 2 trái.

---

### 4.6. API Đặt Cược Live (UpdateCoupon)

Đây là API **đặt cược thực sự** (place bet) cho kèo live. Server sẽ kiểm tra tính hợp lệ của odds và xử lý phiếu cược.

- **URL**: `https://1xfun888bet.com/service-api/LiveBet-update/Open/UpdateCoupon`
- **Phương thức**: `POST`
- **Content-Type**: `application/json`

#### Headers Bắt Buộc

| Header | Giá trị mẫu | Ý nghĩa |
| :--- | :--- | :--- |
| `x-hd` | `9IjVygfc2R3F...` | **Token xác thực phiên** (Base64, sinh bởi JS phía client). Bắt buộc — thiếu sẽ bị 403. |
| `x-svc-source` | `__BETTING_APP__` | Định danh nguồn gọi API |
| `x-app-n` | `__BETTING_APP__` | Tên app nội bộ |
| `x-requested-with` | `XMLHttpRequest` | Đánh dấu AJAX request |
| `is-srv` | `false` | `false` = gọi từ client, không phải server |
| `x-mobile-project-id` | `0` | ID project mobile (0 = web) |
| `Referer` | `https://1xfun888bet.com/vi/live/football/{leagueSlug}/{gameId}-{team1}-{team2}` | URL trang chi tiết trận |

#### Request Body

```json
{
  "UserId": 1633454933,
  "Events": [
    {
      "GameId": 714350696,
      "Type": 10,
      "Coef": 1.09,
      "Param": 5.5,
      "PV": null,
      "PlayerId": 0,
      "Kind": 1,
      "InstrumentId": 0,
      "Seconds": 0,
      "Price": 0,
      "Expired": 0,
      "PlayersDuel": []
    }
  ],
  "Vid": 0,
  "partner": 1,
  "Lng": "vi",
  "CfView": 0,
  "CalcSystemsMin": false,
  "Group": 819,
  "Country": 43,
  "Currency": 91,
  "SaleBetId": 0,
  "IsPowerBet": false,
  "WithLobby": false
}
```

#### Giải nghĩa các trường Request

**Cấp root:**

| Trường | Kiểu | Ý nghĩa |
| :--- | :--- | :--- |
| `UserId` | `number` | ID tài khoản người dùng (lấy từ session sau khi đăng nhập) |
| `Events` | `array` | Danh sách lựa chọn cược (1 phần tử = single bet, nhiều = combo/parlays) |
| `Vid` | `number` | Variant ID, thường là `0` |
| `partner` | `number` | `1` = web chính thức |
| `Lng` | `string` | Ngôn ngữ (`"vi"` = Tiếng Việt) |
| `CfView` | `number` | Chế độ hiển thị hệ số (0 = decimal mặc định) |
| `CalcSystemsMin` | `boolean` | Tính tổng tối thiểu cho hệ thống cược. Thường `false` |
| `Group` | `number` | Mã môn thể thao tổng hợp (bóng đá live = `819`) |
| `Country` | `number` | Mã quốc gia người dùng (`43` = Việt Nam) |
| `Currency` | `number` | Mã tiền tệ (`91` = VND) |
| `SaleBetId` | `number` | ID cược muốn bán lại (0 = không áp dụng) |
| `IsPowerBet` | `boolean` | `true` = Power Bet (tăng tiền thưởng tiềm năng, rủi ro cao hơn) |
| `WithLobby` | `boolean` | Trả về kèm dữ liệu lobby khi `true` |

**Cấp `Events[]` (mỗi lựa chọn cược):**

| Trường | Kiểu | Ý nghĩa |
| :--- | :--- | :--- |
| `GameId` | `number` | ID trận đấu — lấy từ trường `I` (Get1x2_VZip) hoặc `GameId` (GetGameZip) |
| `Type` | `number` | **Mã lựa chọn cược** — tương đương `T` trong response GetGameZip. VD: `9` = Tài (Over), `10` = Xỉu (Under) |
| `Coef` | `number` | **Tỷ lệ odds tại thời điểm đặt** (decimal). Phải khớp với odds server, nếu lệch server sẽ reject |
| `Param` | `number` | **Mốc kèo** — tương đương `P` trong GetGameZip. VD: `5.5` = Tài/Xỉu 5.5 bàn |
| `PV` | `null\|number` | Price Value — thường `null` với kèo live thông thường |
| `PlayerId` | `number` | ID cầu thủ (cho kèo cầu thủ ghi bàn, v.v). `0` = không áp dụng |
| `Kind` | `number` | Loại lựa chọn trong kèo: `1` = Tài/Over/Đội nhà, `2` = Xỉu/Under/Đội khách |
| `InstrumentId` | `number` | ID công cụ phái sinh (thường là `0`) |
| `Seconds` | `number` | Thời gian thi đấu tại thời điểm đặt (giây, `0` nếu không track) |
| `Price` | `number` | Giá tiền đặt (để `0` ở bước mở coupon; server sẽ fill) |
| `Expired` | `number` | Thời điểm hết hạn odds (Unix timestamp, `0` = server tự quản lý) |
| `PlayersDuel` | `array` | Danh sách cầu thủ trong kèo tay đôi (thường empty `[]`) |

> [!IMPORTANT]
> `Type` trong `Events[]` chính là `T` lấy từ response `GetGameZip`. Đây là trường quan trọng nhất để chỉ định lựa chọn cược. Ví dụ: Muốn cược Xỉu (Under) 5.5, dùng `Type: 10` (T=10 từ GetGameZip).

#### Map nhanh: GetGameZip → UpdateCoupon

| GetGameZip Field | UpdateCoupon Field | Ghi chú |
| :--- | :--- | :--- |
| `Value.I` (hoặc `GameId`) | `Events[].GameId` | ID trận đấu |
| `E[][].T` | `Events[].Type` | Mã lựa chọn cược |
| `E[][].C` | `Events[].Coef` | Tỷ lệ odds (phải lấy giá trị mới nhất) |
| `E[][].P` | `Events[].Param` | Mốc kèo (O/U line, handicap) |

#### Ví dụ cURL

```bash
curl 'https://1xfun888bet.com/service-api/LiveBet-update/Open/UpdateCoupon' \
  -H 'x-hd: <SESSION_TOKEN>' \
  -H 'x-svc-source: __BETTING_APP__' \
  -H 'x-app-n: __BETTING_APP__' \
  -H 'x-requested-with: XMLHttpRequest' \
  -H 'is-srv: false' \
  -H 'x-mobile-project-id: 0' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'Referer: https://1xfun888bet.com/vi/live/football/{leagueSlug}/{gameId}-{team1}-{team2}' \
  --data-raw '{
    "UserId": <USER_ID>,
    "Events": [
      {
        "GameId": 714350696,
        "Type": 10,
        "Coef": 1.09,
        "Param": 5.5,
        "PV": null,
        "PlayerId": 0,
        "Kind": 1,
        "InstrumentId": 0,
        "Seconds": 0,
        "Price": 0,
        "Expired": 0,
        "PlayersDuel": []
      }
    ],
    "Vid": 0,
    "partner": 1,
    "Lng": "vi",
    "CfView": 0,
    "CalcSystemsMin": false,
    "Group": 819,
    "Country": 43,
    "Currency": 91,
    "SaleBetId": 0,
    "IsPowerBet": false,
    "WithLobby": false
  }'
```

#### Response

Server trả về trạng thái coupon. Các trường quan trọng cần xử lý:

| Trường | Ý nghĩa |
| :--- | :--- |
| `Success` | `true` = coupon hợp lệ, sẵn sàng confirm |
| `ErrorCode` | `0` = OK. Mã lỗi khác: odds đã đổi, trận kết thúc, giới hạn cược, v.v |
| `Value.Coef` | Odds mới nhất từ server (có thể khác `Coef` gửi lên nếu odds thay đổi) |
| `Value.MaxBet` | Mức cược tối đa cho phép |
| `Value.CouponId` | ID phiếu cược — dùng để confirm hoặc hủy ở bước tiếp theo |

> [!NOTE]
> `UpdateCoupon` chỉ là bước **"mở phiếu" (open coupon)** — tương đương thêm vào betting slip và server validate. Sau khi nhận `CouponId`, cần gọi thêm API confirm (thường là `ConfirmCoupon` hoặc `PlaceBet`) để hoàn tất đặt cược.

> [!WARNING]
> `Coef` phải là odds **real-time** lấy từ `GetGameZip` ngay trước khi gọi API này. Nếu odds đã thay đổi, server sẽ trả về lỗi yêu cầu xác nhận lại với odds mới.

---

### 4.7. API Đặt Cược Hoàn Tất (MakeBetWeb)

Đây là API **đặt cược thực sự và hoàn tất trong một bước** — khác với `UpdateCoupon` chỉ validate/mở phiếu, `MakeBetWeb` xử lý toàn bộ luồng đặt cược và trừ tiền ngay lập tức. Thường dùng cho chế độ **One-Click Bet** hoặc **Auto Bet**.

- **URL**: `https://1xfun888bet.com/service-api/LiveBet/Secure/MakeBetWeb`
- **Phương thức**: `POST`
- **Content-Type**: `application/json`

#### Headers Bắt Buộc

| Header | Giá trị mẫu | Ý nghĩa |
| :--- | :--- | :--- |
| `x-hd` | `z/WHM2kovF9sc...` | **Token xác thực phiên** (Base64, sinh bởi JS phía client). Bắt buộc — thiếu sẽ bị 403 |
| `x-auth` | `Bearer eyJ...` | JWT access token lấy từ cookie `user_token` sau khi đăng nhập |
| `x-svc-source` | `__BETTING_APP__` | Định danh nguồn gọi API |
| `x-app-n` | `__BETTING_APP__` | Tên app nội bộ |
| `x-requested-with` | `XMLHttpRequest` | Đánh dấu AJAX request |
| `is-srv` | `false` | `false` = gọi từ client, không phải server |
| `x-mobile-project-id` | `0` | ID project mobile (`0` = web) |
| `Referer` | `https://1xfun888bet.com/vi/live/football/{leagueSlug}/{gameId}-{team1}-{team2}` | URL trang chi tiết trận |

> [!IMPORTANT]
> `MakeBetWeb` yêu cầu thêm header `x-auth: Bearer <JWT>` so với `UpdateCoupon`. JWT này lấy từ cookie `user_token` (hoặc `access_token`) sau khi đăng nhập.

#### Request Body

```json
{
  "UserId": 1633454933,
  "Events": [
    {
      "GameId": 715155020,
      "Type": 180,
      "Coef": 3.19,
      "Param": 0,
      "PV": null,
      "PlayerId": 0,
      "Kind": 1,
      "InstrumentId": 0,
      "Seconds": 0,
      "Price": 0,
      "Expired": 0,
      "PlayersDuel": []
    }
  ],
  "Vid": 0,
  "partner": 1,
  "Group": 819,
  "live": true,
  "CheckCf": 2,
  "Lng": "vi",
  "notWait": true,
  "promo": null,
  "IsPowerBet": false,
  "Summ": 20000,
  "isAutoBet": true,
  "autoBetCf": 0,
  "TransformEventKind": true,
  "autoBetCfView": 0,
  "Source": 55,
  "OneClickBet": 2
}
```

#### Giải nghĩa các trường Request

**Cấp root — các trường mới so với `UpdateCoupon`:**

| Trường | Kiểu | Giá trị mẫu | Ý nghĩa |
| :--- | :--- | :--- | :--- |
| `Summ` | `number` | `20000` | **Số tiền đặt cược (VND)** — trường bắt buộc, không có trong UpdateCoupon |
| `live` | `boolean` | `true` | Xác nhận đây là kèo live (không phải pre-match) |
| `CheckCf` | `number` | `2` | **Chính sách xử lý khi odds thay đổi**: `0` = hủy nếu odds đổi, `1` = chấp nhận nếu odds tốt hơn, `2` = chấp nhận mọi thay đổi odds |
| `notWait` | `boolean` | `true` | Không chờ xác nhận từ server — đặt ngay lập tức (fast bet) |
| `isAutoBet` | `boolean` | `true` | Chế độ auto bet (One-Click Bet hoặc tự động hóa) |
| `autoBetCf` | `number` | `0` | Ngưỡng odds tối thiểu cho auto bet (`0` = không giới hạn) |
| `autoBetCfView` | `number` | `0` | Định dạng hiển thị odds cho auto bet |
| `TransformEventKind` | `boolean` | `true` | Server tự chuyển đổi `Kind` theo logic nội bộ (quan trọng cho kèo live) |
| `Source` | `number` | `55` | Nguồn đặt cược: `55` = One-Click Bet từ web. Các giá trị khác có thể là mobile, widget, v.v |
| `OneClickBet` | `number` | `2` | Chế độ One-Click: `2` = kích hoạt đặt cược 1 click không cần confirm |

**Cấp root — các trường kế thừa từ `UpdateCoupon`:**

| Trường | Kiểu | Ý nghĩa |
| :--- | :--- | :--- |
| `UserId` | `number` | ID tài khoản người dùng |
| `Events` | `array` | Danh sách lựa chọn cược (cấu trúc giống UpdateCoupon) |
| `Vid` | `number` | Variant ID, thường là `0` |
| `partner` | `number` | `1` = web chính thức |
| `Group` | `number` | Mã môn thể thao tổng hợp (bóng đá live = `819`) |
| `Lng` | `string` | Ngôn ngữ (`"vi"` = Tiếng Việt) |
| `IsPowerBet` | `boolean` | `true` = Power Bet (rủi ro/thưởng cao hơn) |

**Cấp `Events[]`** — cấu trúc giống `UpdateCoupon`, xem mục 4.6. Lưu ý trường đặc biệt trong ví dụ này:

| Trường | Giá trị | Ý nghĩa |
| :--- | :--- | :--- |
| `Type` | `180` | Mã lựa chọn cược — `T: 180` thuộc nhóm `G: 19` (BTTS/kèo đặc biệt) từ GetGameZip |
| `Param` | `0` | Không có mốc kèo (kèo BTTS/1X2 không cần handicap line) |
| `Kind` | `1` | Lựa chọn 1 trong nhóm kèo (Có/Yes trong BTTS, hoặc Đội nhà trong 1X2) |

#### Ví dụ cURL Đầy Đủ

```bash
curl 'https://1xfun888bet.com/service-api/LiveBet/Secure/MakeBetWeb' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: vi-VN' \
  -H 'content-type: application/json' \
  -H 'is-srv: false' \
  -H 'origin: https://1xfun888bet.com' \
  -H 'referer: https://1xfun888bet.com/vi/live/football/{leagueSlug}/{gameId}-{team1}-{team2}' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36' \
  -H 'x-app-n: __BETTING_APP__' \
  -H 'x-auth: Bearer <USER_TOKEN_JWT>' \
  -H 'x-hd: <SESSION_SIGNATURE>' \
  -H 'x-mobile-project-id: 0' \
  -H 'x-requested-with: XMLHttpRequest' \
  -H 'x-svc-source: __BETTING_APP__' \
  --data-raw '{
    "UserId": <USER_ID>,
    "Events": [
      {
        "GameId": 715155020,
        "Type": 180,
        "Coef": 3.19,
        "Param": 0,
        "PV": null,
        "PlayerId": 0,
        "Kind": 1,
        "InstrumentId": 0,
        "Seconds": 0,
        "Price": 0,
        "Expired": 0,
        "PlayersDuel": []
      }
    ],
    "Vid": 0,
    "partner": 1,
    "Group": 819,
    "live": true,
    "CheckCf": 2,
    "Lng": "vi",
    "notWait": true,
    "promo": null,
    "IsPowerBet": false,
    "Summ": 20000,
    "isAutoBet": true,
    "autoBetCf": 0,
    "TransformEventKind": true,
    "autoBetCfView": 0,
    "Source": 55,
    "OneClickBet": 2
  }'
```

#### Response

```json
{
  "Value": {
    "Id": 80833384253,
    "Balance": 30000,
    "PayoutType": 0,
    "Coupon": {
      "UserId": 1633454933,
      "Summ": 20000,
      "Coef": 3.19,
      "CheckCf": 2,
      "Source": 55,
      "NeedUpdateLine": false,
      "changeCf": false,
      "notLogin": false,
      "notWait": true,
      "OneClickBet": 2,
      "TransformEventKind": true,
      "Group": 819,
      "Events": [
        {
          "Coef": 3.19,
          "Param": 0,
          "Type": 180,
          "GameId": 715155020,
          "Kind": 1,
          "Block": false,
          "IsBannedExpress": false,
          "Finish": false
        }
      ]
    },
    "Dt": "/Date(1776962473753)/",
    "lvC": false,
    "lnC": false,
    "waitTime": 0,
    "betGUID": null,
    "SummPrep": 0,
    "FailInfo": null,
    "CanPrint": true
  },
  "Id": 0,
  "Success": true,
  "Error": "",
  "ErrorCode": 0
}
```

**Giải nghĩa Response — cấp `Value`:**

| Trường | Giá trị mẫu | Ý nghĩa |
| :--- | :--- | :--- |
| `Id` | `80833384253` | **ID phiếu cược** — dùng để tra cứu, hủy, hoặc cash-out sau này |
| `Balance` | `30000` | **Số dư tài khoản sau khi đặt** (VND). Ví dụ: trước 50,000 → đặt 20,000 → còn 30,000 |
| `PayoutType` | `0` | Loại thanh toán: `0` = thông thường |
| `Dt` | `/Date(1776962473753)/` | Timestamp đặt cược (Microsoft JSON Date — parse bằng `new Date(1776962473753)` trong JS) |
| `lvC` | `false` | **Live Coefficient Changed** — `true` = odds đã thay đổi tại thời điểm đặt |
| `lnC` | `false` | **Line Changed** — `true` = mốc kèo đã thay đổi tại thời điểm đặt |
| `waitTime` | `0` | Thời gian chờ xử lý (ms). `0` = xử lý ngay lập tức |
| `CanPrint` | `true` | Cho phép in/xuất phiếu cược |
| `FailInfo` | `null` | `null` = thành công. Nếu có lỗi sẽ chứa thông tin lỗi chi tiết |
| `SummPrep` | `0` | Số tiền chuẩn bị (dùng cho hệ thống prepaid/bonus) |
| `betGUID` | `null` | GUID phiếu cược (dùng cho hệ thống tracking nội bộ) |

**Giải nghĩa Response — cấp `Value.Coupon` (server echo + fill thêm):**

| Trường | Ý nghĩa |
| :--- | :--- |
| `Summ` | Số tiền đã đặt — server xác nhận |
| `Coef` | Odds tại thời điểm đặt được chốt |
| `NeedUpdateLine` | `false` = không cần cập nhật lại mốc kèo |
| `changeCf` | `false` = odds không bị thay đổi bởi server |
| `notLogin` | `false` = người dùng đã đăng nhập hợp lệ |
| `maxBet / minBet` | `0` = server không trả giới hạn cược (đã pass validation) |
| `Block` (trong Events) | `false` = lựa chọn cược không bị khóa |
| `IsBannedExpress` (trong Events) | `false` = lựa chọn không bị cấm trong combo/parlay |
| `Finish` (trong Events) | `false` = trận đấu chưa kết thúc tại thời điểm đặt |

#### So sánh `UpdateCoupon` vs `MakeBetWeb`

| Điểm | `UpdateCoupon` | `MakeBetWeb` |
| :--- | :--- | :--- |
| Mục đích | Validate + mở phiếu | **Đặt cược hoàn tất** |
| Có trường `Summ` | Không | **Có** |
| Cần bước tiếp theo | Có (ConfirmCoupon) | **Không** |
| Response trả về | `CouponId` để confirm | **Bet ID + Balance mới** |
| Dùng khi | Betting slip thông thường | **One-Click Bet / Auto Bet** |
| Header `x-auth` | Không bắt buộc | **Bắt buộc** |

#### Lưu ý quan trọng khi tích hợp

- **`CheckCf: 2`** — nên dùng cho auto bet để tránh bị reject khi odds nhảy nhẹ trong live.
- **`lvC` và `lnC`** trong response cần được log lại — nếu `true` nghĩa là odds/line đã trượt, cần đánh giá lại lợi nhuận thực tế.
- **`Source: 55`** nên giữ nguyên để tránh bị phát hiện là bot (server có thể filter theo source).
- **`Dt`** dùng format `/Date(ms)/` — parse bằng `new Date(parseInt(dt.replace('/Date(', '').replace(')/', '')))` trong JS.
- **`x-auth`** là JWT lấy từ cookie `user_token` — token này có TTL ngắn (~15 phút), cần refresh định kỳ.
