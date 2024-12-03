import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChainConfig, ContractABI, ChainId, ChainName } from '../types/blockchain';

@Injectable()
export class ChainConfigService {
  private chainConfigs: ChainConfig[];
  private contractABIs: ContractABI;

  constructor(private configService: ConfigService) {
    this.chainConfigs = [
      {
        chainId: 1,
        chainName: 'ethereum',
        rpcUrl: this.configService.get<string>('ETHEREUM_RPC_URL') || '',
      },
      {
        chainId: 137,
        chainName: 'polygon',
        rpcUrl: this.configService.get<string>('POLYGON_RPC_URL') || '',
      },
      {
        chainId: 42161,
        chainName: 'amoy',
        rpcUrl: this.configService.get<string>('POLYGON_AMOY_RPC_URL') || '',
      },
      {
        chainId: 97,
        chainName: 'bsc_testnet',
        rpcUrl: this.configService.get<string>('BSC_TESTNET_RPC_URL') || '',
      }
      // Add more chains as needed
    ];

    this.contractABIs = {
      erc721: [
        // ERC721 ABI
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
        "function balanceOf(address owner) view returns (uint256 balance)",
        "function ownerOf(uint256 tokenId) view returns (address owner)",
        "function safeTransferFrom(address from, address to, uint256 tokenId)",
        "function transferFrom(address from, address to, uint256 tokenId)",
        "function approve(address to, uint256 tokenId)",
        "function getApproved(uint256 tokenId) view returns (address operator)",
        "function setApprovalForAll(address operator, bool _approved)",
        "function isApprovedForAll(address owner, address operator) view returns (bool)",
        "function tokenURI(uint256 tokenId) view returns (string memory)"
      ],
      erc1155: [
        // ERC1155 ABI
        "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
        "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
        "function balanceOf(address account, uint256 id) view returns (uint256)",
        "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
        "function setApprovalForAll(address operator, bool approved)",
        "function isApprovedForAll(address account, address operator) view returns (bool)",
        "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
        "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
        "function uri(uint256 id) view returns (string memory)"
      ],
    };
  }

  getChainConfigs(): ChainConfig[] {
    return this.chainConfigs;
  }

  getChainNameById(chainId: ChainId): ChainName | undefined {
    const chain = this.chainConfigs.find(config => config.chainId === chainId);
    return chain?.chainName;
  }

  getChainIdByName(chainName: ChainName): ChainId | undefined {
    const chain = this.chainConfigs.find(config => config.chainName.toLowerCase() === chainName.toLowerCase());
    return chain?.chainId;
  }

  getChainConfigById(chainId: ChainId): ChainConfig | undefined {
    return this.chainConfigs.find(config => config.chainId === chainId);
  }

  getChainConfigByName(chainName: ChainName): ChainConfig | undefined {
    return this.chainConfigs.find(config => config.chainName.toLowerCase() === chainName.toLowerCase());
  }

  getContractABI(contractType: keyof ContractABI): string[] | undefined {
    return this.contractABIs[contractType];
  }
}
