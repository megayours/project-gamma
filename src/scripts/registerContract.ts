import { createClient, newSignatureProvider } from 'postchain-client';
import { Logger } from '../utils/logger';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';

dotenv.config();

async function registerContract() {
  const argv = await yargs(hideBin(process.argv))
    .option('chain', {
      alias: 'c',
      type: 'string',
      description: 'Blockchain name',
      demandOption: true
    })
    .option('address', {
      alias: 'a',
      type: 'string',
      description: 'Contract address',
      demandOption: true
    })
    .option('project', {
      alias: 'p',
      type: 'string',
      description: 'Project name',
      demandOption: true
    })
    .option('collection', {
      alias: 'l',
      type: 'string',
      description: 'Collection name',
      demandOption: true
    })
    .option('blockHeight', {
      alias: 'b',
      type: 'number',
      description: 'Block height',
      demandOption: true
    })
    .option('type', {
      alias: 't',
      type: 'string',
      description: 'Contract type',
      demandOption: true
    })
    .help()
    .alias('help', 'h')
    .parseAsync();

  const nodeUrl = process.env.CHROMIA_NODE_URL;
  const blockchainRid = process.env.CHROMIA_BLOCKCHAIN_RID;
  const adminPrivateKey = process.env.CHROMIA_ADMIN_PRIVATE_KEY;

  if (!nodeUrl || !blockchainRid || !adminPrivateKey) {
    throw new Error('Missing required environment variables');
  }

  const client = await createClient({
    nodeUrlPool: [nodeUrl],
    blockchainRid,
  });

  const signatureProvider = newSignatureProvider({ privKey: adminPrivateKey });

  try {
    await client.signAndSendUniqueTransaction({
      name: 'oracle.register_contract',
      args: [
        argv.chain,
        Buffer.from(argv.address.replace('0x', ''), 'hex'),
        argv.project,
        argv.collection,
        argv.blockHeight,
        argv.type
      ],
    }, signatureProvider);
    Logger.log(`Successfully registered contract ${argv.address} on chain ${argv.chain}`);
  } catch (error) {
    Logger.error('Error registering contract:', error);
  }
}

registerContract().catch(error => {
  Logger.error('Unhandled error in registerContract script:', error);
  process.exit(1);
});
