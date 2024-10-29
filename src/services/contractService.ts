import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { ChainConfigService } from '../config/chainConfig';
import { Logger } from '../utils/logger';
import { ContractInfo, ChainId, ContractAddress } from '../types/blockchain';
import { ContractNotFoundError, ProviderNotFoundError } from '../utils/errors';
import { toAddressHex } from '../utils/address';

@Injectable()
export class ContractService {
  private providers: Map<ChainId, ethers.JsonRpcProvider> = new Map();
  private contracts: Map<string, ethers.Contract> = new Map();

  constructor(private chainConfigService: ChainConfigService) {}

  async initializeContracts(contractsToMonitor: ContractInfo[]): Promise<void> {
    const chainConfigs = this.chainConfigService.getChainConfigs();

    for (const config of chainConfigs) {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      this.providers.set(config.chainId, provider);
      Logger.log(`Connected to JsonRPC provider for chain ${config.chainName} (ID: ${config.chainId})`);
    }

    for (const contractInfo of contractsToMonitor) {
      const provider = this.providers.get(contractInfo.chainId);
      if (!provider) {
        throw new ProviderNotFoundError(contractInfo.chainId);
      }

      const abi = this.chainConfigService.getContractABI(contractInfo.type);
      if (!abi) {
        Logger.error(`No ABI found for contract type ${contractInfo.type}`);
        continue;
      }

      const contract = new ethers.Contract(contractInfo.address, abi, provider);
      this.contracts.set(`${contractInfo.chainId}-${contractInfo.address}`, contract);

      Logger.log(`Initialized contract ${contractInfo.address} (${contractInfo.type}) on chain ${this.chainConfigService.getChainNameById(contractInfo.chainId) || contractInfo.chainId}`);
    }
  }

  getContract(chainId: ChainId, address: ContractAddress): ethers.Contract {
    const addressHex = toAddressHex(address);
    const contractKey = `${chainId}-${addressHex}`;
    const contract = this.contracts.get(contractKey);
    if (!contract) {
      throw new ContractNotFoundError(chainId, address);
    }
    return contract;
  }

  getProvider(chainId: ChainId): ethers.JsonRpcProvider {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new ProviderNotFoundError(chainId);
    }
    return provider;
  }

  getAllContracts(): Map<string, ethers.Contract> {
    return this.contracts;
  }
}
