import { _decorator, Button, Component, Label, Node } from 'cc';
const { ccclass, property } = _decorator;

/** 錯誤提示 / 連線中遮罩。 */
@ccclass('DialogLayer')
export class DialogLayer extends Component {
    @property(Node) panel: Node | null = null;
    @property(Label) messageLabel: Label | null = null;
    @property(Button) okButton: Button | null = null;

    private onOk: (() => void) | null = null;

    onLoad() {
        this.okButton?.node.on(Button.EventType.CLICK, () => {
            const cb = this.onOk;
            this.hide();
            cb?.();
        });
        this.hide();
    }

    /** 顯示訊息；closable = false 時沒有確定鍵（例如「連線中…」）。 */
    show(message: string, closable = true, onOk?: () => void) {
        this.node.active = true;
        if (this.messageLabel) this.messageLabel.string = message;
        if (this.okButton) this.okButton.node.active = closable;
        this.onOk = onOk ?? null;
    }

    hide() {
        this.onOk = null;
        this.node.active = false;
    }

    get visible() { return this.node.active; }
}
