import { createClient, newSignatureProvider } from 'postchain-client';
import { Logger } from '../utils/logger';
import yargs from 'yargs';
import * as dotenv from 'dotenv';

dotenv.config();

async function registerContract() {
  const argv = yargs(process.argv.slice(2))
    .option('chain', { type: 'string', demandOption: true })
    .option('address', { type: 'string', demandOption: true })
    .option('project', { type: 'string', demandOption: true })
    .option('collection', { type: 'string', demandOption: true })
    .option('blockHeight', { type: 'number', demandOption: true })
    .option('type', { type: 'string', demandOption: true })
    .strict(false)
    .parse() as {
      chain: string;
      address: string;
      project: string;
      collection: string;
      blockHeight: number;
      type: string;
      _: string[];
    };

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
