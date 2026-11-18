import { _decorator, Color, Component, Graphics, Vec3 } from 'cc';
import { WinInfo } from '../net/Protocol';
import { ReelController } from './ReelController';
const { ccclass, property } = _decorator;

const LINE_COLORS = ['#ffd23f', '#ff5f6d', '#56ccf2', '#7ee081', '#c77dff', '#ff9f1c', '#2ec4b6', '#f72585', '#a0c4ff', '#fdffb6']
    .map(h => new Color().fromHEX(h));

/** 中獎連線（Graphics）。節點需與 ReelController 在同一座標系（同一父節點、原點對齊）。 */
@ccclass('WinLineLayer')
export class WinLineLayer extends Component {
    @property(ReelController)
    reels: ReelController | null = null;

    @property(Graphics)
    graphics: Graphics | null = null;

    private paylines: number[][] = [];
    private wins: WinInfo[] = [];
    private cycleIndex = 0;
    private readonly cycle = () => this.showOne(this.wins[this.cycleIndex++ % this.wins.length]);

    setPaylines(paylines: number[][]) { this.paylines = paylines; }

    /** 先一次畫出全部中獎線，接著每 1.2 秒輪流閃單條（直到 clear）。 */
    show(wins: WinInfo[]) {
        this.clear();
        if (!wins.length) return;
        this.wins = wins;
        this.drawLines(wins);
        for (const w of wins) this.highlightCells(w);
        if (wins.length > 1) {
            this.cycleIndex = 0;
            this.schedule(this.cycle, 1.2, Number.MAX_SAFE_INTEGER, 1.2);
        }
    }

    clear() {
        this.unschedule(this.cycle);
        this.wins = [];
        this.graphics?.clear();
        this.reels?.clearHighlights();
    }

    private showOne(w: WinInfo) {
        this.reels?.clearHighlights();
        this.drawLines([w]);
        this.highlightCells(w);
    }

    private drawLines(wins: WinInfo[]) {
        const g = this.graphics, rc = this.reels;
        if (!g || !rc) return;
        g.clear();
        const p = new Vec3();
        for (const w of wins) {
            const rows = this.paylines[w.line - 1];
            if (!rows) continue;
            g.lineWidth = 8;
            g.strokeColor = LINE_COLORS[(w.line - 1) % LINE_COLORS.length];
            rows.forEach((row, i) => {
                const reel = rc.reels[i];
                reel.node.getPosition(p);
                const x = p.x, y = p.y + reel.rowY(row);
                if (i === 0) g.moveTo(x - reel.symbolSize * 0.55, y);
                g.lineTo(x, y);
                if (i === rows.length - 1) g.lineTo(x + reel.symbolSize * 0.55, y);
            });
            g.stroke();
        }
    }

    private highlightCells(w: WinInfo) {
        const rows = this.paylines[w.line - 1];
        const rc = this.reels;
        if (!rows || !rc) return;
        for (let i = 0; i < w.count; i++) rc.reels[i]?.highlight(rows[i]);
    }
}
