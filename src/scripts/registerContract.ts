import { createClient, encryption, IClient, KeyPair, newSignatureProvider } from 'postchain-client';
import { Account, AuthFlag, Connection, createConnection, createInMemoryEvmKeyStore, createInMemoryFtKeyStore, createInMemoryLoginKeyStore, createKeyStoreInteractor, createSingleSigAuthDescriptorRegistration, EvmKeyStore, FtKeyStore, KeyStore, login, LoginKeyStore, op, registerAccount, registrationStrategy, Session, SessionWithLogout } from '@chromia/ft4';
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
    .option('privateKey', { type: 'string', demandOption: true })
    .strict(false)
    .parse() as {
      chain: string;
      address: string;
      project: string;
      collection: string;
      blockHeight: number;
      type: string;
      privateKey: string;
      _: string[];
    };

  const nodeUrl = process.env.CHROMIA_NODE_URL;
  const blockchainRid = process.env.CHROMIA_BLOCKCHAIN_RID;

  if (!nodeUrl || !blockchainRid) {
    throw new Error('Missing required environment variables');
  }

  const client = await createClient({
    directoryNodeUrlPool: [nodeUrl],
    blockchainRid,
  });

  const keyPair = encryption.makeKeyPair(argv.privateKey);

  const keyStore = createInMemoryFtKeyStore(keyPair);
  const { getAccounts } = createKeyStoreInteractor(client, keyStore);
  const accounts = await getAccounts();

  const session: Session = accounts.length > 0 ? await loginSession(createConnection(client), keyStore, accounts[0]) : (await registerAccountSession(client, keyStore, keyPair)).session;

  try {
    await session.transactionBuilder()
      .add(op('tokens.register_contract',
        argv.chain,
        Buffer.from(argv.address.replace('0x', ''), 'hex'),
        argv.project,
        argv.collection,
        argv.blockHeight,
        argv.type
      ))
      .buildAndSend();
    Logger.log(`Successfully registered contract ${argv.address} on chain ${argv.chain}`);
  } catch (error) {
    Logger.error('Error registering contract:', error);
  }
}

registerContract().catch(error => {
  Logger.error('Unhandled error in registerContract script:', error);
  process.exit(1);
});

const loginSession = async (connection: Connection, keyStore: FtKeyStore, account: Account) => {
  const { session } = await login(connection, keyStore, { accountId: account.id });
  return session;
}

const registerAccountSession = async (client: IClient, keyStore: FtKeyStore, keyPair: KeyPair) => {
  const authDescriptor = createSingleSigAuthDescriptorRegistration([AuthFlag.Account, AuthFlag.Transfer], keyPair.pubKey);
  return registerAccount(client, keyStore, registrationStrategy.open(authDescriptor));
};
