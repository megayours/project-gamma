import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Logger } from '../utils/logger';
import { Constants } from '../utils/constants';
import { ChainName, ContractAddress } from 'src/types/blockchain';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private isInitialized: boolean = false;
  private readonly QUEUE_KEY = 'blockchain_operations';
  private readonly PROCESSING_QUEUE_KEY = 'blockchain_operations_processing';
  private queueSizeLoggingInterval: ReturnType<typeof setInterval>;

  constructor(private configService: ConfigService) {
    this.redisClient = new Redis(this.configService.get<string>('REDIS_URL'));
  }

  queueKey(chain: ChainName, address: ContractAddress): string {
    return `${this.QUEUE_KEY}:${chain}:${address}`;
  }

  async onModuleInit() {
    await this.initialize();
    this.startQueueSizeLogging();
    await this.recoverInProgressOperations();
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      await this.redisClient.ping();
      this.isInitialized = true;
      Logger.log('Connected to Redis');
    } catch (error) {
      Logger.error('Failed to connect to Redis', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    clearInterval(this.queueSizeLoggingInterval);
    await this.redisClient.quit();
  }

  private startQueueSizeLogging() {
    this.queueSizeLoggingInterval = setInterval(async () => {
      const [mainQueueSize, processingQueueSize] = await Promise.all([
        this.getQueueSize(),
        this.redisClient.llen(this.PROCESSING_QUEUE_KEY)
      ]);
      Logger.debug(`Queue sizes - Main: ${mainQueueSize}, Processing: ${processingQueueSize}`);
    }, Constants.QUEUE_CHECK_INTERVAL_MS);
  }

  private async recoverInProgressOperations() {
    const processingOps = await this.redisClient.lrange(this.PROCESSING_QUEUE_KEY, 0, -1);
    if (processingOps.length > 0) {
      Logger.log(`Recovering ${processingOps.length} operations from processing queue`);
      const multi = this.redisClient.multi();
      // Move operations back to the main queue
      processingOps.forEach(op => multi.rpush(this.QUEUE_KEY, op));
      // Clear the processing queue
      multi.del(this.PROCESSING_QUEUE_KEY);
      await multi.exec();
    }
  }

  public async getQueueSize(): Promise<number> {
    return this.redisClient.llen(this.QUEUE_KEY);
  }

  async publishOperation(operation: { name: string; args: any[] }) {
    Logger.debug(`Publishing operation: ${operation.name}`);
    await this.ensureInitialized();
    try {
      const serializedOperation = this.serializeOperation(operation);
      await this.redisClient.rpush(this.QUEUE_KEY, serializedOperation);
      Logger.debug(`Published operation: ${operation.name}`);
    } catch (error) {
      Logger.error(`Error in publishOperation: ${error.message}`, error);
      throw error; // Re-throw to allow retry at caller level
    }
  }

  async consumeOperations(callback: (operation: { name: string; args: any[] }) => Promise<void>) {
    await this.ensureInitialized();
    Logger.log('Started consuming blockchain operations');
    
    while (true) {
      try {
        // Atomic operation: move item from main queue to processing queue
        const result = await this.redisClient
          .multi()
          .blpop(this.QUEUE_KEY, 5)
          .exec();

        if (!result || !result[0] || !result[0][1]) {
          continue; // No operation available
        }

        const [, operationJson] = result[0][1] as [string, string];
        
        // Move to processing queue
        await this.redisClient.rpush(this.PROCESSING_QUEUE_KEY, operationJson);
        
        const operation = this.deserializeOperation(operationJson);
        Logger.debug(`Processing operation: ${operation.name}`);

        try {
          await callback(operation);
          // Operation completed successfully, remove from processing queue
          await this.redisClient.lrem(this.PROCESSING_QUEUE_KEY, 1, operationJson);
          Logger.debug(`Successfully processed operation: ${operation.name}`);
        } catch (error) {
          // Move failed operation back to main queue
          await this.redisClient
            .multi()
            .lrem(this.PROCESSING_QUEUE_KEY, 1, operationJson)
            .rpush(this.QUEUE_KEY, operationJson)
            .exec();
          
          Logger.error(`Failed to process operation ${operation.name}, moved back to main queue:`, error);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
        }
      } catch (error) {
        Logger.error('Error in operation consumption loop:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private BIGINT_PREFIX = 'BIGINT:';

  private serializeOperation(operation: { name: string; args: any[] }): string {
    return JSON.stringify(operation, (_, value) => {
      if (typeof value === 'bigint') {
        return `${this.BIGINT_PREFIX}${value.toString()}`;
      } else if (Buffer.isBuffer(value)) {
        return {
          type: 'Buffer',
          data: value.toString('hex')
        };
      }
      return value;
    });
  }

  private deserializeOperation(operationJson: string): { name: string; args: any[] } {
    return JSON.parse(operationJson, (_, value) => {
      if (typeof value === 'string' && value.startsWith(this.BIGINT_PREFIX)) {
        Logger.debug(`Deserialized bigint: ${value.replace(this.BIGINT_PREFIX, '')}`);
        return BigInt(value.replace(this.BIGINT_PREFIX, ''));
      } else if (value && value.type === 'Buffer' && value.data) {
        return Buffer.from(value.data, 'hex');
      }
      return value;
    });
  }
}
