import { EventTarget } from 'cc';
import { GameApi } from '../net/NetService';
import { InitResponse } from '../net/Protocol';

export const GameEvent = {
    BALANCE: 'balance',
    LINE_BET: 'line-bet',
    SPINNING: 'spinning',
} as const;

/**
 * 全域遊戲狀態（Loading 場景建立，Slot 場景使用）。
 * 只存「資料」；UI 透過事件更新，演出邏輯不寫在這裡。
 */
export class GameState extends EventTarget {
    private static _inst: GameState | null = null;
    static get inst(): GameState {
        if (!this._inst) this._inst = new GameState();
        return this._inst;
    }

    api: GameApi | null = null;
    config: InitResponse | null = null;

    private _balance = 0;
    private _lineBet = 0;
    private _spinning = false;
    /** 最後一個已知（已演出或已確認）的回合，斷線補演出時用來判斷 spin 是否真的成立。 */
    lastRoundId: string | null = null;

    get balance() { return this._balance; }
    set balance(v: number) { if (v !== this._balance) { this._balance = v; this.emit(GameEvent.BALANCE, v); } }

    get lineBet() { return this._lineBet; }
    set lineBet(v: number) { if (v !== this._lineBet) { this._lineBet = v; this.emit(GameEvent.LINE_BET, v); } }

    get spinning() { return this._spinning; }
    set spinning(v: boolean) { if (v !== this._spinning) { this._spinning = v; this.emit(GameEvent.SPINNING, v); } }

    get lines() { return this.config?.lines ?? 10; }
    get totalBet() { return this._lineBet * this.lines; }

    applyInit(init: InitResponse) {
        this.config = init;
        this.balance = init.balance;
        if (init.lineBets.indexOf(this._lineBet) < 0) this.lineBet = init.defaultLineBet;
    }

    /** 下注檔位 +1 / -1（夾在範圍內）。 */
    stepBet(dir: 1 | -1) {
        const bets = this.config?.lineBets ?? [];
        if (!bets.length) return;
        const i = Math.max(0, bets.indexOf(this._lineBet));
        this.lineBet = bets[Math.min(bets.length - 1, Math.max(0, i + dir))];
    }
}
