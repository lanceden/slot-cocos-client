import { sys } from 'cc';
import { InitResponse, LastRoundResponse, SpinResponse } from './Protocol';

export type NetErrorKind = 'timeout' | 'network' | 'http';

/** 連線層錯誤。HTTP 401（TOKEN_INVALID）不算錯誤：伺服器有回 JSON，交給呼叫端看 code。 */
export class NetError extends Error {
    constructor(public readonly kind: NetErrorKind, public readonly status = 0, message = '') {
        super(message || `${kind}${status ? ' ' + status : ''}`);
    }
}

/** 遊戲端點。正式實作走 HTTP；離線 demo 用 MockApi（見 MockApi.ts）。 */
export interface GameApi {
    readonly isMock: boolean;
    init(): Promise<InitResponse>;
    /** 下注並轉一次。**不自動重送**：逾時/斷線時呼叫端要改用 lastRound() 取回結果。 */
    spin(lineBet: number): Promise<SpinResponse>;
    lastRound(): Promise<LastRoundResponse>;
}

/** 讀網址參數（H5）。原生平台沒有 location，回傳 null。 */
export function queryParam(name: string): string | null {
    try {
        if (typeof window === 'undefined' || !window.location) return null;
        return new URLSearchParams(window.location.search).get(name);
    } catch {
        return null;
    }
}

const STORAGE_TOKEN = 'slot.token';
const STORAGE_API = 'slot.api';
/** 遊戲伺服器的 port（docker compose 的 slot-gameserver）。 */
export const DEFAULT_API_PORT = 8081;

/** 沒指定 api 時：與網頁同主機（本機或區網 IP 皆可）的 8081。 */
function defaultApiBase(): string {
    try {
        if (typeof window !== 'undefined' && window.location && window.location.hostname)
            return `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.hostname}:${DEFAULT_API_PORT}`;
    } catch { /* 原生平台 */ }
    return `http://localhost:${DEFAULT_API_PORT}`;
}

/**
 * 決定 token 與 API 位址：網址參數優先（平台開局帶 ?token=），其次是上次存下的值（重新整理 / 編輯器預覽用）。
 */
export function resolveLaunchParams(): { token: string | null; apiBase: string } {
    const urlToken = queryParam('token');
    const urlApi = queryParam('api');
    if (urlToken) sys.localStorage.setItem(STORAGE_TOKEN, urlToken);
    if (urlApi) sys.localStorage.setItem(STORAGE_API, urlApi);
    const token = urlToken || sys.localStorage.getItem(STORAGE_TOKEN);
    const apiBase = (urlApi || sys.localStorage.getItem(STORAGE_API) || defaultApiBase()).replace(/\/+$/, '');
    return { token, apiBase };
}

/** 封裝 HTTP、逾時與重試。用 XMLHttpRequest：Web 與原生（jsb）都支援。 */
export class HttpGameApi implements GameApi {
    readonly isMock = false;

    constructor(private readonly apiBase: string, private readonly token: string,
                private readonly timeoutMs = 10000) {}

    init(): Promise<InitResponse> {
        return this.withRetry(() => this.request<InitResponse>('POST', '/game/init', { token: this.token }));
    }

    spin(lineBet: number): Promise<SpinResponse> {
        return this.request<SpinResponse>('POST', '/game/spin', { token: this.token, lineBet });
    }

    lastRound(): Promise<LastRoundResponse> {
        return this.withRetry(() =>
            this.request<LastRoundResponse>('GET', '/game/last-round?token=' + encodeURIComponent(this.token)));
    }

    /** 只有查詢類（init / last-round）會重試；spin 絕不重送。 */
    private async withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
        let last: unknown;
        for (let i = 0; i < attempts; i++) {
            try {
                return await fn();
            } catch (e) {
                last = e;
                if (e instanceof NetError && e.kind === 'http' && e.status < 500) throw e;
                if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
            }
        }
        throw last;
    }

    private request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, this.apiBase + path, true);
            xhr.timeout = this.timeoutMs;
            if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = () => {
                let json: any = null;
                try { json = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { /* 非 JSON */ }
                // 伺服器的業務錯誤（含 401 TOKEN_INVALID）都帶 JSON code，交給呼叫端判斷
                if (json && typeof json.code === 'string') resolve(json as T);
                else reject(new NetError('http', xhr.status, `HTTP ${xhr.status}`));
            };
            xhr.ontimeout = () => reject(new NetError('timeout'));
            xhr.onerror = () => reject(new NetError('network'));
            xhr.send(body === undefined ? null : JSON.stringify(body));
        });
    }
}
