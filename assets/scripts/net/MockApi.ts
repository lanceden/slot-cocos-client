import { GameApi } from './NetService';
import { Board, InitResponse, LastRoundResponse, RoundInfo, SpinResponse, SYMBOL_CODES, WinInfo } from './Protocol';

/**
 * 離線 demo 用的假伺服器（網址加 ?mock=1，或沒有 token 時）。
 * 正式遊戲「結果永遠由伺服器決定」；這裡只是讓前端演出可以在沒有後端時開發與展示，畫面上會標示 DEMO。
 */
const PAYLINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
const PAY: Record<string, number[]> = {
    '7': [20, 100, 500], BAR: [10, 40, 150], BELL: [6, 20, 80],
    MELON: [4, 12, 40], CHERRY: [2, 6, 20], LEMON: [1, 4, 12],
};
/** 權重：高分符號少。 */
const WEIGHTS: Record<string, number> = { WILD: 2, '7': 2, BAR: 3, BELL: 4, MELON: 5, CHERRY: 6, LEMON: 7 };

function pick(): string {
    const total = SYMBOL_CODES.reduce((s, c) => s + WEIGHTS[c], 0);
    let r = Math.random() * total;
    for (const c of SYMBOL_CODES) { r -= WEIGHTS[c]; if (r < 0) return c; }
    return 'LEMON';
}

export function evaluate(board: Board, lineBet: number): WinInfo[] {
    const wins: WinInfo[] = [];
    PAYLINES.forEach((rows, i) => {
        const syms = rows.map((row, reel) => board[reel][row]);
        const target = syms.find(s => s !== 'WILD') ?? '7';
        let count = 0;
        while (count < 5 && (syms[count] === target || syms[count] === 'WILD')) count++;
        if (count >= 3) wins.push({ line: i + 1, symbol: target, count, amount: PAY[target][count - 3] * lineBet });
    });
    return wins;
}

export class MockApi implements GameApi {
    readonly isMock = true;
    private balance = 1_000_000;
    private seq = 0;
    private last: RoundInfo | null = null;
    /** 指定下一局的盤面（測試演出用），用完即清。 */
    nextBoard: Board | null = null;

    async init(): Promise<InitResponse> {
        await delay(200);
        return {
            code: 'OK', playerId: 'demo', currency: 'TWD', balance: this.balance,
            lineBets: [100, 200, 500, 1000, 2000, 5000], defaultLineBet: 100, lines: 10,
            paylines: PAYLINES, symbols: [...SYMBOL_CODES], payTable: PAY,
        };
    }

    async spin(lineBet: number): Promise<SpinResponse> {
        await delay(150 + Math.random() * 350);
        const totalBet = lineBet * 10;
        if (this.balance < totalBet) return { code: 'INSUFFICIENT_BALANCE', balance: this.balance, totalBet };
        const board: Board = this.nextBoard ?? Array.from({ length: 5 }, () => [pick(), pick(), pick()]);
        this.nextBoard = null;
        const wins = evaluate(board, lineBet);
        const totalWin = wins.reduce((s, w) => s + w.amount, 0);
        this.balance += totalWin - totalBet;
        const roundId = `DEMO-${++this.seq}`;
        this.last = { roundId, status: 'COMPLETED', reels: board, wins, totalBet, totalWin, balance: this.balance, settlePending: false };
        return { code: 'OK', roundId, reels: board, wins, totalBet, totalWin, balance: this.balance, settlePending: false };
    }

    async lastRound(): Promise<LastRoundResponse> {
        await delay(100);
        return this.last ? { code: 'OK', round: this.last } : { code: 'NO_ROUND' };
    }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
