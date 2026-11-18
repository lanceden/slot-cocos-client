import { _decorator, Component } from 'cc';
import { Board } from '../net/Protocol';
import { Reel } from './Reel';
const { ccclass, property } = _decorator;

/** 五軸的演出控制：只管「怎麼轉、停在哪」，不知道結果從哪來。 */
@ccclass('ReelController')
export class ReelController extends Component {
    @property({ type: [Reel] })
    reels: Reel[] = [];

    @property({ tooltip: '每軸停止間隔（秒）' })
    stopInterval = 0.15;

    spinAll() {
        for (const r of this.reels) r.spin();
    }

    /** 由左到右依序停止；全部回彈完成後 resolve。 */
    stopAt(board: Board): Promise<void> {
        return Promise.all(this.reels.map((reel, i) => new Promise<void>(resolve => {
            this.scheduleOnce(() => reel.stopAt(board[i]).then(resolve), i * this.stopInterval);
        }))).then(() => undefined);
    }

    setBoard(board: Board) {
        this.reels.forEach((r, i) => r.setSymbols(board[i]));
    }

    clearHighlights() {
        for (const r of this.reels) r.clearHighlights();
    }
}
