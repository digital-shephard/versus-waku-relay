import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Interface, Wallet, verifyMessage } from "ethers";
import {
  BASE_MULTICALL3,
  ClassStateService,
  canonicalClassState,
  classStateMessage,
} from "../src/class-state.mjs";

const arena = "0x1000000000000000000000000000000000000001";
const syndicate = "0x2000000000000000000000000000000000000002";
const ARENA = new Interface([
  "function syndicate() view returns (address)",
  "function currentDay() view returns (uint32)",
]);
const SYNDICATE = new Interface([
  "function currentClassId() view returns (uint256)",
  "function graduationFloor() view returns (uint256)",
  "function getClass(uint256 classId) view returns (uint256 totalCommitted,uint32 participantCount,uint32 openedDay,bool graduated)",
]);
const MULTICALL = new Interface([
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[] returnData)",
]);

test("serves a signed cached class snapshot without request-time RPC", async () => {
  const privateKey = `0x${"4".repeat(64)}`;
  const calls = [];
  const rpc = {
    async call(method, [request, blockTag]) {
      assert.equal(method, "eth_call");
      calls.push({ request, blockTag });
      if (request.to.toLowerCase() === arena.toLowerCase()) {
        return ARENA.encodeFunctionResult("syndicate", [syndicate]);
      }
      if (request.to.toLowerCase() === syndicate.toLowerCase()) {
        return SYNDICATE.encodeFunctionResult("currentClassId", [3n]);
      }
      assert.equal(request.to, BASE_MULTICALL3);
      return MULTICALL.encodeFunctionResult("aggregate3", [[
        { success: true, returnData: SYNDICATE.encodeFunctionResult("currentClassId", [3n]) },
        { success: true, returnData: ARENA.encodeFunctionResult("currentDay", [20_627]) },
        { success: true, returnData: SYNDICATE.encodeFunctionResult("graduationFloor", [1_000_000_000n]) },
        { success: true, returnData: SYNDICATE.encodeFunctionResult("getClass", [80_000n, 5, 20_627, false]) },
      ]]);
    },
  };
  const service = new ClassStateService({
    rpc,
    privateKey,
    chainId: 8453,
    arena,
    cachePath: path.join(os.tmpdir(), `versus-class-state-${process.pid}-${Date.now()}.json`),
    now: () => 1_784_200_000_000,
  });

  const refreshed = await service.refresh({ confirmedBlock: 48_600_000n });
  assert.equal(refreshed.classId, "3");
  assert.equal(refreshed.totalCommittedMicros, "80000");
  assert.equal(refreshed.participantCount, 5);
  assert.equal(refreshed.blockNumber, "48600000");
  assert.equal(
    verifyMessage(classStateMessage(canonicalClassState(refreshed)), refreshed.signature),
    new Wallet(privateKey).address,
  );
  const callsAfterRefresh = calls.length;
  service.snapshot();
  service.snapshot();
  assert.equal(calls.length, callsAfterRefresh, "public cache reads must never trigger provider calls");
});
