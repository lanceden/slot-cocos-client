/** 與 Slot.GameServer 對應的資料格式（JSON 為 camelCase；金額單位一律為「分」）。 */

export const SYMBOL_CODES = ['WILD', '7', 'BAR', 'BELL', 'MELON', 'CHERRY', 'LEMON'] as const;
export type SymbolCode = typeof SYMBOL_CODES[number];

/** 盤面：reels[軸][列]，列 0 = 上（與伺服器 SlotEngine 一致）。 */
export type Board = string[][];

export interface InitResponse {
    code: string;
    playerId: string;
    currency: string;
    balance: number;
    lineBets: number[];
    defaultLineBet: number;
    lines: number;
    /** 每條線：每一軸取第幾列（0 = 上）。 */
    paylines: number[][];
    symbols: string[];
    payTable: Record<string, number[]>;
}

export interface WinInfo {
    /** 1-based 連線編號。 */
    line: number;
    symbol: string;
    count: number;
    amount: number;
}

export interface SpinResponse {
    code: string;
    roundId?: string;
    reels?: Board;
    wins?: WinInfo[];
    totalBet?: number;
    totalWin?: number;
    balance?: number;
    /** 伺服器派彩尚未完成（交給補派彩 Worker），照常演出即可。 */
    settlePending?: boolean;
}

export interface RoundInfo {
    roundId: string;
    status: string; // BETTING / REJECTED / SETTLING / COMPLETED / ROLLED_BACK / SETTLE_FAILED / ROLLBACK_FAILED
    reels?: Board;
    wins?: WinInfo[];
    totalBet: number;
    totalWin?: number;
    balance?: number;
    settlePending: boolean;
    rejectCode?: string;
}

export interface LastRoundResponse {
    code: string; // OK / NO_ROUND / TOKEN_INVALID
    round?: RoundInfo;
}

export const ErrorCode = {
    OK: 'OK',
    TOKEN_INVALID: 'TOKEN_INVALID',
    INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
    SPIN_IN_PROGRESS: 'SPIN_IN_PROGRESS',
    WALLET_UNAVAILABLE: 'WALLET_UNAVAILABLE',
    INVALID_BET: 'INVALID_BET',
} as const;

/** 分 → 顯示用金額字串。 */
export function formatMoney(cents: number): string {
    const v = Math.round(cents) / 100;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
