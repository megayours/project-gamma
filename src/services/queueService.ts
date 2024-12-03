import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Logger } from '../utils/logger';
import { Constants } from '../utils/constants';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private isInitialized: boolean = false;
  private readonly RETRY_DELAY_MS; // Configurable retry delay
  private readonly QUEUE_KEY = 'blockchain_operations';
  private readonly PROCESSING_QUEUE_KEY = 'blockchain_operations_processing';
  private readonly FAILED_QUEUE_KEY = 'blockchain_operations_failed';
  private queueSizeLoggingInterval: ReturnType<typeof setInterval>;
  private pausedQueues: Map<string, number> = new Map(); // Track paused queues and their resume time
  private readonly BIGINT_PREFIX = 'BIGINT:';
  private readonly PROCESSED_EVENTS_SET = 'processed_events';

  // Queue key helpers
  private getQueueKey(chain: string, contract: string, type: 'main' | 'processing' | 'failed' = 'main'): string {
    return `queue:${chain}:${contract}:${type}`;
  }

  private getProcessedSetKey(chain: string, contract: string): string {
    return `processed:${chain}:${contract}`;
  }

  constructor(private configService: ConfigService) {
    this.redisClient = new Redis(this.configService.get<string>('REDIS_URL'));
    this.RETRY_DELAY_MS = this.configService.get<number>('QUEUE_RETRY_DELAY_MS', 5000);
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
    const processingKeys = await this.redisClient.keys('queue:*:processing');
    
    for (const processingKey of processingKeys) {
      const [_, chain, contract] = processingKey.split(':');
      const mainKey = this.getQueueKey(chain, contract);
      
      const operations = await this.redisClient.zrange(processingKey, 0, -1, 'WITHSCORES');
      
      if (operations.length > 0) {
        const multi = this.redisClient.multi();
        
        for (let i = 0; i < operations.length; i += 2) {
          const [operationJson, blockHeight] = [operations[i], operations[i + 1]];
          multi.zadd(mainKey, parseInt(blockHeight), operationJson);
        }
        
        multi.del(processingKey);
        await multi.exec();
        
        Logger.log(`Recovered ${operations.length / 2} operations for ${chain}:${contract}`);
      }
    }
  }

  public async getQueueSize(): Promise<number> {
    return this.redisClient.zcard(this.QUEUE_KEY);
  }

  async publishOperation(operation: { name: string; args: any[] }) {
    Logger.debug(`Publishing operation: ${operation.name}`);
    await this.ensureInitialized();
    
    try {
      const chain = operation.args[0];     // Chain name is first argument
      const contract = operation.args[1].toString('hex');  // Contract address is second argument
      const blockHeight = operation.args[2]; // Block height
      const eventId = operation.args[3];     // Event ID

      // Check if already processed
      const processedKey = this.getProcessedSetKey(chain, contract);
      const wasSet = await this.redisClient.sadd(processedKey, eventId);
      
      if (!wasSet) {
        Logger.debug(`Event already processed or queued: ${eventId} for ${chain}:${contract}`);
        return;
      }

      const queueKey = this.getQueueKey(chain, contract);
      const serializedOperation = this.serializeOperation(operation);
      await this.redisClient.zadd(queueKey, blockHeight, serializedOperation);
      Logger.debug(`Published operation: ${operation.name} for block ${blockHeight} to queue ${queueKey}`);
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
        // Get all queue keys
        const queueKeys = await this.redisClient.keys('queue:*:main');
        
        for (const queueKey of queueKeys) {
          const [_, chain, contract] = queueKey.split(':');
          
          // Skip if queue is paused
          if (this.isQueuePaused(chain, contract)) {
            continue;
          }

          const result = await this.redisClient
            .multi()
            .zrange(queueKey, 0, 0, 'WITHSCORES')
            .zremrangebyrank(queueKey, 0, 0)
            .exec();

          if (!result || !result[0][1] || (result[0][1] as string[]).length === 0) {
            continue;
          }

          const [operationJson, blockHeight] = (result[0][1] as string[]);
          const processingKey = this.getQueueKey(chain, contract, 'processing');
          
          await this.redisClient.zadd(processingKey, parseInt(blockHeight), operationJson);
          
          const operation = this.deserializeOperation(operationJson);
          Logger.debug(`Processing operation: ${operation.name} from block ${blockHeight} for ${chain}:${contract}`);

          try {
            await callback(operation);
            await this.redisClient.zrem(processingKey, operationJson);
            Logger.debug(`Successfully processed operation: ${operation.name} from block ${blockHeight}`);
          } catch (error) {
            const failedKey = this.getQueueKey(chain, contract, 'failed');
            
            await this.redisClient
              .multi()
              .zrem(processingKey, operationJson)
              .zadd(queueKey, parseInt(blockHeight), operationJson) // Put back at front of main queue
              .exec();

            Logger.error(`Failed to process operation for ${chain}:${contract}, pausing queue`, error);
            this.pauseQueue(chain, contract);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        Logger.error('Error in operation consumption loop:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private isQueuePaused(chain: string, contract: string): boolean {
    const resumeTime = this.pausedQueues.get(`${chain}:${contract}`);
    if (!resumeTime) return false;
    
    if (Date.now() >= resumeTime) {
      this.pausedQueues.delete(`${chain}:${contract}`);
      return false;
    }
    return true;
  }

  private pauseQueue(chain: string, contract: string) {
    this.pausedQueues.set(`${chain}:${contract}`, Date.now() + this.RETRY_DELAY_MS);
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

  private async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
}
