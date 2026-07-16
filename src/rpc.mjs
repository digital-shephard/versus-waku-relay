export class CreditMeteredRpc {
  constructor(url, {
    fetchImpl = fetch,
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    dailyCreditBudget = Infinity,
    creditsPerSecond = Infinity,
  } = {}) {
    this.url = new URL(url).toString();
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sequence = 0;
    this.dailyCreditBudget = dailyCreditBudget;
    this.creditsPerSecond = creditsPerSecond;
    this.sleep = sleep;
    this.day = Math.floor(now() / 86_400_000);
    this.credits = 0;
    this.requests = 0;
    this.rateWindowStartedAt = now();
    this.rateCredits = 0;
    this.reservationQueue = Promise.resolve();
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

  async reserve(method) {
    const cost = this.cost(method);
    if (cost > this.creditsPerSecond) {
      const error = new Error("Base RPC method exceeds the configured per-second credit ceiling");
      error.code = "RPC_CREDIT_RATE";
      throw error;
    }
    const reservation = this.reservationQueue.then(async () => {
      while (true) {
        const timestamp = this.now();
        const elapsed = timestamp - this.rateWindowStartedAt;
        if (elapsed < 0 || elapsed >= 1_000) {
          this.rateWindowStartedAt = timestamp;
          this.rateCredits = 0;
        }
        if (this.rateCredits + cost <= this.creditsPerSecond) break;
        await this.sleep(Math.max(1, 1_000 - elapsed));
      }
      const day = Math.floor(this.now() / 86_400_000);
      if (day !== this.day) {
        this.day = day;
        this.credits = 0;
        this.requests = 0;
      }
      if (this.credits + cost > this.dailyCreditBudget) {
        const error = new Error("Base RPC daily credit budget is exhausted");
        error.code = "RPC_CREDIT_BUDGET";
        throw error;
      }
      this.charge(method);
      this.rateCredits += cost;
    });
    this.reservationQueue = reservation.catch(() => {});
    await reservation;
  }

  async call(method, params = []) {
    // Reservations are serialized, while network I/O remains concurrent. This
    // enforces both daily and provider burst limits without request-time loss.
    await this.reserve(method);
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
    return {
      day: this.day,
      credits: this.credits,
      requests: this.requests,
      creditsPerSecond: this.creditsPerSecond,
      currentRateCredits: this.rateCredits,
    };
  }
}
