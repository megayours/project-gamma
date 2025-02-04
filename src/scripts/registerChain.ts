import { createClient, newSignatureProvider } from 'postchain-client';
import { Logger } from '../utils/logger';
import yargs from 'yargs';
import * as dotenv from 'dotenv';

dotenv.config();

async function registerChain() {
  const argv = yargs(process.argv.slice(2))
    .option('chain', { type: 'string', demandOption: true })
    .strict(false)
    .parse() as {
      chain: string;
    };

  const nodeUrl = process.env.CHROMIA_NODE_URL;
  const blockchainRid = process.env.CHROMIA_BLOCKCHAIN_RID;
  const adminPrivateKey = process.env.CHROMIA_ADMIN_PRIVATE_KEY;

  if (!nodeUrl || !blockchainRid || !adminPrivateKey) {
    throw new Error('Missing required environment variables');
  }

  const client = await createClient({
    directoryNodeUrlPool: [nodeUrl],
    blockchainRid,
  });

  const signatureProvider = newSignatureProvider({ privKey: adminPrivateKey });

  try {
    await client.signAndSendUniqueTransaction({
      name: 'tokens.register_chain',
      args: [
        argv.chain,
      ],
    }, signatureProvider);
    Logger.log(`Successfully registered chain ${argv.chain}`);
  } catch (error) {
    Logger.error('Error registering chain:', error);
  }
}

registerChain().catch(error => {
  Logger.error('Unhandled error in registerChain script:', error);
  process.exit(1);
});
