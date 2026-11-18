import { _decorator, assetManager, AssetManager, Button, Component, director, Label, ProgressBar } from 'cc';
import { GameState } from './core/GameState';
import { MockApi } from './net/MockApi';
import { GameApi, HttpGameApi, queryParam, resolveLaunchParams } from './net/NetService';
import { ErrorCode } from './net/Protocol';
const { ccclass, property } = _decorator;

const GAME_BUNDLE = 'game';
const SLOT_SCENE = 'Slot';

/**
 * Loading 場景：讀 URL 的 token → /game/init → 載入 asset bundle "game"（顯示進度）→ 進入 Slot 場景。
 * 沒有 token 或網址帶 ?mock=1 時進入離線 demo（結果由本機假伺服器產生，畫面會標示 DEMO）。
 */
@ccclass('Loading')
export class Loading extends Component {
    @property(ProgressBar) progressBar: ProgressBar | null = null;
    @property(Label) statusLabel: Label | null = null;
    @property(Button) retryButton: Button | null = null;

    onLoad() {
        this.retryButton?.node.on(Button.EventType.CLICK, () => void this.boot());
    }

    start() {
        void this.boot();
    }

    private async boot() {
        if (this.retryButton) this.retryButton.node.active = false;
        this.setProgress(0, '連線中…');

        const { token, apiBase } = resolveLaunchParams();
        const mock = queryParam('mock') === '1' || !token;
        const api: GameApi = mock ? new MockApi() : new HttpGameApi(apiBase, token!);
        const gs = GameState.inst;
        gs.api = api;
        if (mock) (globalThis as any).__slot = gs; // 開發用：可從 console 指定下一局盤面

        try {
            const init = await api.init();
            if (init.code !== ErrorCode.OK) {
                this.fail(init.code === ErrorCode.TOKEN_INVALID
                    ? '遊戲連線已過期，請回到平台重新進入遊戲'
                    : `無法取得玩家資料（${init.code}）`, init.code !== ErrorCode.TOKEN_INVALID);
                return;
            }
            gs.applyInit(init);
        } catch (e) {
            console.error('[Loading] init failed', e);
            this.fail(`無法連線到遊戲伺服器\n${apiBase}`, true);
            return;
        }

        this.setProgress(0.1, '載入資源…');
        let bundle: AssetManager.Bundle;
        try {
            bundle = await new Promise((resolve, reject) =>
                assetManager.loadBundle(GAME_BUNDLE, (err, b) => err ? reject(err) : resolve(b)));
        } catch (e) {
            console.error('[Loading] bundle failed', e);
            this.fail('資源載入失敗', true);
            return;
        }

        this.setProgress(0.2, '載入資源…');
        bundle.loadScene(SLOT_SCENE,
            (done, total) => this.setProgress(0.2 + 0.8 * (total ? done / total : 0), '載入資源…'),
            (err, scene) => {
                if (err) { console.error('[Loading] scene failed', err); this.fail('資源載入失敗', true); return; }
                this.setProgress(1, '');
                director.runScene(scene);
            });
    }

    private setProgress(p: number, text: string) {
        if (this.progressBar) this.progressBar.progress = Math.max(this.progressBar.progress, Math.min(1, p));
        if (this.statusLabel) this.statusLabel.string = text || `${Math.round(p * 100)}%`;
    }

    private fail(message: string, canRetry: boolean) {
        if (this.statusLabel) this.statusLabel.string = message;
        if (this.retryButton) this.retryButton.node.active = canRetry;
        if (this.progressBar) this.progressBar.progress = 0;
    }
}
