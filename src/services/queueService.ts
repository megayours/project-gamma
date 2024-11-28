import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Logger } from '../utils/logger';
import { Constants } from '../utils/constants';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private isInitialized: boolean = false;
  private readonly QUEUE_KEY = 'blockchain_operations';
  private readonly PROCESSING_QUEUE_KEY = 'blockchain_operations_processing';
  private readonly FAILED_QUEUE_KEY = 'blockchain_operations_failed';
  private queueSizeLoggingInterval: ReturnType<typeof setInterval>;
  private readonly BIGINT_PREFIX = 'BIGINT:';
  private readonly PROCESSED_EVENTS_SET = 'processed_events';

  constructor(private configService: ConfigService) {
    this.redisClient = new Redis(this.configService.get<string>('REDIS_URL'));
  }

  async onModuleInit() {
    await this.initialize();
    this.startQueueSizeLogging();
    await this.recoverInProgressOperations();
    // Clear the processed events set on startup if needed
    // await this.redisClient.del(this.PROCESSED_EVENTS_SET);
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
      const [mainQueueSize, processingQueueSize, failedQueueSize] = await Promise.all([
        this.redisClient.zcard(this.QUEUE_KEY),
        this.redisClient.zcard(this.PROCESSING_QUEUE_KEY),
        this.redisClient.zcard(this.FAILED_QUEUE_KEY)
      ]);
      Logger.debug(`Queue sizes - Main: ${mainQueueSize}, Processing: ${processingQueueSize}, Failed: ${failedQueueSize}`);
    }, Constants.QUEUE_CHECK_INTERVAL_MS);
  }

  private async recoverInProgressOperations() {
    const processingOps = await this.redisClient.zrange(this.PROCESSING_QUEUE_KEY, 0, -1, 'WITHSCORES');
    if (processingOps.length > 0) {
      Logger.log(`Recovering ${processingOps.length / 2} operations from processing queue`);
      const multi = this.redisClient.multi();
      
      // Move operations back to the main queue while maintaining block height order
      for (let i = 0; i < processingOps.length; i += 2) {
        const [operationJson, blockHeight] = [processingOps[i], processingOps[i + 1]];
        multi.zadd(this.QUEUE_KEY, parseInt(blockHeight), operationJson);
      }
      
      // Clear the processing queue
      multi.del(this.PROCESSING_QUEUE_KEY);
      await multi.exec();
    }
  }

  public async getQueueSize(): Promise<number> {
    return this.redisClient.zcard(this.QUEUE_KEY);
  }

  async publishOperation(operation: { name: string; args: any[] }) {
    Logger.debug(`Publishing operation: ${operation.name}`);
    await this.ensureInitialized();
    try {
      const blockHeight = operation.args[2]; // Block height
      const eventId = operation.args[3];     // Event ID is always the fourth argument
      const chainName = operation.args[0];   // Chain name is first argument
      const contractAddress = operation.args[1].toString('hex'); // Contract address is second argument
      
      // Create a unique key for this event
      const eventKey = `${chainName}:${contractAddress}:${eventId}`;

      // Check if we've already processed this event using Redis SETNX
      const wasSet = await this.redisClient.sadd(this.PROCESSED_EVENTS_SET, eventKey);
      
      if (!wasSet) {
        Logger.debug(`Event already processed or queued: ${eventKey}`);
        return;
      }

      const serializedOperation = this.serializeOperation(operation);
      await this.redisClient.zadd(this.QUEUE_KEY, blockHeight, serializedOperation);
      Logger.debug(`Published operation: ${operation.name} for block ${blockHeight}`);
    } catch (error) {
      Logger.error(`Error in publishOperation: ${error.message}`, error);
      throw error;
    }
  }

  async consumeOperations(callback: (operation: { name: string; args: any[] }) => Promise<void>) {
    await this.ensureInitialized();
    Logger.log('Started consuming blockchain operations');
    
    while (true) {
      try {
        const result = await this.redisClient
          .multi()
          .zrange(this.QUEUE_KEY, 0, 0, 'WITHSCORES')
          .zremrangebyrank(this.QUEUE_KEY, 0, 0)
          .exec();

        if (!result || !result[0][1] || (result[0][1] as string[]).length === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        const [operationJson, blockHeight] = (result[0][1] as string[]);
        await this.redisClient.zadd(this.PROCESSING_QUEUE_KEY, parseInt(blockHeight), operationJson);
        
        const operation = this.deserializeOperation(operationJson);
        Logger.debug(`Processing operation: ${operation.name} from block ${blockHeight}`);

        try {
          await callback(operation);
          await this.redisClient.zrem(this.PROCESSING_QUEUE_KEY, operationJson);
          Logger.debug(`Successfully processed operation: ${operation.name} from block ${blockHeight}`);
        } catch (error) {
          if (error.message?.includes('duplicate key value violates unique constraint')) {
            // If it's a duplicate error, just remove from processing queue and continue
            await this.redisClient.zrem(this.PROCESSING_QUEUE_KEY, operationJson);
            Logger.log(`Duplicate event detected, skipping: ${operation.args[3]}`);
          } else {
            // For other errors, move to failed queue
            await this.redisClient
              .multi()
              .zrem(this.PROCESSING_QUEUE_KEY, operationJson)
              .zadd(this.FAILED_QUEUE_KEY, parseInt(blockHeight), operationJson)
              .exec();
            
            Logger.error(`Failed to process operation ${operation.name} from block ${blockHeight}, moved to failed queue:`, error);
            await this.handleFailedOperations();
          }
        }
      } catch (error) {
        Logger.error('Error in operation consumption loop:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async handleFailedOperations(): Promise<void> {
    while (true) {
      // Check if there are any failed operations
      const failedOps = await this.redisClient.zrange(this.FAILED_QUEUE_KEY, 0, -1, 'WITHSCORES');
      if (failedOps.length === 0) {
        break;
      }

      // Get the lowest block height operation from failed queue
      const [operationJson, blockHeight] = [failedOps[0], failedOps[1]];

      // Move back to main queue and maintain ordering
      await this.redisClient
        .multi()
        .zrem(this.FAILED_QUEUE_KEY, operationJson)
        .zadd(this.QUEUE_KEY, parseInt(blockHeight), operationJson)
        .exec();

      Logger.log(`Moved failed operation from block ${blockHeight} back to main queue for retry`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  private async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

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
