import { Wallet } from "ethers";

const wallet = Wallet.createRandom();
console.log(JSON.stringify({
  address: wallet.address,
  privateKey: wallet.privateKey,
  warning: "Store the private key in this node's encrypted SSM parameter and publish only the address.",
}, null, 2));
