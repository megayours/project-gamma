import { TokenId } from "src/types/blockchain";

export class AppError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class ContractNotFoundError extends AppError {
  constructor(chainId: number, address: string) {
    super(`Contract not found: ${address} on chain ${chainId}`, 'CONTRACT_NOT_FOUND');
  }
}

export class ProviderNotFoundError extends AppError {
  constructor(chainId: number) {
    super(`Provider not found for chain ${chainId}`, 'PROVIDER_NOT_FOUND');
  }
}

export class TokenDoesNotExistError extends AppError {
  constructor(tokenId: TokenId) {
    super(`Token does not exist: ${tokenId}`, 'TOKEN_DOES_NOT_EXIST');
  }
}

export class MetadataFetchError extends AppError {
  constructor(message: string) {
    super(message, 'METADATA_FETCH_ERROR');
  }
}

// Add more specific error classes as needed
