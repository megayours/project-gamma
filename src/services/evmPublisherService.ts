import { Injectable, OnModuleInit } from '@nestjs/common';
import { Logger } from '../utils/logger';
import { QueueService } from './queueService';
import { ChainConfigService } from '../config/chainConfig';
import { ContractService } from './contractService';
import { ChromiaService } from './chromiaService';
import { MetadataService } from './metadataService';
import { ContractEventListener } from './contractEventListener';
import { Event, ContractInfo, TrackedToken, ChainId, ContractAddress, BlockNumber } from '../types/blockchain';
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
        Logger.log(`Processing historical events for contract ${contractInfo.address} on chain ${contractInfo.chainId} from block ${fromBlock} to ${toBlock}`);

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

        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
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
          tokenId: Number.parseInt(ethEvent.topics[3]),
        };

        const isProcessed = await this.chromiaService.isEventProcessed(chainName, contractAddress, event.id);

        if (isProcessed) {
          Logger.debug(`Event already processed: ${event.id}`);
          return;
        }

        const operation = await this.createOperation(event);
        await this.queueService.publishOperation(operation);
        Logger.log(`Operation published to queue: ${operation.name}`);
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

    const hasMintOccurred = await this.chromiaService.hasMintOccured(chainName, contractAddress, event.tokenId);

    if (!hasMintOccurred) {
      const metadata = await this.metadataService.getTokenMetadata(chainName, contractAddress, 'erc721', event.tokenId);
      return this.chromiaService.createMintEventOperation(
        chainName,
        contractAddress,
        blockNumber,
        eventId,
        event.tokenId,
        event.to,
        1, // ERC721 always transfers 1 token
        metadata
      );
    } else {
      return this.chromiaService.createTransferEventOperation(
        chainName,
        contractAddress,
        blockNumber,
        eventId,
        event.tokenId,
        event.from,
        event.to,
        1 // ERC721 always transfers 1 token
      );
    }
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
          await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute before restarting
          continue;
        }

        for (const token of tokens) {
          await this.processTokenMetadata(token);
        }

        afterRowId = tokens[tokens.length - 1].rowid;
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between batches
      } catch (error) {
        Logger.error('Error in metadata update process:', error);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute before retrying
      }
    }
  }

  private async processTokenMetadata(token: TrackedToken): Promise<void> {
    try {
      const contract = this.contractService.getContract(this.chainConfigService.getChainIdByName(token.chain), token.address.toString('hex'));
      if (!contract) {
        throw new ContractNotFoundError(this.chainConfigService.getChainIdByName(token.chain), token.address.toString('hex'));
      }

      const addressHex = toAddressHexFromBuffer(token.address);

      const tokenUri = await this.metadataService.getTokenUri(token.chain, addressHex, token.type, token.token_id);
      if (!tokenUri) {
        Logger.error(`TokenURI not found for token ${token.token_id} on contract ${addressHex} (${token.chain})`);
        return;
      }

      const newMetadata = await this.metadataService.fetchMetadataWithRetry(tokenUri);
      if (JSON.stringify(newMetadata) !== JSON.stringify(token.metadata)) {
        await this.chromiaService.updateTokenMetadata(token.chain, token.address, token.token_id, newMetadata);
        Logger.log(`Updated metadata for token ${token.token_id} on contract ${token.address} (${token.chain})`);
      }
    } catch (error) {
      Logger.error(`Error processing metadata for token ${token.token_id} on contract ${token.address} (${token.chain}):`, error);
    }
  }
}
