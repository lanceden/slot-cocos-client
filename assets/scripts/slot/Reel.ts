import { _decorator, Component, Node, Sprite, SpriteFrame, Tween, tween, UITransform, Vec3 } from 'cc';
import { SYMBOL_CODES } from '../net/Protocol';
const { ccclass, property } = _decorator;

interface Cell { node: Node; sprite: Sprite; code: string; }

type ReelState = 'idle' | 'spinning' | 'stopping' | 'settling';

/**
 * 單一轉軸。固定 5 個符號節點（可見 3 格 + 上下各 1 格緩衝）循環使用：
 * 轉動時只移動位置、換 spriteFrame，**不 instantiate / destroy**。
 *
 * 停止方式：收到目標盤面後，接下來從上方進場的 4 格依序是「下、中、上、緩衝」，
 * 4 次輪替後目標剛好落在可見的 3 格，再用 backOut 補間回彈到定位。
 */
@ccclass('Reel')
export class Reel extends Component {
    @property({ type: [SpriteFrame], tooltip: '依序對應 WILD, 7, BAR, BELL, MELON, CHERRY, LEMON' })
    symbolFrames: SpriteFrame[] = [];

    @property cellHeight = 150;
    @property symbolSize = 136;
    @property maxSpeed = 2800;
    @property accelTime = 0.18;

    private cells: Cell[] = [];
    private offset = 0;
    private spinTime = 0;
    private state: ReelState = 'idle';
    private feed: string[] = [];
    private stopResolve: (() => void) | null = null;
    private readonly settle = { v: 0 };
    private readonly tmp = new Vec3();

    get isIdle() { return this.state === 'idle'; }

    onLoad() {
        this.buildCells();
    }

    private buildCells() {
        if (this.cells.length) return;
        for (let i = 0; i < 5; i++) {
            const node = new Node(`Cell${i}`);
            node.layer = this.node.layer;
            node.addComponent(UITransform).setContentSize(this.symbolSize, this.symbolSize);
            const sprite = node.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.node.addChild(node);
            const cell: Cell = { node, sprite, code: '' };
            this.setCell(cell, randomCode());
            this.cells.push(cell);
        }
        this.layout();
    }

    /** 直接擺出盤面（不演出）。col = [上, 中, 下]。 */
    setSymbols(col: string[]) {
        this.buildCells();
        for (let row = 0; row < 3; row++) this.setCell(this.cells[row + 1], col[row]);
        this.offset = 0;
        this.layout();
    }

    /** 可見列（0 = 上）的符號節點，給中獎演出用。 */
    cellNode(row: number): Node { return this.cells[row + 1].node; }

    /** 可見列（0 = 上）中心點在本軸座標系的 y。 */
    rowY(row: number) { return (1 - row) * this.cellHeight; }

    spin() {
        this.clearHighlights();
        Tween.stopAllByTarget(this.settle);
        if (this.stopResolve) { this.stopResolve(); this.stopResolve = null; }
        this.feed.length = 0;
        this.spinTime = 0;
        this.state = 'spinning';
    }

    /** 停在指定的 [上, 中, 下]。轉軸本來就沒在轉時直接擺好。 */
    stopAt(col: string[]): Promise<void> {
        if (this.state === 'idle') { this.setSymbols(col); return Promise.resolve(); }
        if (this.state !== 'spinning') return Promise.resolve();
        this.feed = [col[2], col[1], col[0], randomCode()];
        this.state = 'stopping';
        return new Promise(resolve => { this.stopResolve = resolve; });
    }

    update(dt: number) {
        if (this.state === 'spinning' || this.state === 'stopping') {
            this.spinTime += dt;
            const speed = this.maxSpeed * Math.min(1, this.spinTime / this.accelTime);
            this.offset += speed * dt;
            while (this.offset >= this.cellHeight) {
                this.offset -= this.cellHeight;
                this.rotate();
                if (this.state === 'stopping' && this.feed.length === 0) { this.beginSettle(); break; }
            }
            this.layout();
        } else if (this.state === 'settling') {
            this.offset = this.settle.v;
            this.layout();
        }
    }

    private rotate() {
        const cell = this.cells.pop()!;
        this.cells.unshift(cell);
        this.setCell(cell, this.state === 'stopping' && this.feed.length ? this.feed.shift()! : randomCode());
    }

    private beginSettle() {
        this.state = 'settling';
        this.settle.v = this.offset;
        tween(this.settle)
            .to(0.3, { v: 0 }, { easing: 'backOut' })
            .call(() => {
                this.offset = 0;
                this.layout();
                this.state = 'idle';
                const r = this.stopResolve; this.stopResolve = null; r?.();
            })
            .start();
    }

    private layout() {
        for (let i = 0; i < this.cells.length; i++) {
            this.tmp.set(0, (2 - i) * this.cellHeight - this.offset, 0);
            this.cells[i].node.setPosition(this.tmp);
        }
    }

    private setCell(cell: Cell, code: string) {
        cell.code = code;
        const idx = SYMBOL_CODES.indexOf(code as any);
        cell.sprite.spriteFrame = this.symbolFrames[idx >= 0 ? idx : SYMBOL_CODES.length - 1] ?? null;
    }

    /** 中獎格脈動。 */
    highlight(row: number) {
        const n = this.cellNode(row);
        Tween.stopAllByTarget(n);
        n.setScale(1, 1, 1);
        tween(n).repeatForever(
            tween(n).to(0.22, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'sineOut' })
                .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' }),
        ).start();
    }

    clearHighlights() {
        for (const c of this.cells) { Tween.stopAllByTarget(c.node); c.node.setScale(1, 1, 1); }
    }
}

function randomCode(): string {
    return SYMBOL_CODES[Math.floor(Math.random() * SYMBOL_CODES.length)];
}
