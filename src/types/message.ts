import { ChainName, ContractAddress } from "./blockchain"

export type Message = {
  chain: ChainName;
  contractAddress: ContractAddress;
  operation: {
    name: string;
    args: any[];
  };
}
