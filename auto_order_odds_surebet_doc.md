tôi có api lấy danh sách các kèo surebet OU khi đặt lệnh từ 2 nhà cái khác nhau 

response exaple: 
[
  {
    "away": "SHB Da Nang",
    "b188_league_name": "Vietnam V League 1",
    "from_books": "b188+x1",
    "home": "Song Lam Nghe An",
    "home_sign": null,
    "home_sign_1x": null,
    "legs": "Over=2.09(b188) | Under=1.975(x1)",
    "line": 3,
    "line_1x": null,
    "market": "OU",
    "profit_pct": 1.52,
    "saba_league_name": "",
    "scope": "FT",
    "sport": "football",
    "team": "ALL",
    "updated_at": "Sat, 11 Apr 2026 11:12:55 GMT",
    "x1_league_name": "Vietnam. V-League",
    "bet": {
      "total_stake": 100,
      "profit_pct_calc": 1.544,
      "payout_equal": 101.54,
      "legs": [
        {
          "type": "Over",
          "team": null,
          "odds": 2.09,
          "book": "b188",
          "stake": 48.59,
          "label": "Over 3"
        },
        {
          "type": "Under",
          "team": null,
          "odds": 1.975,
          "book": "x1",
          "stake": 51.41,
          "label": "Under 3"
        }
      ]
    }
  }
]

và mong muốn sẽ viết 1 tool để ngay lập tức đặt lệnh trên các nhà cái khi được thông báo khi có odds
yêu cầu thời gian từ lúc nhận được kèo đến lúc đặt lệnh <20s

- Bản MVP đầu tiêu sẽ sử dụng playwire để thực hiện auto đặt lệnh trên trang của nhà cái

- Về sau từ các bước thực hiện có thể truy vết ra các api và sequence sử dụng các api tương ứng để đặt lệnh nhằm tối ưu thời gian từ lúc nhận kèo đế lúc đặt lệnh thành công.
