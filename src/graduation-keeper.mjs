import { Interface, Wallet, getAddress, keccak256 } from "ethers";

export const ARENA_WIRING_ABI = ["function syndicate() view returns (address)"];
export const SYNDICATE_GRADUATION_ABI = [
  "function graduation() view returns (address)",
  "function currentClassId() view returns (uint256)",
  "function canGraduate(uint256 classId) view returns (bool)",
];
export const GRADUATION_KEEPER_ABI = [
  "function graduateClass(uint256 classId) returns (address token,address pair)",
];

const arenaInterface = new Interface(ARENA_WIRING_ABI);
const syndicateInterface = new Interface(SYNDICATE_GRADUATION_ABI);
const graduationInterface = new Interface(GRADUATION_KEEPER_ABI);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function addressResult(iface, name, result) {
  const address = getAddress(iface.decodeFunctionResult(name, result)[0]);
  if (address === ZERO_ADDRESS) throw new Error(`${name} returned the zero address`);
  return address;
}

function alreadyBroadcast(error) {
  return /already known|known transaction|nonce too low|already imported/i.test(String(error?.message || error));
}

export class GraduationKeeper {
  constructor({
    enabled = false,
    chainId,
    arena,
    privateKey,
    rpc,
    stateStore,
    confirmations = 10,
    maxExecutionFeeWei = 5_000_000_000_000_000n,
    maxGasLimit = 8_000_000,
    submissionDelayMs = 0,
    rebroadcastMs = 120_000,
    now = () => Date.now(),
  }) {
    this.enabled = Boolean(enabled);
    this.chainId = BigInt(chainId);
    this.arena = getAddress(arena);
    this.rpc = rpc;
    this.stateStore = stateStore;
    this.confirmations = BigInt(confirmations);
    this.maxExecutionFeeWei = BigInt(maxExecutionFeeWei);
    this.maxGasLimit = BigInt(maxGasLimit);
    this.submissionDelayMs = Number(submissionDelayMs);
    this.rebroadcastMs = Number(rebroadcastMs);
    this.now = now;
    this.wallet = this.enabled ? new Wallet(privateKey) : null;
    this.state = this.enabled ? stateStore.load() : {
      pending: null,
      eligibleClass: null,
      eligibleSince: null,
      completedTransactions: 0,
      lastGraduatedClass: null,
    };
    this.wiring = null;
    this.running = null;
    this.lastPollAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.lastResult = this.enabled ? "starting" : "disabled";
  }

  async call(to, data, blockTag = "latest") {
    return this.rpc.call("eth_call", [{ to, data }, blockTag]);
  }

  async ensureWiring() {
    if (this.wiring) return this.wiring;
    const rpcChainId = BigInt(await this.rpc.call("eth_chainId"));
    if (rpcChainId !== this.chainId) {
      throw new Error(`graduation RPC chain mismatch: expected ${this.chainId}, received ${rpcChainId}`);
    }
    const syndicate = addressResult(
      arenaInterface,
      "syndicate",
      await this.call(this.arena, arenaInterface.encodeFunctionData("syndicate")),
    );
    const graduation = addressResult(
      syndicateInterface,
      "graduation",
      await this.call(syndicate, syndicateInterface.encodeFunctionData("graduation")),
    );
    const [syndicateCode, graduationCode] = await Promise.all([
      this.rpc.call("eth_getCode", [syndicate, "latest"]),
      this.rpc.call("eth_getCode", [graduation, "latest"]),
    ]);
    if (syndicateCode === "0x" || graduationCode === "0x") {
      throw new Error("canonical Syndicate or Graduation contract has no bytecode");
    }
    this.wiring = Object.freeze({ syndicate, graduation });
    return this.wiring;
  }

  async currentClassId(blockTag = "latest") {
    const { syndicate } = await this.ensureWiring();
    const result = await this.call(
      syndicate,
      syndicateInterface.encodeFunctionData("currentClassId"),
      blockTag,
    );
    return syndicateInterface.decodeFunctionResult("currentClassId", result)[0];
  }

  async canGraduate(classId, blockTag = "latest") {
    const { syndicate } = await this.ensureWiring();
    const result = await this.call(
      syndicate,
      syndicateInterface.encodeFunctionData("canGraduate", [classId]),
      blockTag,
    );
    return Boolean(syndicateInterface.decodeFunctionResult("canGraduate", result)[0]);
  }

  save(patch = {}) {
    this.state = { ...this.state, ...patch };
    this.stateStore.save(this.state);
  }

  async confirmedBlockTag(provided) {
    if (provided !== undefined && provided !== null) return hex(provided);
    const latest = BigInt(await this.rpc.call("eth_blockNumber"));
    return hex(latest > this.confirmations ? latest - this.confirmations : 0n);
  }

  async reconcilePending() {
    const pending = this.state.pending;
    if (!pending) return null;
    const receipt = await this.rpc.call("eth_getTransactionReceipt", [pending.txHash]);
    if (receipt) {
      const succeeded = BigInt(receipt.status) === 1n;
      this.save({
        pending: null,
        eligibleClass: null,
        eligibleSince: null,
        completedTransactions: Number(this.state.completedTransactions || 0) + (succeeded ? 1 : 0),
        lastGraduatedClass: succeeded ? String(pending.classId) : this.state.lastGraduatedClass,
        lastReceiptBlock: BigInt(receipt.blockNumber).toString(),
      });
      return {
        status: succeeded ? "confirmed" : "reverted",
        classId: String(pending.classId),
        txHash: pending.txHash,
        blockNumber: BigInt(receipt.blockNumber).toString(),
      };
    }

    const liveClass = await this.currentClassId("latest");
    if (liveClass > BigInt(pending.classId)) {
      const acceptedTransaction = await this.rpc.call("eth_getTransactionByHash", [pending.txHash]);
      if (acceptedTransaction) {
        return { status: "superseded_pending", classId: String(pending.classId), txHash: pending.txHash };
      }
      this.save({
        pending: null,
        eligibleClass: null,
        eligibleSince: null,
        lastGraduatedClass: String(pending.classId),
      });
      return { status: "superseded", classId: String(pending.classId), txHash: pending.txHash };
    }

    const lastBroadcastAt = Number(pending.lastBroadcastAt || 0);
    if (!lastBroadcastAt || this.now() - lastBroadcastAt >= this.rebroadcastMs) {
      try {
        const txHash = String(await this.rpc.call("eth_sendRawTransaction", [pending.rawTransaction])).toLowerCase();
        if (txHash !== String(pending.txHash).toLowerCase()) throw new Error("RPC returned a different graduation transaction hash");
      } catch (error) {
        if (!alreadyBroadcast(error)) throw error;
      }
      this.save({
        pending: {
          ...pending,
          lastBroadcastAt: String(this.now()),
          broadcasts: Number(pending.broadcasts || 0) + 1,
        },
      });
      return { status: "rebroadcast", classId: String(pending.classId), txHash: pending.txHash };
    }
    return { status: "pending", classId: String(pending.classId), txHash: pending.txHash };
  }

  async submit(classId) {
    const { graduation } = await this.ensureWiring();
    const data = graduationInterface.encodeFunctionData("graduateClass", [classId]);
    const request = { from: this.wallet.address, to: graduation, data, value: "0x0" };
    const estimate = BigInt(await this.rpc.call("eth_estimateGas", [request]));
    const gasLimit = (estimate * 120n + 99n) / 100n;
    if (gasLimit > this.maxGasLimit) {
      throw new Error(`graduation gas limit ${gasLimit} exceeds configured maximum ${this.maxGasLimit}`);
    }

    const [nonceValue, gasPriceValue, latestBlock, balanceValue] = await Promise.all([
      this.rpc.call("eth_getTransactionCount", [this.wallet.address, "pending"]),
      this.rpc.call("eth_gasPrice"),
      this.rpc.call("eth_getBlockByNumber", ["latest", false]),
      this.rpc.call("eth_getBalance", [this.wallet.address, "latest"]),
    ]);
    const nonce = BigInt(nonceValue);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("graduation signer nonce exceeds safe transaction range");
    const gasPrice = BigInt(gasPriceValue);
    const baseFee = latestBlock?.baseFeePerGas ? BigInt(latestBlock.baseFeePerGas) : 0n;
    const priorityFee = gasPrice > baseFee ? gasPrice - baseFee : gasPrice;
    const maxPriorityFeePerGas = priorityFee > 0n ? priorityFee : 1_000_000n;
    const maxFeePerGas = baseFee > 0n ? baseFee * 2n + maxPriorityFeePerGas : gasPrice;
    const feeCeiling = gasLimit * maxFeePerGas;
    if (feeCeiling > this.maxExecutionFeeWei) {
      throw new Error(`graduation execution-fee ceiling ${feeCeiling} exceeds configured maximum ${this.maxExecutionFeeWei}`);
    }
    if (BigInt(balanceValue) < feeCeiling) {
      this.lastResult = "unfunded";
      return {
        status: "unfunded",
        classId: classId.toString(),
        signer: this.wallet.address,
        balanceWei: BigInt(balanceValue).toString(),
        requiredWei: feeCeiling.toString(),
      };
    }

    const transaction = baseFee > 0n
      ? {
          type: 2,
          chainId: this.chainId,
          to: graduation,
          nonce: Number(nonce),
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
          data,
          value: 0n,
        }
      : {
          type: 0,
          chainId: this.chainId,
          to: graduation,
          nonce: Number(nonce),
          gasLimit,
          gasPrice,
          data,
          value: 0n,
        };
    const rawTransaction = await this.wallet.signTransaction(transaction);
    const txHash = keccak256(rawTransaction).toLowerCase();
    const stagedAt = String(this.now());
    this.save({
      pending: {
        classId: classId.toString(),
        nonce: nonce.toString(),
        txHash,
        rawTransaction,
        stagedAt,
        lastBroadcastAt: null,
        broadcasts: 0,
      },
    });

    try {
      const returnedHash = String(await this.rpc.call("eth_sendRawTransaction", [rawTransaction])).toLowerCase();
      if (returnedHash !== txHash) throw new Error("RPC returned a different graduation transaction hash");
    } catch (error) {
      if (!alreadyBroadcast(error)) throw error;
    }
    this.save({
      pending: {
        ...this.state.pending,
        lastBroadcastAt: String(this.now()),
        broadcasts: 1,
      },
    });
    return {
      status: "submitted",
      classId: classId.toString(),
      txHash,
      signer: this.wallet.address,
      executionFeeCeilingWei: feeCeiling.toString(),
    };
  }

  async execute(confirmedBlock) {
    this.lastPollAt = this.now();
    if (!this.enabled) return { status: "disabled" };
    await this.ensureWiring();

    const pending = await this.reconcilePending();
    if (pending) return pending;

    const blockTag = await this.confirmedBlockTag(confirmedBlock);
    const classId = await this.currentClassId(blockTag);
    const eligible = await this.canGraduate(classId, blockTag);
    if (!eligible) {
      if (this.state.eligibleClass !== null || this.state.eligibleSince !== null) {
        this.save({ eligibleClass: null, eligibleSince: null });
      }
      return { status: "not_ready", classId: classId.toString(), blockTag };
    }

    if (String(this.state.eligibleClass) !== classId.toString()) {
      this.save({ eligibleClass: classId.toString(), eligibleSince: String(this.now()) });
      if (this.submissionDelayMs > 0) {
        return { status: "waiting", classId: classId.toString(), remainingMs: this.submissionDelayMs };
      }
    }
    const eligibleSince = Number(this.state.eligibleSince || this.now());
    const remainingMs = this.submissionDelayMs - (this.now() - eligibleSince);
    if (remainingMs > 0) return { status: "waiting", classId: classId.toString(), remainingMs };

    const liveClass = await this.currentClassId("latest");
    if (liveClass !== classId || !(await this.canGraduate(classId, "latest"))) {
      this.save({ eligibleClass: null, eligibleSince: null });
      return { status: "raced", classId: classId.toString(), currentClassId: liveClass.toString() };
    }
    return this.submit(classId);
  }

  poll(options = {}) {
    if (this.running) return this.running;
    this.running = this.execute(options.confirmedBlock).then((result) => {
      this.lastSuccessAt = this.now();
      this.lastError = null;
      this.lastResult = result.status;
      return result;
    }).catch((error) => {
      this.lastError = { message: error.message, at: this.now() };
      this.lastResult = "error";
      throw error;
    }).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  status() {
    return {
      enabled: this.enabled,
      signer: this.wallet?.address || null,
      syndicate: this.wiring?.syndicate || null,
      graduation: this.wiring?.graduation || null,
      state: this.lastResult,
      pendingClass: this.state.pending?.classId || null,
      pendingTransaction: this.state.pending?.txHash || null,
      completedTransactions: Number(this.state.completedTransactions || 0),
      lastGraduatedClass: this.state.lastGraduatedClass,
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
    };
  }
}
