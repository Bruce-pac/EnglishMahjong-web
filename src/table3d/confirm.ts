/**
 * T4.2：亮词的两步确认。亮词不可撤回，所以第一次点只「上膛」，再点一次才提交；
 * 选区（推导结果的 key）一变就退回第一步——哪怕之后又变回原来的词。
 */
export class ConfirmGate {
  private key: string | null = null;
  private armedFor: string | null = null;

  /** 每次推导结果的 key 变了都要调。变了就退回第一步 */
  sync(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.armedFor = null;
  }

  get armed(): boolean {
    return this.armedFor !== null && this.armedFor === this.key;
  }

  /** 点一下按钮。返回 true = 这一下该提交了 */
  press(): boolean {
    if (this.armed) {
      this.armedFor = null;
      return true;
    }
    this.armedFor = this.key;
    return false;
  }

  reset(): void {
    this.armedFor = null;
  }
}
