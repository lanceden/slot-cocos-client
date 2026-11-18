# Cocos Slot Demo — 開發計畫

> 用 Cocos Creator 做一台簡單的老虎機，並自己寫一個「遊戲商」遊戲伺服器，串接 `PLAN.md` 裡的 Seamless Wallet。
>
> 目的：補上 Cocos 遊戲前端的實作經驗與作品，同時展示「遊戲前端 + 遊戲伺服器 + 平台錢包」整條鏈路都自己做過。
>
> **前置條件**：`PLAN.md` 的錢包 MVP（第一、二週）已完成。

---

## 1. 目標與非目標

**目標**
- 一台可玩的 5×3 轉輪、10 條連線老虎機，能下注、轉動、派彩、顯示餘額
- 結果由伺服器決定（client 只負責演出），符合真實業界做法
- 用模擬器跑出 RTP（返還率），並調整到目標區間
- 輸出 H5（Web Mobile）與 Android APK；實作熱更新
- 有轉輪動畫、中獎連線、贏分跳動、大獎特效、音效

**非目標**
- Free Spin、Bonus Game、Jackpot 等進階玩法（列為加分）
- 多台遊戲、遊戲大廳
- 真實金流、真實上架

---

## 2. 技術棧

| 用途 | 選擇 |
|---|---|
| 遊戲前端 | Cocos Creator 3.8.x + TypeScript |
| 動畫 | Cocos Tween、粒子系統；骨骼動畫用 DragonBones（免費，Cocos 3.x 內建支援） |
| 遊戲伺服器 | .NET 10 Web API（`Slot.GameServer`） |
| 資料庫 | 沿用錢包的 PostgreSQL，另開 `slot` schema |
| 即時推播 | 沿用錢包的 SignalR（餘額更新） |
| 美術素材 | 自製或免費授權素材（例如 Kenney.nl），README 註明授權來源 |
| 打包 | Web Mobile；Android 用 Android Studio；iOS 需 Mac + Xcode（選做） |

> 注意：不要使用任何真實博弈遊戲或知名 IP 的美術、名稱、音效。

---

## 3. 架構

真實 BC 的關係是：**平台（錢包）↔ 遊戲商（遊戲伺服器 + 遊戲前端）**。本專案兩邊都自己做。

```
┌────────────────────┐   1. launch(playerId)    ┌──────────────────────┐
│  Wallet API        │ ───────────────────────▶ │  Slot.GameServer     │
│  （平台方，PLAN.md） │ ◀─────────────────────── │  （遊戲商）            │
│                    │   2. 回傳 gameUrl+token   │  - 開局 / Token        │
│                    │                          │  - RNG、盤面、算分     │
│                    │ ◀─── 4. bet / settle ─── │  - 回合紀錄、補派彩     │
│                    │      （HMAC 簽章）         │                      │
└─────────┬──────────┘                          └──────────▲───────────┘
          │ SignalR 餘額推播                                 │ 3. spin(token, bet)
          ▼                                                 │
┌─────────────────────────────────────────────────────────────┴───────┐
│  Cocos Client（H5 / Android）                                         │
│  Loading → Slot Scene：轉輪、連線、贏分、特效、音效、自動轉              │
└─────────────────────────────────────────────────────────────────────┘
```

**原則**：client 永遠不決定結果。client 只送「我要下注多少」，伺服器回傳完整盤面與贏分，client 照著演。

---

## 4. Repo 結構（放進錢包同一個 repo）

```
seamless-wallet-demo/
├─ src/
│  ├─ ...（錢包既有專案）
│  ├─ Slot.Core/               # 盤面、轉輪帶、賠率表、算分（純邏輯，好測試）
│  ├─ Slot.GameServer/         # API、Token、錢包串接、補派彩 Worker
│  └─ Slot.RtpSimulator/       # Console：跑大量局數計算 RTP
├─ client/
│  └─ slot-cocos/              # Cocos Creator 專案
├─ tests/
│  └─ Slot.Tests/
└─ docs/
   ├─ slot-math.md             # 賠率表、轉輪帶、RTP 結果
   └─ slot-client.md           # 前端架構、效能數據
```

一個 `docker compose up` 就能啟動錢包 + 遊戲伺服器 + H5 版遊戲。

---

## 5. 遊戲數學

### 5.1 盤面與連線
- 5 軸 × 3 列，固定 10 條連線，由左至右連續 3 個以上相同符號才算中獎
- 下注 = 每線下注 × 10

### 5.2 符號（示意，數值用模擬器調整）

| 符號 | 3 連 | 4 連 | 5 連 | 備註 |
|---|---|---|---|---|
| WILD | — | — | — | 替代所有一般符號 |
| 7 | 20 | 100 | 500 | 最高分 |
| BAR | 10 | 40 | 150 | |
| 鈴鐺 | 6 | 20 | 80 | |
| 西瓜 | 4 | 12 | 40 | |
| 櫻桃 | 2 | 6 | 20 | |
| 檸檬 | 1 | 4 | 12 | |

倍率 × 每線下注 = 該線贏分。

### 5.3 轉輪帶（Reel Strip）
- 每軸一條固定長度的符號序列（例如 32 格），高分符號出現次數少
- RNG 對每軸選一個停止位置，取連續 3 格作為該軸盤面
- RNG 使用 `System.Security.Cryptography.RandomNumberGenerator.GetInt32`，不用 `System.Random`

### 5.4 RTP 模擬器
```
dotnet run --project src/Slot.RtpSimulator -- --spins 10000000 --seed-free
```
輸出：
- RTP（總贏分 / 總下注），目標 **95%～97%**
- 中獎率（有贏分的局數比例）
- 各符號、各連數的貢獻比例
- 最大單局倍數

調整轉輪帶和賠率表直到 RTP 落在目標區間，最終數據寫進 `docs/slot-math.md`。這是面試時很好講的一段。

---

## 6. 遊戲伺服器 API

### 6.1 開局（平台呼叫遊戲商）
| Method | Path | 說明 |
|---|---|---|
| POST | `/provider/launch` | 平台傳入 playerId，回傳 `gameUrl?token=...` |

- Token：隨機字串存 Redis，綁定 playerId，有效 2 小時
- 錢包後台加一個「開始遊戲」按鈕或端點，模擬平台開局

### 6.2 遊戲端點（client 呼叫）
| Method | Path | 說明 |
|---|---|---|
| POST | `/game/init` | 用 token 取得玩家資訊、餘額、可選下注額、賠率表 |
| POST | `/game/spin` | 下注並轉一次 |
| GET | `/game/last-round` | 斷線重連後取回最後一局結果 |

**spin Request / Response**
```jsonc
// request
{ "token": "abc...", "lineBet": 100 }      // 單位：分

// response
{
  "code": "OK",
  "roundId": "R-20261118-000123",
  "reels": [["7","BAR","WILD"], ["7","LEMON","BELL"], ["7","CHERRY","BAR"], ["BAR","BELL","LEMON"], ["MELON","7","CHERRY"]],
  "wins": [ { "line": 1, "symbol": "7", "count": 3, "amount": 2000 } ],
  "totalBet": 1000,
  "totalWin": 2000,
  "balance": 101000
}
```

### 6.3 spin 流程（重點）

```
1. 驗證 token，取得 playerId；同一玩家同時只能有一局進行中（Redis 鎖）
2. 產生 roundId、betTxnId，寫入 slot.rounds（status = BETTING）
3. 呼叫錢包 /bet（HMAC 簽章）
   - 失敗（餘額不足等）→ round 標記 REJECTED，回傳錯誤給 client
   - 逾時 → 用同一個 betTxnId 重送（錢包有冪等），仍失敗則呼叫 /rollback
4. RNG 產生盤面，計算 wins、totalWin，寫入 round（status = SETTLING）
5. 呼叫錢包 /settle（totalWin 為 0 也要呼叫）
   - 成功 → round 標記 COMPLETED
   - 失敗或逾時 → round 保持 SETTLING，交給補派彩 Worker；仍照常回傳盤面給 client
6. 回傳結果
```

**補派彩 Worker**：每 10 秒掃描 `SETTLING` 超過 30 秒的回合，用原本的 settleTxnId 重送 `/settle`，直到成功。**玩家贏的錢絕對不能因為網路問題消失**，這是面試必講的一點。

### 6.4 資料表
```sql
CREATE SCHEMA slot;

CREATE TABLE slot.rounds (
    round_id        VARCHAR(32) PRIMARY KEY,
    player_id       VARCHAR(64) NOT NULL,
    line_bet        BIGINT NOT NULL,
    total_bet       BIGINT NOT NULL,
    total_win       BIGINT,
    reels           JSONB,
    wins            JSONB,
    bet_txn_id      VARCHAR(64) NOT NULL UNIQUE,
    settle_txn_id   VARCHAR(64) NOT NULL UNIQUE,
    status          VARCHAR(16) NOT NULL,   -- BETTING / REJECTED / SETTLING / COMPLETED / ROLLED_BACK
    retry_count     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX ix_rounds_player ON slot.rounds (player_id, created_at DESC);
CREATE INDEX ix_rounds_settling ON slot.rounds (status, created_at) WHERE status = 'SETTLING';
```

---

## 7. Cocos 前端

### 7.1 場景
| 場景 | 內容 |
|---|---|
| `Loading` | 讀取 URL 的 token → 呼叫 `/game/init` → 用 Asset Bundle 載入遊戲資源，顯示進度條 |
| `Slot` | 主遊戲畫面 |

### 7.2 Slot 場景元件
```
SlotScene
├─ ReelArea
│  ├─ Reel × 5          # 每軸一個 Reel 元件，符號節點用物件池
│  └─ WinLineLayer      # 中獎連線繪製（Graphics）
├─ HUD
│  ├─ BalanceLabel      # 餘額（SignalR 推播 + spin 回傳）
│  ├─ BetSelector       # 每線下注 + / −
│  ├─ WinLabel          # 贏分跳動
│  ├─ SpinButton
│  └─ AutoSpinButton    # 自動轉 10 / 50 / 100 次，餘額不足或大獎自動停
├─ BigWinLayer          # 大獎特效（贏分 ≥ 20 倍下注）：粒子 + DragonBones + 跳分
└─ DialogLayer          # 錯誤提示、斷線重連
```

### 7.3 程式架構
- `NetService`：封裝 HTTP 與錯誤碼、逾時重試（只重試查詢類；spin 不自動重送，改用 `/game/last-round` 取回結果）
- `GameState`：目前餘額、下注、是否轉動中，用事件通知 UI
- `ReelController`：負責演出，介面類似 `spin(): void`、`stopAt(symbols: string[][]): Promise<void>`
- `AudioService`：背景音樂、轉動、停止、中獎音效，含靜音開關
- 嚴格區分「資料」和「演出」：收到伺服器結果後才決定停止位置

### 7.4 轉輪演出規格
1. 按下 Spin：五軸同時開始，加速到最高速
2. 送出 `/game/spin`；轉動至少 0.8 秒，並等待伺服器回應
3. 收到結果：由左到右依序停止，每軸間隔 0.15 秒，停止時有回彈（Tween `backOut`）
4. 全部停止後：依序閃爍每條中獎連線，贏分從 0 跳到 totalWin
5. 大獎：進入 BigWinLayer 演出，可點擊跳過

### 7.5 效能要求（量測後寫進 `docs/slot-client.md`）
- 符號使用自動圖集（Auto Atlas），DrawCall 控制在 30 以下
- 轉動時不 `instantiate` / `destroy` 節點，使用物件池
- 中階 Android 手機轉動時維持 60 FPS（用 Cocos 內建 Profiler 截圖）
- H5 首次載入大小 < 5 MB（不含音效可延後載入）

### 7.6 錯誤處理
| 情況 | 前端行為 |
|---|---|
| 餘額不足 | 提示並停止自動轉 |
| Token 過期 | 提示重新進入遊戲 |
| spin 逾時 / 斷線 | 顯示「連線中」，恢復後呼叫 `/game/last-round` 補演出 |
| 伺服器錯誤 | 提示稍後再試，餘額以伺服器為準重新整理 |

---

## 8. 打包與熱更新

### 8.1 Web Mobile（H5）
- 由 Cocos 構建發布，放進 docker compose 的 nginx 容器
- 確認手機直式 / 橫式的適配策略（建議直式，Fit Width）

### 8.2 Android
- Cocos 構建產生原生專案 → Android Studio 打開 → 產生簽章過的 APK
- keystore 不放進 repo，README 說明如何自行產生
- 記錄 APK 大小

### 8.3 iOS（選做，需要 Mac）
- Cocos 構建 → Xcode 打開 → 實機執行即可，不上架

### 8.4 熱更新（Android 原生版）
- 使用 Cocos 3.x 的 `jsb.AssetsManager`
- 產生 `project.manifest` / `version.manifest`，放在 nginx 提供下載
- Demo：改一個賠率表顯示文字或按鈕顏色 → 只更新資源 → App 重開後套用，不重新安裝 APK
- 錄成 GIF 放進 README

---

## 9. 測試

**伺服器（xUnit）**
- [ ] 算分：手動構造盤面，驗證每條連線、WILD 替代、只算最高連數
- [ ] RTP 模擬器 1,000 萬局，RTP 落在 95%～97%
- [ ] 錢包 `/bet` 失敗時不產生派彩
- [ ] `/settle` 失敗時回合停在 SETTLING，Worker 重送後完成，錢包只入帳一次
- [ ] 同一玩家同時送兩個 spin，只有一個會進行

**整合（結合錢包）**
- [ ] 跑 1 萬局後，`slot.rounds` 的總下注、總贏分 = 錢包 ledger 對應交易加總
- [ ] 錢包的帳務不變式仍成立

**前端（手動檢查清單）**
- [ ] 快速連點 Spin 不會重複下注
- [ ] 轉動中切到背景再回來，畫面與餘額正確
- [ ] 斷網再恢復，能補演出最後一局
- [ ] 自動轉在餘額不足時停止

---

## 10. 里程碑（三個週末）

### 第一週 星期六：遊戲數學
- [ ] `Slot.Core`：符號、轉輪帶、連線定義、算分
- [ ] `Slot.RtpSimulator`，調整到目標 RTP
- [ ] 算分單元測試
- **驗收**：模擬器輸出 RTP 報表，`docs/slot-math.md` 完成

### 第一週 星期日：遊戲伺服器
- [ ] `/provider/launch`、Token、`/game/init`、`/game/spin`、`/game/last-round`
- [ ] 串接錢包 bet / settle / rollback，補派彩 Worker
- [ ] 伺服器測試與整合測試
- **驗收**：用 Swagger 或 curl 跑完整局，錢包帳務正確；手動關掉錢包 API 再恢復，補派彩成功

### 第二週 星期六：Cocos 基礎與轉輪
- [ ] 建立 Cocos 專案、場景、資源目錄、Auto Atlas
- [ ] Reel 元件與物件池、轉動與停止演出
- [ ] 先用假資料讓轉輪停在指定盤面
- **驗收**：本機可以按 Spin，五軸依序停在指定結果

### 第二週 星期日：串接與 HUD
- [ ] `NetService`、Loading 場景（token、init、Asset Bundle 進度條）
- [ ] 串接 `/game/spin`、中獎連線、贏分跳動、下注調整
- [ ] SignalR 餘額更新、錯誤提示
- **驗收**：從錢包後台開局 → 進入遊戲 → 連續轉 50 局，餘額與錢包一致

### 第三週 星期六：演出與體驗
- [ ] 大獎特效（粒子 + DragonBones）、音效、自動轉
- [ ] 斷線重連與 `/game/last-round` 補演出
- [ ] 效能量測與優化（DrawCall、FPS）
- **驗收**：前端檢查清單全部通過

### 第三週 星期日：打包、熱更新與文件
- [ ] H5 放進 docker compose；Android APK 打包
- [ ] 熱更新 Demo
- [ ] README：玩法截圖、遊戲錄影 GIF、架構圖、RTP 結果、效能數據
- **驗收**：陌生人 `docker compose up` 後可以直接在瀏覽器玩；APK 可安裝

### 加分（之後再做）
- [ ] Free Spin（Scatter 3 個觸發 10 次免費轉）
- [ ] WebSocket + protobuf 取代 HTTP spin
- [ ] 多語系（繁中 / 英文）
- [ ] 遊戲紀錄頁（查詢最近 50 局的盤面與輸贏）

---

## 11. README 必須包含

1. 遊戲錄影 GIF（轉動、中獎、大獎）
2. 架構圖：平台錢包 ↔ 遊戲伺服器 ↔ Cocos 前端
3. 「結果由伺服器決定」的設計說明
4. RTP 模擬結果與調整過程
5. 補派彩機制（為什麼玩家的贏分不會遺失）
6. 前端效能數據：DrawCall、FPS、包體大小
7. 熱更新流程與 GIF
8. 素材授權來源

---

## 12. 完成後的履歷條目（數字填入實測值）

> **Cocos Slot Demo**（GitHub 連結 / H5 試玩連結）
> 以 Cocos Creator 3.8 + TypeScript 開發 5×3、10 線老虎機，包含轉輪演出、中獎連線、大獎特效、自動轉與斷線補演出；物件池與自動圖集將 DrawCall 控制在 ___ 以下，中階手機維持 60 FPS。輸出 H5 與 Android APK，並實作熱更新。另以 .NET 10 開發遊戲伺服器，伺服器端 RNG 與算分，模擬 1,000 萬局 RTP ___%；串接自建單一錢包，並有補派彩機制確保派彩不遺失。
