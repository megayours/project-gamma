import { Log } from "ethers";

// Replace any usage of `Event` with `Log`
// For example:
export interface EthersEvent extends Log {
  from: string;
  to: string;
  tokenId: number;
}
