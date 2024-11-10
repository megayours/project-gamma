import { Logger } from '../utils/logger';
import yargs from 'yargs';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

// Minimal ERC721 ABI for minting
const ERC721_ABI = [
  'function mint(address to) public',
  'function name() view returns (string)',
  'function symbol() view returns (string)'
];

async function mint() {
  const argv = yargs(process.argv.slice(2))
    .option('contract', { type: 'string', demandOption: true })
    .option('amount', { type: 'number', demandOption: true })
    .option('wallet', { type: 'string', demandOption: false })
    .option('privateKey', { type: 'string', demandOption: true })
    .strict(false)
    .parse() as {
      contract: string;
      amount: number;
      wallet?: string;
      privateKey: string;
      _: string[];
    };

  // Connect to the blockchain
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_AMOY_RPC_URL);
  
  try {
    // Use the provided private key for signing
    const signer = new ethers.Wallet(argv.privateKey, provider);
    const contract = new ethers.Contract(argv.contract, ERC721_ABI, signer);
    
    const name = await contract.name();
    const symbol = await contract.symbol();
    console.log(`Minting ${argv.amount} tokens for contract ${name} (${symbol})`);
    console.log(`Using signer address: ${signer.address}`);

    if (argv.wallet) {
      // Mint all tokens to the specified wallet
      console.log(`Minting to specified wallet: ${argv.wallet}`);
      for (let i = 0; i < argv.amount; i++) {
        const tx = await contract.mint(argv.wallet);
        await tx.wait();
        console.log(`Minted token ${i + 1}/${argv.amount} to ${argv.wallet}`);
      }
    } else {
      // Create new wallets and mint one token to each
      console.log(`Creating ${argv.amount} new wallets and minting...`);
      for (let i = 0; i < argv.amount; i++) {
        const destinationWallet = ethers.Wallet.createRandom();
        const tx = await contract.mint(destinationWallet.address);
        await tx.wait();
        console.log(`Minted token ${i + 1}/${argv.amount} to new wallet:`);
        console.log(`  Address: ${destinationWallet.address}`);
        console.log(`  Private Key: ${destinationWallet.privateKey}`);
      }
    }

    console.log('Minting completed successfully');
  } catch (error) {
    Logger.error('Error during minting:', error);
    throw error;
  }
}

mint().catch(error => {
  Logger.error('Unhandled error in mint script:', error);
  process.exit(1);
});
