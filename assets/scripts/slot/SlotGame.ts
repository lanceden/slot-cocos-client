import { _decorator, Button, Component, game, Game, Label, Node, Tween, tween } from 'cc';
import { GameEvent, GameState } from '../core/GameState';
import { MockApi } from '../net/MockApi';
import { NetError } from '../net/NetService';
import { Board, ErrorCode, formatMoney, RoundInfo, SpinResponse, WinInfo } from '../net/Protocol';
import { BigWinLayer } from '../ui/BigWinLayer';
import { DialogLayer } from '../ui/DialogLayer';
import { ReelController } from './ReelController';
import { WinLineLayer } from './WinLineLayer';
const { ccclass, property } = _decorator;

/** 一局要演出的內容（不論來自 spin 回應、斷線補演出或失敗時的「停回原盤面」）。 */
interface Outcome {
    board: Board;
    wins: WinInfo[];
    totalWin: number;
    totalBet: number;
    balance?: number;
    /** 演出後要提示的訊息；有訊息時自動轉會停止。 */
    message?: string;
    /** 盤面停止後要重新跟伺服器要餘額（以伺服器為準）。 */
    refreshBalance?: boolean;
    settlePending?: boolean;
}

const MIN_SPIN_SECONDS = 0.8;
const BIG_WIN_MULTIPLIER = 20;
const AUTO_OPTIONS = [10, 50, 100];
const RECOVER_ATTEMPTS = 10;
const RECOVER_INTERVAL_MS = 2000;

/**
 * Slot 場景主流程：HUD ↔ GameState ↔ GameApi ↔ 演出。
 * 原則：client 只送下注額，盤面與贏分完全照伺服器回傳演出。
 */
@ccclass('SlotGame')
export class SlotGame extends Component {
    @property(ReelController) reels: ReelController | null = null;
    @property(WinLineLayer) winLines: WinLineLayer | null = null;

    @property(Label) balanceLabel: Label | null = null;
    @property(Label) lineBetLabel: Label | null = null;
    @property(Label) totalBetLabel: Label | null = null;
    @property(Label) winLabel: Label | null = null;
    @property(Label) statusLabel: Label | null = null;
    @property(Label) autoLabel: Label | null = null;

    @property(Button) spinButton: Button | null = null;
    @property(Button) autoButton: Button | null = null;
    @property(Button) autoCountButton: Button | null = null;
    @property(Button) betMinusButton: Button | null = null;
    @property(Button) betPlusButton: Button | null = null;

    @property(BigWinLayer) bigWin: BigWinLayer | null = null;
    @property(DialogLayer) dialog: DialogLayer | null = null;
    @property(Node) demoBadge: Node | null = null;

    private board: Board = [];
    private autoIndex = 0;
    private autoLeft = 0;
    private tokenDead = false;
    private readonly winCounter = { v: 0 };
    private readonly gs = GameState.inst;

    onLoad() {
        this.gs.on(GameEvent.BALANCE, this.renderBalance, this);
        this.gs.on(GameEvent.LINE_BET, this.renderBet, this);
        this.gs.on(GameEvent.SPINNING, this.renderButtons, this);
        this.spinButton?.node.on(Button.EventType.CLICK, this.onSpinClicked, this);
        this.autoButton?.node.on(Button.EventType.CLICK, this.onAutoClicked, this);
        this.autoCountButton?.node.on(Button.EventType.CLICK, this.onAutoCountClicked, this);
        this.betMinusButton?.node.on(Button.EventType.CLICK, () => this.gs.stepBet(-1));
        this.betPlusButton?.node.on(Button.EventType.CLICK, () => this.gs.stepBet(1));
        game.on(Game.EVENT_SHOW, this.onAppShow, this);
    }

    onDestroy() {
        this.gs.targetOff(this);
        game.off(Game.EVENT_SHOW, this.onAppShow, this);
    }

    async start() {
        // 直接從編輯器打開 Slot 場景（沒經過 Loading）時，用離線 demo
        if (!this.gs.api) {
            this.gs.api = new MockApi();
            (globalThis as any).__slot = this.gs; // 開發用：__slot.api.nextBoard = [[...],...] 指定下一局
            this.gs.applyInit(await this.gs.api.init());
        }
        if (this.demoBadge) this.demoBadge.active = this.gs.api.isMock;
        this.winLines?.setPaylines(this.gs.config?.paylines ?? []);
        this.board = [['7', 'BAR', 'BELL'], ['CHERRY', 'WILD', 'LEMON'], ['MELON', '7', 'BAR'], ['BELL', 'LEMON', 'CHERRY'], ['BAR', 'MELON', 'WILD']];
        this.reels?.setBoard(this.board);
        this.setWin(0);
        this.setStatus('');
        this.renderBalance(); this.renderBet(); this.renderAuto(); this.renderButtons();
        await this.replayUnfinishedRound();
    }

    // ───────────── 轉一局 ─────────────

    private onSpinClicked() {
        if (this.autoLeft > 0) { this.stopAuto(); return; }
        void this.spinOnce();
    }

    private async spinOnce() {
        const gs = this.gs;
        if (gs.spinning || !gs.api) return;
        // token 已失效（例如切回前景時重新取餘額才發現）：不能再下注，要明確告訴玩家，而不是按了沒反應
        if (this.tokenDead) { this.stopAuto(); this.dialog?.show('遊戲連線已過期，請回到平台重新進入遊戲'); return; }
        if (gs.balance < gs.totalBet) { this.stopAuto(); this.dialog?.show('餘額不足'); return; }

        gs.spinning = true; // 先上鎖：快速連點不會重複下注
        this.winLines?.clear();
        this.setWin(0);
        this.setStatus('');
        const lineBet = gs.lineBet, totalBet = gs.totalBet;
        gs.balance -= totalBet; // 預扣顯示；之後一律以伺服器回傳為準
        this.reels?.spinAll();
        const minSpin = wait(MIN_SPIN_SECONDS * 1000);

        let outcome: Outcome;
        try {
            const res = await gs.api.spin(lineBet);
            await minSpin;
            outcome = this.fromSpinResponse(res, totalBet);
        } catch (e) {
            // 逾時 / 斷線：spin 不重送，改查最後一局（伺服器會把這局做完）
            await minSpin;
            outcome = await this.recover(totalBet, e);
        }
        await this.present(outcome);
        gs.spinning = false;
        this.continueAuto(outcome);
    }

    private fromSpinResponse(res: SpinResponse, totalBet: number): Outcome {
        const keep = { board: this.board, wins: [], totalWin: 0, totalBet };
        switch (res.code) {
            case ErrorCode.OK:
                this.gs.lastRoundId = res.roundId ?? this.gs.lastRoundId;
                return {
                    board: res.reels!, wins: res.wins ?? [], totalWin: res.totalWin ?? 0, totalBet: res.totalBet ?? totalBet,
                    balance: res.balance, settlePending: res.settlePending,
                };
            case ErrorCode.TOKEN_INVALID:
                this.tokenDead = true;
                // token 已失效，無法向伺服器重新取餘額；這局根本沒成立，直接把預扣的下注額還原
                return { ...keep, balance: this.gs.balance + totalBet, message: '遊戲連線已過期，請回到平台重新進入遊戲', refreshBalance: false };
            case ErrorCode.INSUFFICIENT_BALANCE:
                return { ...keep, balance: res.balance, message: '餘額不足', refreshBalance: res.balance == null };
            case ErrorCode.SPIN_IN_PROGRESS:
                return { ...keep, message: '上一局仍在處理中，請稍候再試', refreshBalance: true };
            case ErrorCode.WALLET_UNAVAILABLE:
                return { ...keep, message: '系統忙碌，請稍後再試', refreshBalance: true };
            default:
                return { ...keep, balance: res.balance, message: `下注失敗（${res.code}），請稍後再試`, refreshBalance: res.balance == null };
        }
    }

    /** 斷線補演出：顯示「連線中」，輪詢 /game/last-round 直到拿到這一局的結果。 */
    private async recover(totalBet: number, err: unknown): Promise<Outcome> {
        console.warn('[SlotGame] spin failed, recovering via last-round', err);
        const keep = { board: this.board, wins: [] as WinInfo[], totalWin: 0, totalBet };
        this.dialog?.show('連線中…', false);
        try {
            for (let i = 0; i < RECOVER_ATTEMPTS; i++) {
                if (i > 0) await wait(RECOVER_INTERVAL_MS);
                let res;
                try { res = await this.gs.api!.lastRound(); } catch (e) { if (e instanceof NetError) continue; throw e; }
                if (res.code === ErrorCode.TOKEN_INVALID) {
                    this.tokenDead = true;
                    return { ...keep, balance: this.gs.balance + totalBet, message: '遊戲連線已過期，請回到平台重新進入遊戲' };
                }
                const round = res.round;
                // 最後一局還是上一局 → 這次的下注根本沒到伺服器
                if (!round || round.roundId === this.gs.lastRoundId)
                    return { ...keep, message: '連線中斷，本局未成立', refreshBalance: true };
                if (round.status === 'BETTING') continue; // 伺服器還在處理
                return this.fromRound(round, keep);
            }
            return { ...keep, message: '無法連線到伺服器，請檢查網路後重新整理', refreshBalance: true };
        } finally {
            this.dialog?.hide();
        }
    }

    private fromRound(round: RoundInfo, keep: Outcome): Outcome {
        this.gs.lastRoundId = round.roundId;
        if (round.reels) {
            return {
                board: round.reels, wins: round.wins ?? [], totalWin: round.totalWin ?? 0, totalBet: round.totalBet,
                balance: round.balance ?? undefined, settlePending: round.settlePending, refreshBalance: round.balance == null,
            };
        }
        const msg = round.status === 'REJECTED' ? `下注未成功（${round.rejectCode ?? round.status}）` : '本局已取消，下注已退回';
        return { ...keep, message: msg, refreshBalance: true };
    }

    /** 停輪 → 連線 → 跳分 → 大獎 → 提示。 */
    private async present(o: Outcome) {
        await this.reels?.stopAt(o.board);
        this.board = o.board;
        if (o.balance != null) this.gs.balance = o.balance;
        if (o.refreshBalance) await this.refreshBalance();

        if (o.wins.length) this.winLines?.show(o.wins);
        if (o.totalWin > 0) {
            if (o.totalWin >= o.totalBet * BIG_WIN_MULTIPLIER && this.bigWin) {
                this.setWin(o.totalWin);
                await this.bigWin.play(o.totalWin);
            } else {
                await this.countWin(o.totalWin);
            }
        }
        if (o.settlePending) this.setStatus('派彩處理中，稍後自動入帳');
        if (o.message) { this.stopAuto(); this.dialog?.show(o.message); }
    }

    // ───────────── 自動轉 ─────────────

    private onAutoClicked() {
        if (this.autoLeft > 0) { this.stopAuto(); return; }
        if (this.gs.spinning || this.tokenDead) return;
        this.autoLeft = AUTO_OPTIONS[this.autoIndex];
        this.renderAuto();
        this.nextAuto();
    }

    private onAutoCountClicked() {
        if (this.autoLeft > 0) return;
        this.autoIndex = (this.autoIndex + 1) % AUTO_OPTIONS.length;
        this.renderAuto();
    }

    private continueAuto(o: Outcome) {
        if (this.autoLeft <= 0) return;
        if (o.totalWin >= o.totalBet * BIG_WIN_MULTIPLIER) { this.stopAuto(); return; } // 大獎自動停
        this.scheduleOnce(() => this.nextAuto(), o.wins.length ? 1.0 : 0.3);
    }

    private nextAuto() {
        if (this.autoLeft <= 0 || this.gs.spinning) return;
        if (this.gs.balance < this.gs.totalBet) { this.stopAuto(); this.dialog?.show('餘額不足，已停止自動轉'); return; }
        this.autoLeft--;
        this.renderAuto();
        void this.spinOnce();
    }

    private stopAuto() {
        this.autoLeft = 0;
        this.renderAuto();
        this.renderButtons();
    }

    // ───────────── 斷線 / 背景 ─────────────

    /** 進場時若最後一局還沒演給玩家看過（例如上次轉到一半關掉），補演出一次。 */
    private async replayUnfinishedRound() {
        const api = this.gs.api;
        if (!api || api.isMock) return;
        try {
            const res = await api.lastRound();
            if (res.code === ErrorCode.OK && res.round) {
                this.gs.lastRoundId = res.round.roundId;
                if (res.round.reels) { this.board = res.round.reels; this.reels?.setBoard(this.board); }
                if (res.round.settlePending) this.setStatus('上一局派彩處理中，稍後自動入帳');
            }
        } catch (e) {
            console.warn('[SlotGame] last-round on start failed', e);
        }
    }

    private onAppShow() {
        if (!this.gs.spinning) void this.refreshBalance();
    }

    private async refreshBalance() {
        const api = this.gs.api;
        if (!api || this.tokenDead) return;
        try {
            const init = await api.init();
            if (init.code === ErrorCode.OK) this.gs.balance = init.balance;
            else if (init.code === ErrorCode.TOKEN_INVALID) this.tokenDead = true;
        } catch (e) {
            console.warn('[SlotGame] balance refresh failed', e);
        }
    }

    // ───────────── 顯示 ─────────────

    private countWin(amount: number): Promise<void> {
        Tween.stopAllByTarget(this.winCounter);
        this.winCounter.v = 0;
        const duration = Math.min(2.0, 0.6 + amount / (this.gs.totalBet * 10));
        return new Promise(resolve => {
            tween(this.winCounter).to(duration, { v: amount }, {
                easing: 'quadOut', onUpdate: () => this.setWin(this.winCounter.v),
            }).call(() => { this.setWin(amount); resolve(); }).start();
        });
    }

    private setWin(v: number) { if (this.winLabel) this.winLabel.string = formatMoney(v); }
    private setStatus(s: string) { if (this.statusLabel) this.statusLabel.string = s; }

    private renderBalance() { if (this.balanceLabel) this.balanceLabel.string = formatMoney(this.gs.balance); }

    private renderBet() {
        if (this.lineBetLabel) this.lineBetLabel.string = formatMoney(this.gs.lineBet);
        if (this.totalBetLabel) this.totalBetLabel.string = formatMoney(this.gs.totalBet);
    }

    private renderAuto() {
        if (!this.autoLabel) return;
        this.autoLabel.string = this.autoLeft > 0 ? `STOP\n${this.autoLeft}` : `AUTO\n×${AUTO_OPTIONS[this.autoIndex]}`;
    }

    private renderButtons() {
        const busy = this.gs.spinning;
        const auto = this.autoLeft > 0;
        if (this.spinButton) this.spinButton.interactable = !busy || auto;
        if (this.betMinusButton) this.betMinusButton.interactable = !busy && !auto;
        if (this.betPlusButton) this.betPlusButton.interactable = !busy && !auto;
        if (this.autoCountButton) this.autoCountButton.interactable = !busy && !auto;
    }
}

function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
