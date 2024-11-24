import { Logger } from '../utils/logger';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, IClient, newSignatureProvider, SignatureProvider } from 'postchain-client';
import { MetadataService } from './metadataService';
import { ChainConfigService } from '../config/chainConfig';
import { ContractInfo, ContractType, TrackedToken, ChainName, ContractAddress, TokenId } from '../types/blockchain';
import { assert } from 'console';

@Injectable()
export class ChromiaService implements OnModuleInit {
  private client: IClient;
  private signatureProvider: SignatureProvider;
  private isInitialized: boolean = false;

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

    this.client = await createClient({
      nodeUrlPool: [nodeUrl],
      blockchainRid,
    });

    this.signatureProvider = newSignatureProvider({ privKey: this.configService.get<string>('chromia.adminPrivateKey') });

    Logger.log('Connected to Chromia');
    this.isInitialized = true;
  }

  async getContractsToMonitor(): Promise<ContractInfo[]> {
    await this.ensureInitialized();
      try {
        const contracts = await this.client.query<{ chain: string, address: Buffer, block_height: number, type: ContractType }[]>('tokens.list_contracts');
      return contracts.map(contract => ({
        chainId: this.chainConfigService.getChainIdByName(contract.chain),
        address: `0x${contract.address.toString('hex')}`,
        type: contract.type,
        lastProcessedBlock: contract.block_height,
      }));
    } catch (error) {
      Logger.error('Error fetching contracts to monitor', error);
      throw error;
    }
  }

  private async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  async isEventProcessed(chain: string, address: string, eventId: string): Promise<boolean> {
    try {
      Logger.debug(`Checking if event is processed: ${eventId}`);
      return await this.client.query<boolean>('tokens.is_event_processed', { chain, address: Buffer.from(address.replace('0x', ''), 'hex'), event_id: eventId });
    } catch (error) {
      Logger.error(`Error checking if event is processed: ${error instanceof Error ? error.message : 'Unknown error'}`, error);
      return false;
    }
  }

  async hasMintOccured(chain: string, address: string, tokenId: TokenId): Promise<boolean> {
    return this.client.query<boolean>('tokens.has_mint_occured', { chain, address: Buffer.from(address.replace('0x', ''), 'hex'), token_id: tokenId });
  }

  async getKnownTokens(afterRowId: number, take: number): Promise<TrackedToken[]> {
    await this.ensureInitialized();
    return this.client.query<TrackedToken[]>('tokens.list_minted_tokens', { after_rowid: afterRowId, take });
  }

  async updateTokenMetadata(chain: string, address: Buffer, tokenId: TokenId, metadata: any): Promise<void> {
    await this.ensureInitialized();
    await this.client.signAndSendUniqueTransaction({
      name: 'tokens.process_metadata_update',
      args: [chain, address, tokenId, JSON.stringify(metadata)],
    }, this.signatureProvider);
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
    await this.ensureInitialized();
    
    try {
      // First, check all operations in parallel
      const operationChecks = await Promise.all(
        operations.map(async operation => {
          if (operation.name === 'tokens.process_mint_event' || operation.name === 'tokens.process_transfer_event') {
            const isProcessed = await this.isEventProcessed(
              operation.args[0],  // chain
              operation.args[1].toString('hex'),  // address
              operation.args[3]   // eventId
            );
            return !isProcessed;
          }
          return true; // Include non-event operations
        })
      );

      // Filter operations based on the check results
      const unprocessedOperations = operations.filter((_, index) => operationChecks[index]);

      if (unprocessedOperations.length === 0) {
        Logger.debug('All operations were already processed, skipping batch');
        return;
      }

      await this.client.signAndSendUniqueTransaction({
        operations: unprocessedOperations,
        signers: [this.signatureProvider.pubKey],
      }, this.signatureProvider);
      
      Logger.log(`Processed batch of ${unprocessedOperations.length} events (${operations.length - unprocessedOperations.length} were already processed)`);
    } catch (error) {
      Logger.error('Error processing batch of events:', error);
      throw error;
    }
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

  createTransferEventOperation(chain: string, address: string, blockNumber: number, eventId: string, tokenId: bigint, from: string, to: string, amount: bigint): { name: string; args: any[] } {
    return {
      name: 'tokens.process_transfer_event',
      args: [
        chain,
        Buffer.from(address.replace('0x', ''), 'hex'),
        blockNumber,
        eventId,
        tokenId,
        Buffer.from(from.replace('0x', ''), 'hex'),
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
