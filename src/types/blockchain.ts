export type ChainId = number;
export type ChainName = string;
export type ContractAddress = string;
export type TransactionHash = string;
export type BlockNumber = number;
export type TokenId = bigint;
export type ContractType = 'erc721' | 'erc1155';

export interface ChainConfig {
  chainId: ChainId;
  chainName: ChainName;
  rpcUrl: string;
}

export interface ContractABI {
  erc721: string[];
  erc1155: string[];
  [key: string]: string[]; // Allow for additional contract types
}

export interface Event {
  id: string;
  chainId: ChainId;
  chainName: ChainName;
  contractAddress: ContractAddress;
  eventName: string;
  blockNumber: BlockNumber;
  transactionHash: TransactionHash;
  logIndex: number;
  from: string;
  to: string;
  tokenId: TokenId;
}

export type ContractInfo = {
  chainId: ChainId;
  address: ContractAddress;
  type: ContractType;
  lastProcessedBlock: BlockNumber;
}

export type TrackedToken = {
  chain: ChainName;
  address: Buffer;
  type: 'external';
  contract_type: ContractType;
  token_id: TokenId;
  rowid: number;
  metadata: any;
}
