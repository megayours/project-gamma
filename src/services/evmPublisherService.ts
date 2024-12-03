import { Injectable, OnModuleInit } from '@nestjs/common';
import { Logger } from '../utils/logger';
import { QueueService } from './queueService';
import { ChainConfigService } from '../config/chainConfig';
import { ContractService } from './contractService';
import { ChromiaService } from './chromiaService';
import { MetadataService } from './metadataService';
import { ContractEventListener } from './contractEventListener';
import { Event, ContractInfo, TrackedToken, ChainId, ContractAddress, BlockNumber, TokenId } from '../types/blockchain';
import { ContractNotFoundError, ProviderNotFoundError, TokenDoesNotExistError } from '../utils/errors';
import { ethers } from 'ethers';
import { createEventId } from '../utils/event';
import { Constants } from '../utils/constants';
import { toAddressHexFromBuffer } from '../utils/address';

@Injectable()
export class EvmPublisherService implements OnModuleInit {
  private knownContracts: Set<string> = new Set();
  private lastProcessedBlocks: Map<string, BlockNumber> = new Map();

  constructor(
    private chromiaService: ChromiaService,
    private queueService: QueueService,
    private chainConfigService: ChainConfigService,
    private contractService: ContractService,
    private metadataService: MetadataService,
    private contractEventListener: ContractEventListener
  ) { }

  async onModuleInit(): Promise<void> {
    await this.chromiaService.initialize();
    await this.initializeContracts();
    this.startContractMonitoring();
    this.startMetadataUpdateProcess();
  }

  private async initializeContracts(): Promise<void> {
    const contractsToMonitor = await this.chromiaService.getContractsToMonitor();
    await this.contractService.initializeContracts(contractsToMonitor);
    await Promise.all(contractsToMonitor.map(contract => this.initializeContract(contract)));
  }

  private async initializeContract(contractInfo: ContractInfo): Promise<void> {
    await this.processHistoricalEvents(contractInfo);
    await this.contractEventListener.startListening(contractInfo, this.handleContractEvent.bind(this));
    this.updateKnownContract(contractInfo);
  }

  private updateKnownContract(contract: ContractInfo): void {
    this.knownContracts.add(`${contract.chainId}-${contract.address}`);
  }

  private async startContractMonitoring(): Promise<void> {
    setInterval(async () => {
      try {
        const currentContracts = await this.chromiaService.getContractsToMonitor();
        const newContracts = currentContracts.filter(c => !this.knownContracts.has(`${c.chainId}-${c.address}`));

        if (newContracts.length > 0) {
          Logger.log(`Found ${newContracts.length} new contracts to monitor`);
          await this.contractService.initializeContracts(newContracts);
          for (const newContract of newContracts) {
            await this.initializeContract(newContract);
          }
        }
      } catch (error) {
        Logger.error('Error in contract monitoring:', error);
      }
    }, Constants.FIVE_MINUTES_MS);
  }

  private async processHistoricalEvents(contractInfo: ContractInfo): Promise<void> {
    const contract = this.contractService.getContract(contractInfo.chainId, contractInfo.address);
    if (!contract) {
      throw new ContractNotFoundError(contractInfo.chainId, contractInfo.address);
    }

    const provider = this.contractService.getProvider(contractInfo.chainId);
    if (!provider) {
      throw new ProviderNotFoundError(contractInfo.chainId);
    }

    const currentBlock = await provider.getBlockNumber();
    const contractKey = `${contractInfo.chainId}-${contractInfo.address}`;
    let fromBlock = this.lastProcessedBlocks.get(contractKey) || contractInfo.lastProcessedBlock;

    if (fromBlock >= currentBlock) {
      Logger.log(`Contract ${contractInfo.address} on chain ${contractInfo.chainId} is up to date`);
      return;
    }

    while (fromBlock <= currentBlock) {
      if (await this.queueService.getQueueSize() > Constants.QUEUE_SIZE_THRESHOLD) {
        Logger.log(`Queue size is too high, throttling for 60 seconds`);
        await new Promise(resolve => setTimeout(resolve, Constants.ONE_MINUTE_MS));
        continue;
      }
      const toBlock = Math.min(fromBlock + Constants.MAX_BLOCK_RANGE, currentBlock);
      await this.processBlockRange(contractInfo, contract, fromBlock, toBlock);
      fromBlock = toBlock + 1;
    }

    Logger.log(`Finished processing historical events for contract ${contractInfo.address} on chain ${contractInfo.chainId}`);
  }

  private async processBlockRange(contractInfo: ContractInfo, contract: ethers.Contract, fromBlock: BlockNumber, toBlock: BlockNumber): Promise<void> {
    let retryCount = 0;

    while (retryCount < Constants.MAX_RETRIES) {
      try {
        Logger.debug(`Processing historical events for contract ${contractInfo.address} on chain ${contractInfo.chainId} from block ${fromBlock} to ${toBlock}`);

        const filter = contract.filters.Transfer();
        const events = await contract.queryFilter(filter, fromBlock, toBlock);

        for (const event of events) {
          await this.handleContractEvent(contractInfo.chainId, contractInfo.address, event);
        }

        this.lastProcessedBlocks.set(`${contractInfo.chainId}-${contractInfo.address}`, toBlock);
        Logger.debug(`Processed events up to block ${toBlock} for contract ${contractInfo.address} on chain ${contractInfo.chainId}`);
        break; // Success, exit retry loop
      } catch (error) {
        if (error.code === -32005) { // Too many results error
          toBlock = Math.floor((fromBlock + toBlock) / 2);
          Logger.debug(`Reducing block range due to too many results. New toBlock: ${toBlock}`);
          retryCount++;
        } else {
          Logger.error(`Error processing events for contract ${contractInfo.address} on chain ${contractInfo.chainId} from block ${fromBlock} to ${toBlock}:`, error);
          retryCount++;
        }

        if (retryCount >= Constants.MAX_RETRIES) {
          Logger.error(`Max retries reached for block range ${fromBlock} to ${toBlock}. Skipping this range.`);
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Backoff
      }
    }
  }

  private async handleContractEvent(chainId: ChainId, contractAddress: ContractAddress, ethEvent: ethers.Log): Promise<void> {
    try {
      const chainName = this.chainConfigService.getChainNameById(chainId) || chainId.toString();
      Logger.debug(`Handling contract event: chainId=${chainId}, contractAddress=${contractAddress}, eventHash=${ethEvent.transactionHash}`);

      if (await this.isErc721Transfer(ethEvent)) {
        const event: Event = {
          id: createEventId(ethEvent.transactionHash, ethEvent.index),
          chainId,
          chainName,
          contractAddress,
          eventName: 'Transfer',
          blockNumber: ethEvent.blockNumber,
          transactionHash: ethEvent.transactionHash,
          logIndex: ethEvent.index,
          from: this.safelyExtractAddress(ethEvent.topics[1]),
          to: this.safelyExtractAddress(ethEvent.topics[2]),
          tokenId: BigInt(ethEvent.topics[3]),
        };

        Logger.log(`Block ${event.blockNumber}, contract: ${chainName}:${contractAddress}, tokenId: ${event.tokenId} sent from ${event.from} to ${event.to}`);

        const isProcessed = await this.chromiaService.isEventProcessed(chainName, contractAddress, event.id);
        if (isProcessed) {
          Logger.log(`Event already processed: ${event.id}`);
          return;
        }

        const operation = await this.createOperation(event);
        await this.queueService.publishOperation(operation);
        Logger.debug(`Published to queue: ${operation.name}, chain: ${chainName}, contract: ${contractAddress}, block: ${event.blockNumber}, tokenId: ${event.tokenId}`);
      }
    } catch (error) {
      if (error instanceof TokenDoesNotExistError) {
        Logger.debug(`Token does not exist: ${error.message}`);
        return;
      }
      Logger.error(`Error processing event: ${error instanceof Error ? error.message : 'Unknown error'}`, error);
    }
  }

  private safelyExtractAddress(topic: string): string {
    try {
      // First, try to use ethers to parse the address
      return ethers.getAddress(ethers.dataSlice(topic, 12));
    } catch (error) {
      // If that fails, fall back to our original method
      Logger.log(`Failed to parse address using ethers: ${error.message}. Falling back to manual extraction.`);
      return ethers.getAddress('0x' + topic.slice(-40));
    }
  }

  private async isErc721Transfer(event: ethers.Log): Promise<boolean> {
    // ERC721 Transfer event has 4 topics (including the event signature)
    return event.topics.length === 4 && event.data === '0x';
  }

  private async createOperation(event: Event): Promise<{ name: string; args: any[] }> {
    const { chainName, contractAddress, blockNumber, id: eventId } = event;

    return this.chromiaService.createTransferEventOperation(
      chainName,
      contractAddress,
      blockNumber,
      eventId,
      typeof event.tokenId === 'bigint' ? event.tokenId : BigInt(event.tokenId),
      event.from,
      event.to,
      BigInt(1) // ERC721 always transfers 1 token
    );
  }

  private async startMetadataUpdateProcess(): Promise<void> {
    Logger.log('Starting metadata update process');
    const PAGE_SIZE = 10;
    let afterRowId = 0;

    while (true) {
      try {
        Logger.debug(`Fetching tokens from rowId ${afterRowId}`);
        const tokens = await this.chromiaService.getKnownTokens(afterRowId, PAGE_SIZE);
        Logger.debug(`Found ${tokens.length} tokens to check for metadata updates`);
        if (tokens.length === 0) {
          afterRowId = 0; // Reset to start
          await new Promise(resolve => setTimeout(resolve, 6_000_000)); // Wait for 1 hour before restarting
          continue;
        }

        for (const token of tokens) {
          await this.processTokenMetadata(token);
        }

        afterRowId = tokens[tokens.length - 1].rowid;
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay between batches
      } catch (error) {
        Logger.error('Error in metadata update process:', error);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute before retrying
      }
    }
  }

  private isMetadataEqual(metadata1: any, metadata2: any): boolean {
    // Handle null/undefined cases
    if (metadata1 === metadata2) return true;
    if (!metadata1 || !metadata2) return false;

    // If either is not an object, do direct comparison
    if (typeof metadata1 !== 'object' || typeof metadata2 !== 'object') {
      return metadata1 === metadata2;
    }

    // Handle arrays
    if (Array.isArray(metadata1) && Array.isArray(metadata2)) {
      if (metadata1.length !== metadata2.length) return false;
      return metadata1.every((item, index) => this.isMetadataEqual(item, metadata2[index]));
    }

    // Handle objects
    const keys1 = Object.keys(metadata1);
    const keys2 = Object.keys(metadata2);

    if (keys1.length !== keys2.length) return false;

    // Sort keys to ensure consistent comparison
    const sortedKeys = keys1.sort();
    return sortedKeys.every(key => {
      if (!metadata2.hasOwnProperty(key)) return false;
      return this.isMetadataEqual(metadata1[key], metadata2[key]);
    });
  }

  private async processTokenMetadata(token: TrackedToken): Promise<void> {
    try {
      const contract = this.contractService.getContract(this.chainConfigService.getChainIdByName(token.chain), token.address.toString('hex'));
      if (!contract) {
        throw new ContractNotFoundError(this.chainConfigService.getChainIdByName(token.chain), token.address.toString('hex'));
      }

      const addressHex = toAddressHexFromBuffer(token.address);

      const tokenUri = await this.metadataService.getTokenUri(token.chain, addressHex, token.contract_type, token.token_id);
      if (!tokenUri) {
        Logger.error(`TokenURI not found for token ${token.token_id} on contract ${addressHex} (${token.chain})`);
        return;
      }

      const newMetadata = await this.metadataService.fetchMetadataWithRetry(tokenUri);
      if (!this.isMetadataEqual(newMetadata, token.metadata)) {
        await this.chromiaService.updateTokenMetadata(token.chain, token.address, token.token_id, newMetadata);
        Logger.log(`Updated metadata for token ${token.token_id} on contract ${token.address.toString('hex')} (${token.chain})`);
      }
    } catch (error) {
      Logger.error(`Error processing metadata for token ${token.token_id} on contract ${token.address} (${token.chain}):`, error);
    }
  }
}
