import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChromiaService } from './services/chromiaService';
import { EvmPublisherService } from './services/evmPublisherService';
import { EventProcessorService } from './services/eventProcessorService';
import { MetadataService } from './services/metadataService';
import { QueueService } from './services/queueService';
import { ChainConfigService } from './config/chainConfig';
import { ContractService } from './services/contractService';
import { ContractEventListener } from './services/contractEventListener';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
  ],
  controllers: [],
  providers: [
    ChromiaService,
    EvmPublisherService,
    EventProcessorService,
    MetadataService,
    QueueService,
    ChainConfigService,
    ContractService,
    ContractEventListener
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private eventPublisherService: EvmPublisherService) {}

  async onModuleInit() {
    // Ensure EventPublisherService is initialized
    await this.eventPublisherService.onModuleInit();
  }
}
