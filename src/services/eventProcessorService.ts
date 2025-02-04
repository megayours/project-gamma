import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '../utils/logger';
import { ChromiaService } from './chromiaService';
import { QueueService } from './queueService';
import { Constants } from '../utils/constants';
import { client } from '../utils/posthog';

@Injectable()
export class EventProcessorService implements OnModuleInit, OnModuleDestroy {
  private processingLock = new AsyncLock();
  private operationBatch: Array<{ name: string; args: any[] }> = [];
  private batchStartTime: number = Date.now();
  private batchCheckInterval: NodeJS.Timer;

  constructor(
    private chromiaService: ChromiaService,
    private queueService: QueueService
  ) {}

  async onModuleInit() {
    // Start the background batch checker
    this.batchCheckInterval = setInterval(
      () => this.checkAndPublishBatch(),
      Constants.CHROMIA_BATCH_CHECK_INTERVAL_MS // e.g., 1000ms
    );
    await this.startOperationProcessing();
  }

  async onModuleDestroy() {
    // Clean up the interval when the service is destroyed
    if (this.batchCheckInterval) {
      clearInterval(this.batchCheckInterval);
    }
  }

  private async startOperationProcessing() {
    try {
      Logger.log('EventProcessorService: Starting operation processing');
      await this.queueService.consumeOperations(async (operation: { name: string; args: any[] }) => {
        Logger.debug(`EventProcessorService: Received operation for processing: ${operation.name}`);
        await this.processingLock.acquire('processing', async () => {
          await this.processOperation(operation);
        });
      });
    } catch (error) {
      Logger.error('EventProcessorService: Failed to start consuming operations', error);
    }
  }

  private async processOperation(operation: { name: string; args: any[] }): Promise<void> {
    try {
      Logger.debug(`EventProcessorService: Started processing operation: ${operation.name}`);
      
      this.operationBatch.push(operation);

      if (this.shouldPublishBatch()) {
        await this.publishBatch();
      } else {
        Logger.debug(`EventProcessorService: Not publishing batch of ${this.operationBatch.length} operations`);
      }

      Logger.debug(`EventProcessorService: Finished processing operation: ${operation.name}`);
    } catch (error) {
      Logger.error(`EventProcessorService: Error processing operation ${operation.name}:`, error);
      throw error; // Re-throw to trigger queue retry mechanism
    }
  }

  private shouldPublishBatch(): boolean {
    const batchIsFull = this.operationBatch.length >= Constants.CHROMIA_BATCH_SIZE;
    const maxWaitTimeExceeded = Date.now() - this.batchStartTime >= Constants.CHROMIA_MAX_BATCH_WAIT_MS;
    return batchIsFull || (this.operationBatch.length > 0 && maxWaitTimeExceeded);
  }

  private async publishBatch(): Promise<void> {
    Logger.debug(`EventProcessorService: Publishing batch of ${this.operationBatch.length} operations`);
    if (this.operationBatch.length === 0) return;

    const batchToProcess = [...this.operationBatch]; // Create a copy of the batch
    this.operationBatch = []; // Clear the batch immediately
    this.batchStartTime = Date.now(); // Reset the batch start time

    try {
      await this.chromiaService.batchProcessEvents(batchToProcess);
      Logger.log(`Published batch of ${batchToProcess.length} operations`);
      client.capture({ distinctId: 'event_processor', event: 'events_published', properties: { batch_size: batchToProcess.length } });
    } catch (error) {
      Logger.error('Error processing operation batch:', error);
      // Add failed operations back to the batch
      this.operationBatch.push(...batchToProcess);
      throw error;
    }
  }

  private async checkAndPublishBatch(): Promise<void> {
    try {
      await this.processingLock.acquire('processing', async () => {
        if (this.shouldPublishBatch()) {
          await this.publishBatch();
        }
      });
    } catch (error) {
      Logger.error('Error in batch check interval:', error);
    }
  }
}

// Add this helper class for proper locking
class AsyncLock {
  private locks: Map<string, Promise<void>> = new Map();

  async acquire(key: string, fn: () => Promise<void>): Promise<void> {
    // Wait for any existing lock to be released
    const existingLock = this.locks.get(key);
    if (existingLock) {
      await existingLock;
    }

    // Create a new lock
    let resolve: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    this.locks.set(key, promise);

    try {
      await fn();
    } finally {
      resolve!();
      this.locks.delete(key);
    }
  }
}
