export class CreditMeteredRpc {
  constructor(url, { fetchImpl = fetch, now = () => Date.now(), dailyCreditBudget = Infinity } = {}) {
    this.url = new URL(url).toString();
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sequence = 0;
    this.dailyCreditBudget = dailyCreditBudget;
    this.day = Math.floor(now() / 86_400_000);
    this.credits = 0;
    this.requests = 0;
  }

  charge(method) {
    const day = Math.floor(this.now() / 86_400_000);
    if (day !== this.day) {
      this.day = day;
      this.credits = 0;
      this.requests = 0;
    }
    this.credits += method === "eth_getLogs" ? 255 : method === "eth_blockNumber" ? 80 : 80;
    this.requests += 1;
  }

  cost(method) {
    return method === "eth_getLogs" ? 255 : method === "eth_blockNumber" ? 80 : 80;
  }

  async call(method, params = []) {
    const day = Math.floor(this.now() / 86_400_000);
    if (day !== this.day) {
      this.day = day;
      this.credits = 0;
      this.requests = 0;
    }
    if (this.credits + this.cost(method) > this.dailyCreditBudget) {
      const error = new Error("Base RPC daily credit budget is exhausted");
      error.code = "RPC_CREDIT_BUDGET";
      throw error;
    }
    // Reserve synchronously so concurrent calls cannot all spend the same
    // remaining budget. Failed provider calls are counted conservatively.
    this.charge(method);
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.sequence, method, params }),
    });
    if (!response.ok) throw new Error(`Base RPC ${method} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`Base RPC ${method} failed: ${body.error.message || body.error.code}`);
    return body.result;
  }

  status() {
    return { day: this.day, credits: this.credits, requests: this.requests };
  }
}
