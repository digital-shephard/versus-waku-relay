import { Wallet } from "ethers";

const wallet = Wallet.createRandom();
console.log(JSON.stringify({
  address: wallet.address,
  privateKey: wallet.privateKey,
  warning: "This optional permissionless keeper must remain separate from Cypher, deployment, Waku, and rain-attestor keys. Store it in encrypted SSM and fund only a small bounded Base gas balance.",
}, null, 2));
