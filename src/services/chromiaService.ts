import { Logger } from '../utils/logger';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, IClient, newSignatureProvider, SignatureProvider, UnexpectedStatusError } from 'postchain-client';
import { MetadataService } from './metadataService';
import { ChainConfigService } from '../config/chainConfig';
import { ContractInfo, ContractType, TrackedToken, ChainName, ContractAddress, TokenId } from '../types/blockchain';

@Injectable()
export class ChromiaService implements OnModuleInit {
  private client: IClient;
  private signatureProvider: SignatureProvider;
  private isInitialized: boolean = false;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  constructor(
    private configService: ConfigService,
    private chainConfigService: ChainConfigService,
    private metadataService: MetadataService
  ) {}

  async onModuleInit() {
    await this.initialize();
  }

  async initialize() {
    if (this.isInitialized) return;

    const nodeUrl = this.configService.get<string>('chromia.nodeUrl');
    const blockchainRid = this.configService.get<string>('chromia.blockchainRid');

    if (!nodeUrl || !blockchainRid) {
      throw new Error('Postchain configuration is missing');
    }

    Logger.log(`Connecting to Chromia at ${nodeUrl} with blockchainRID ${blockchainRid}`);

    try {
      this.client = await createClient({
        nodeUrlPool: [nodeUrl],
        blockchainRid,
      });

      this.signatureProvider = newSignatureProvider({ privKey: this.configService.get<string>('chromia.adminPrivateKey') });

      Logger.log('Connected to Chromia');
      this.isInitialized = true;
    } catch (error) {
      Logger.error('Failed to initialize Chromia client:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  private async reinitialize() {
    Logger.log('Reinitializing Chromia client...');
    this.isInitialized = false;
    await this.initialize();
  }

  private async withChromiaClient<T>(operation: (client: IClient) => Promise<T>): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        await this.ensureInitialized();
        return await operation(this.client);
      } catch (error) {
        lastError = error;
        
        // Check for connection-related errors
        if (error instanceof UnexpectedStatusError || 
            error.message?.includes('Unexpected status code') ||
            error.message?.includes('Failed to fetch')) {
          
          Logger.log(`Attempt ${attempt}/${this.MAX_RETRIES} failed, reinitializing client...`);
          await this.reinitialize();
          
          // Wait before retrying with exponential backoff
          if (attempt < this.MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS * Math.pow(2, attempt - 1)));
          }
        } else {
          // If it's not a connection error, throw immediately
          throw error;
        }
      }
    }
    
    Logger.error('All retry attempts failed');
    throw lastError;
  }

  async getContractsToMonitor(): Promise<ContractInfo[]> {
    return this.withChromiaClient(async (client) => {
      const contracts = await client.query<{ chain: string, address: Buffer, block_height: number, type: ContractType }[]>('tokens.list_contracts');
      return contracts.map(contract => ({
        chainId: this.chainConfigService.getChainIdByName(contract.chain),
        address: `0x${contract.address.toString('hex')}`,
        type: contract.type,
        lastProcessedBlock: contract.block_height,
      }));
    });
  }

  private async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  async isEventProcessed(chain: string, address: string, eventId: string): Promise<boolean> {
    return this.withChromiaClient(async (client) => {
      Logger.debug(`Checking if event is processed: ${eventId}`);
      return await client.query<boolean>('tokens.is_event_processed', {
        chain,
        address: Buffer.from(address.replace('0x', ''), 'hex'),
        event_id: eventId
      });
    });
  }

  async hasMintOccured(chain: string, address: string, tokenId: TokenId): Promise<boolean> {
    return this.withChromiaClient(async (client) => {
      return client.query<boolean>('tokens.has_mint_occured', {
        chain,
        address: Buffer.from(address.replace('0x', ''), 'hex'),
        token_id: tokenId
      });
    });
  }

  async getKnownTokens(afterRowId: number, take: number): Promise<TrackedToken[]> {
    return this.withChromiaClient(async (client) => {
      return client.query<TrackedToken[]>('tokens.list_minted_tokens', {
        after_rowid: afterRowId,
        take
      });
    });
  }

  async getKnownTokensWithUnattachedMetadata(afterRowId: number, take: number): Promise<TrackedToken[]> {
    return this.withChromiaClient(async (client) => {
      return client.query<TrackedToken[]>('tokens.list_minted_tokens_with_unattached_metadata', {
        after_rowid: afterRowId,
        take
      });
    });
  }

  async updateTokenMetadata(chain: string, address: Buffer, tokenId: TokenId, metadata: any): Promise<void> {
    return this.withChromiaClient(async (client) => {
      await client.signAndSendUniqueTransaction({
        name: 'tokens.process_metadata_update',
        args: [chain, address, tokenId, JSON.stringify(metadata)],
      }, this.signatureProvider);
    });
  }

  async registerContract(chain: string, address: string, project: string, collection: string, blockHeight: number): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.client.signAndSendUniqueTransaction({
        name: 'tokens.register_contract',
        args: [
          chain,
          Buffer.from(address.replace('0x', ''), 'hex'),
          project,
          collection,
          blockHeight,
        ],
      }, this.signatureProvider);
      Logger.log(`Registered contract ${address} on chain ${chain}`);
    } catch (error) {
      Logger.error(`Error registering contract ${address} on chain ${chain}`, error);
      throw error;
    }
  }

  async batchProcessEvents(operations: Array<{ name: string; args: any[] }>): Promise<void> {
    return this.withChromiaClient(async (client) => {
      // First, check all operations in parallel
      const operationChecks = await Promise.all(
        operations.map(async operation => {
          if (operation.name === 'tokens.process_mint_event' || operation.name === 'tokens.process_transfer_event') {
            const isProcessed = await this.isEventProcessed(
              operation.args[0],
              operation.args[1].toString('hex'),
              operation.args[3]
            );
            return !isProcessed;
          }
          return true;
        })
      );

      const unprocessedOperations = operations.filter((_, index) => operationChecks[index]);

      if (unprocessedOperations.length === 0) {
        Logger.debug('All operations were already processed, skipping batch');
        return;
      }

      await client.signAndSendUniqueTransaction({
        operations: unprocessedOperations,
        signers: [this.signatureProvider.pubKey],
      }, this.signatureProvider);
    });
  }

  createMintEventOperation(chain: string, address: string, blockNumber: number, eventId: string, tokenId: TokenId, to: string, amount: bigint, metadata: any): { name: string; args: any[] } {
    const tokenName = metadata.name || `Token ${tokenId}`;
    return {
      name: 'tokens.process_mint_event',
      args: [
        chain,
        Buffer.from(address.replace('0x', ''), 'hex'),
        blockNumber,
        eventId,
        tokenId,
        tokenName,
        JSON.stringify(metadata),
        Buffer.from(to.replace('0x', ''), 'hex'),
        amount,
      ],
    };
  }

  createTransferEventOperation(chain: string, address: string, blockNumber: number, eventId: string, tokenId: bigint, to: string, amount: bigint): { name: string; args: any[] } {
    return {
      name: 'tokens.process_transfer_event',
      args: [
        chain,
        Buffer.from(address.replace('0x', ''), 'hex'),
        blockNumber,
        eventId,
        tokenId,
        Buffer.from(to.replace('0x', ''), 'hex'),
        amount,
      ],
    };
  }

  createMetadataUpdateOperation(chain: ChainName, address: ContractAddress, tokenId: TokenId, metadata: any): { name: string; args: any[] } {
    return {
      name: 'tokens.process_metadata_update',
      args: [chain, Buffer.from(address.replace('0x', ''), 'hex'), tokenId, JSON.stringify(metadata)],
    };
  }
}
