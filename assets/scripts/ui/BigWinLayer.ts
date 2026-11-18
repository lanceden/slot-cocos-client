import { _decorator, Component, Label, Node, Tween, tween, Vec3 } from 'cc';
import { formatMoney } from '../net/Protocol';
const { ccclass, property } = _decorator;

/** 大獎演出（贏分 ≥ 20 倍總下注）：標題彈出 + 跳分，點擊可跳過。 */
@ccclass('BigWinLayer')
export class BigWinLayer extends Component {
    @property(Node) title: Node | null = null;
    @property(Label) amountLabel: Label | null = null;
    @property duration = 3.0;

    private resolve: (() => void) | null = null;
    private target = 0;
    private readonly counter = { v: 0 };

    onLoad() {
        this.node.active = false;
    }

    play(amount: number): Promise<void> {
        this.node.active = true;
        // 節點啟用後才註冊點擊：在 onLoad 註冊後立刻關閉節點，引擎的指標事件分派不會再啟用它
        this.node.off(Node.EventType.TOUCH_END, this.finish, this);
        this.node.on(Node.EventType.TOUCH_END, this.finish, this);
        this.target = amount;
        this.counter.v = 0;
        this.setAmount(0);
        if (this.title) {
            Tween.stopAllByTarget(this.title);
            this.title.setScale(0.2, 0.2, 1);
            tween(this.title).to(0.45, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .then(tween(this.title).repeatForever(
                    tween(this.title).to(0.5, { scale: new Vec3(1.08, 1.08, 1) }).to(0.5, { scale: new Vec3(1, 1, 1) })))
                .start();
        }
        Tween.stopAllByTarget(this.counter);
        tween(this.counter).to(this.duration, { v: amount }, {
            easing: 'quadOut', onUpdate: () => this.setAmount(this.counter.v),
        }).delay(1.0).call(() => this.finish()).start();
        return new Promise(r => { this.resolve = r; });
    }

    private finish() {
        if (!this.node.active) return;
        Tween.stopAllByTarget(this.counter);
        if (this.title) Tween.stopAllByTarget(this.title);
        this.setAmount(this.target);
        this.node.off(Node.EventType.TOUCH_END, this.finish, this);
        this.node.active = false;
        const r = this.resolve; this.resolve = null; r?.();
    }

    private setAmount(v: number) {
        if (this.amountLabel) this.amountLabel.string = formatMoney(v);
    }
}
