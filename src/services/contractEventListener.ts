import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { Logger } from '../utils/logger';
import { ContractService } from './contractService';
import { ContractInfo, ChainId, ContractAddress } from '../types/blockchain';
import { Constants } from '../utils/constants';

@Injectable()
export class ContractEventListener {
  private listeners: Map<string, { 
    contract: ethers.Contract, 
    provider: ethers.Provider, 
    filter: ethers.DeferredTopicFilter, 
    cleanup: () => void 
  }> = new Map();

  constructor(private contractService: ContractService) {}

  async startListening(contractInfo: ContractInfo, eventHandler: (chainId: ChainId, contractAddress: ContractAddress, event: ethers.Log) => Promise<void>): Promise<void> {
    const listenerKey = `${contractInfo.chainId}-${contractInfo.address}`;
    
    const setupListener = async () => {
      try {
        const contract = this.contractService.getContract(contractInfo.chainId, contractInfo.address);
        if (!contract) {
          Logger.error(`Contract not found for ${contractInfo.address} on chain ${contractInfo.chainId}`);
          return;
        }

        const provider = this.contractService.getProvider(contractInfo.chainId);
        if (!provider) {
          Logger.error(`Provider not found for chain ${contractInfo.chainId}`);
          return;
        }

        const currentBlock = await provider.getBlockNumber();
        Logger.log(`Starting to listen for events on contract ${contractInfo.address} on chain ${contractInfo.chainId} from block ${currentBlock + 1}`);

        // Create filter
        const filter = contract.filters.Transfer();
        Logger.debug(`Filter: ${JSON.stringify(filter)}`);

        // Set up event listener using polling instead of WebSocket
        const pollInterval = setInterval(async () => {
          try {
            const events = await contract.queryFilter(filter, currentBlock + 1);
            for (const event of events) {
              Logger.debug(`Received Transfer event from contract ${contractInfo.address} on chain ${contractInfo.chainId}`);
              await eventHandler(contractInfo.chainId, contractInfo.address, event);
            }
          } catch (error) {
            if (error.code === 'UNKNOWN_ERROR' && error.error?.message === 'filter not found') {
              Logger.log(`Filter not found, recreating for ${contractInfo.address} on chain ${contractInfo.chainId}`);
              // Recreate the filter
              const newFilter = contract.filters.Transfer();
              this.listeners.set(listenerKey, { contract, provider, filter: newFilter, cleanup: () => clearInterval(pollInterval) });
            } else {
              Logger.error(`Error polling for events: ${error.message}`);
            }
          }
        }, Constants.ONE_MINUTE_MS); // Poll every 60 seconds

        const errorHandler = (error: Error) => {
          Logger.error(`Error in provider for chain ${contractInfo.chainId}:`, error);
          this.restartListener(listenerKey, setupListener);
        };

        provider.on('error', errorHandler);

        this.listeners.set(listenerKey, { 
          contract, 
          provider, 
          filter, 
          cleanup: () => {
            clearInterval(pollInterval);
            provider.removeListener('error', errorHandler);
          }
        });
        Logger.log(`Event listener started for contract ${contractInfo.address} on chain ${contractInfo.chainId}`);
      } catch (error) {
        Logger.error(`Error setting up listener for contract ${contractInfo.address} on chain ${contractInfo.chainId}:`, error);
      }
    };

    await setupListener();
  }

  private async restartListener(listenerKey: string, setupListener: () => Promise<void>): Promise<void> {
    Logger.log(`Restarting listener for ${listenerKey}`);
    const existingListener = this.listeners.get(listenerKey);
    if (existingListener) {
      existingListener.cleanup();
      this.listeners.delete(listenerKey);
    }
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before reconnecting
    await setupListener();
  }

  async stopListening(contractInfo: ContractInfo): Promise<void> {
    const listenerKey = `${contractInfo.chainId}-${contractInfo.address}`;
    const listener = this.listeners.get(listenerKey);
    if (listener) {
      listener.cleanup();
      this.listeners.delete(listenerKey);
      Logger.log(`Stopped listening for events on contract ${contractInfo.address} on chain ${contractInfo.chainId}`);
    }
  }
}
