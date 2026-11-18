# SeamlessWalletClient — Cocos Slot 前端

`SLOT_PLAN.md` 的 Cocos Creator 3.8.8 前端：5×3、10 線老虎機，串接 [`seamless-wallet-demo`](https://github.com/lanceden/seamless-wallet-demo) 的 `Slot.GameServer`（錢包 + 遊戲伺服器；那個 repo 的 `docker compose up` 也會用 nginx 提供這個專案的 H5 構建）。
**結果由伺服器決定**：client 只送每線下注額，照伺服器回傳的盤面與贏分演出。

## 執行

| 模式 | 網址 |
|---|---|
| 離線 demo（本機假伺服器，畫面標示 DEMO） | `http://localhost:7456/?mock=1` |
| 串接遊戲伺服器 | `http://localhost:7456/?token=<launch 回傳的 token>`（`api` 可省略） |

拿 token（錢包 API 在 8080）：

```bash
curl -X POST localhost:8080/admin/players -H 'Content-Type: application/json' -d '{"externalId":"cocos-dev-1"}'
curl -X POST localhost:8080/admin/players/cocos-dev-1/deposit -H 'Content-Type: application/json' -d '{"amount":100000}'
curl -X POST "localhost:8080/admin/players/cocos-dev-1/launch?provider=SLOT"
```

- `token`、`api` 會存進 localStorage，重新整理時沿用；網址參數優先。沒有 token 時自動進 demo。
- `api` 預設為「網頁同主機的 8081」（docker compose 的 `slot-gameserver`）；用 `dotnet run` 直接跑遊戲伺服器（預設 5000）時加 `&api=http://localhost:5000`。
- 錢包 launch 回傳的 `gameUrl` 指向 `http://localhost:8082/?token=...`（compose 為 H5 版預留，目前還沒部署）；開發時把 host:port 換成 `localhost:7456` 即可。
- 編輯器直接預覽 `Slot` 場景（跳過 Loading）也會進 demo。demo 模式可在 console 指定下一局：
  `__slot.api.nextBoard = [['BAR','7','LEMON'], ...]`（`[軸][列]`，列 0 = 上）。

## 結構

```
assets/
├─ scenes/Loading.scene        # token → /game/init → 載入 bundle "game"（進度條）→ Slot
├─ game/                       # Asset Bundle "game"
│  ├─ scenes/Slot.scene
│  └─ textures/symbols/        # 7 個符號 + Auto Atlas（symbols.pac）
└─ scripts/
   ├─ net/      Protocol（伺服器資料格式）、NetService（XHR、逾時、只重試查詢類）、MockApi（離線 demo）
   ├─ core/     GameState（餘額 / 下注 / 轉動中，事件通知 UI）
   ├─ slot/     Reel（固定 5 格節點池循環，不 instantiate）、ReelController、WinLineLayer、SlotGame（主流程）
   └─ ui/       BigWinLayer（≥ 20 倍下注）、DialogLayer
```

## 錯誤處理

| 情況 | 行為 |
|---|---|
| 快速連點 Spin | 按下即上鎖，只送出一次 |
| 餘額不足 | 不送出，提示並停止自動轉 |
| Token 過期 | 提示回平台重新進入 |
| spin 逾時 / 斷線 | **不重送**；顯示「連線中」，輪詢 `/game/last-round` 取回該局補演出；若最後一局仍是上一局，判定本局未成立並以伺服器餘額為準 |
| `WALLET_UNAVAILABLE` / `SPIN_IN_PROGRESS` / 其他 | 提示稍後再試，重新向伺服器取餘額 |
| `settlePending` | 照常演出，顯示「派彩處理中，稍後自動入帳」 |
| 切到背景再回來 | 不在轉動中時重新取餘額 |

## 素材

| 符號 | 來源 |
|---|---|
| WILD、7、BAR、CHERRY、MELON、LEMON | 第三方向量素材 `Nut_July_12.eps`（Illustrator 檔，作者欄位：Jik），來源：[magnific.com（素材 uuid `b752f13e-27ab-4772-8824-a5c6049e41ae`）](https://www.magnific.com/search?format=search&query=slot+bar#uuid=b752f13e-27ab-4772-8824-a5c6049e41ae)——**授權條款與標註格式待確認** |
| BELL | 第三方素材 `18894.jpg`（同包另附 `bell.eps`，無內嵌預覽）——取左上機台中軸的鈴鐺；**來源網址與授權條款待補** |

匯入方式：EPS 不能直接進 Cocos。取 EPS 內嵌的 1612×1612 TIFF 預覽，依 3×4 格線裁切、以底色距離柔性去背（外發光保留為半透明），
裁到圖案邊界後補成 256×256 正方形。BELL 取自 JPG（白灰漸層底）：從裁切框邊緣做「相鄰色差 ≤ 9」的漸進式 flood fill 去背，
遇到描邊就停，不會吃進鈴鐺內部的白色高光。換圖時用**同檔名**覆蓋 `assets/game/textures/symbols/*.png`，`.meta` 不動，UUID 與場景引用就會保留。
符號圖的 sprite-frame `trimType` 設為 `none`：轉輪格子是固定正方形，自動裁邊會讓非正方形的圖被拉伸。

## 尚未完成（對照 SLOT_PLAN）

- SignalR 餘額推播：錢包目前沒有給玩家連線的 hub，餘額以 init / spin / last-round 回傳為準
- 音效（`AudioService`）、大獎粒子與 DragonBones
- 手機實機 FPS、H5 包體大小量測、Android 打包、熱更新
