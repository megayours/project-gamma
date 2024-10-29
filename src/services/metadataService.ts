import { Injectable } from '@nestjs/common';
import { Logger } from '../utils/logger';
import { ContractService } from './contractService';
import fetch from 'node-fetch';
import { ChainName, ContractAddress, ContractType, TokenId } from '../types/blockchain';
import { MetadataFetchError, TokenDoesNotExistError } from '../utils/errors';
import { ChainConfigService } from '../config/chainConfig';

@Injectable()
export class MetadataService {
  constructor(private contractService: ContractService, private chainConfigService: ChainConfigService) { }

  async getTokenMetadata(chain: ChainName, contractAddress: ContractAddress, type: ContractType, tokenId: TokenId): Promise<any> {
    try {
      const tokenUri = await this.getTokenUri(chain, contractAddress, type, tokenId);
      if (!tokenUri) {
        throw new TokenDoesNotExistError(tokenId);
      }
      return await this.fetchMetadataWithRetry(tokenUri);
    } catch (error) {
      if (error instanceof TokenDoesNotExistError) throw error;
      Logger.error(`Error fetching metadata for token ${tokenId} on contract ${contractAddress} (${chain}):`, error);
      throw error;
    }
  }

  async getTokenUri(chain: ChainName, contractAddress: ContractAddress, type: ContractType, tokenId: TokenId): Promise<string | null> {
    Logger.debug(`Getting tokenURI for ${tokenId} on ${contractAddress} (${chain})`);
    const contract = this.contractService.getContract(this.chainConfigService.getChainIdByName(chain), contractAddress);
    Logger.debug(`Got contract for ${tokenId} on ${contractAddress} (${chain})`);
    try {
      Logger.debug(`Type: ${type}`);
      if (type === 'erc721') {
        Logger.debug(`Fetching ERC721 tokenURI for ${tokenId} on ${contractAddress} (${chain})`);
        // Try ERC721 tokenURI function
        return await contract.tokenURI(tokenId);
      } else if (type === 'erc1155') {
        // Try ERC1155 uri function
        Logger.log(`Fetching ERC1155 tokenURI for ${tokenId} on ${contractAddress} (${chain})`);
        return await contract.uri(tokenId);
      }
    } catch (error) {
      if (error.message.includes('ERC721: invalid token ID')) {
        throw new TokenDoesNotExistError(tokenId);
      }
      Logger.error(`Error fetching tokenURI for ${tokenId} on ${contractAddress} (${chain}):`, error);
      return null;
    }
  }

  async fetchMetadataWithRetry(tokenUri: string, maxRetries = 5, maxRetryTime = 60000): Promise<any> {
    const startTime = Date.now();
    let retryCount = 0;

    while (retryCount < maxRetries && Date.now() - startTime < maxRetryTime) {
      try {
        const httpUrl = this.ipfsToHttp(tokenUri);
        Logger.debug(`Fetching metadata from ${httpUrl}`);
        const response = await fetch(httpUrl);

        if (response.ok) {
          return await response.json();
        } else if (response.status >= 500) {
          // Server error, retry
          retryCount++;
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10 seconds
          Logger.debug(`Received ${response.status}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Client error or other, don't retry
          throw new MetadataFetchError(`HTTP error! status: ${response.status}`);
        }
      } catch (error) {
        if (error instanceof MetadataFetchError) {
          throw error; // Don't retry client errors
        }
        Logger.error(`Error fetching metadata from ${tokenUri}:`, error);
        retryCount++;
        if (Date.now() - startTime >= maxRetryTime) {
          break;
        }
      }
    }

    // If we've exhausted retries or exceeded max retry time, return placeholder metadata
    Logger.error(`Failed to fetch metadata after retries, using placeholder for ${tokenUri}`);
    return this.getPlaceholderMetadata();
  }

  private ipfsToHttp(uri: string): string {
    if (uri.startsWith('ipfs://')) {
      return uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }
    return uri;
  }

  private getPlaceholderMetadata(): any {
    return {
      name: "Unavailable",
      description: "Metadata could not be fetched",
      image: "https://example.com/placeholder-image.png",
      attributes: [],
    };
  }
}
