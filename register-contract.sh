#! /bin/bash

# Help text function
print_usage() {
    echo "Usage: ./register-contract.sh [chain] [contract] [project_name] [collection_name] [block_height] [type]"
    echo
    echo "Register a new contract in the Gamma blockchain"
    echo
    echo "Arguments:"
    echo "  chain    The name of the chain to register"
    echo "  contract    The address of the contract to register"
    echo "  project_name    The name of the project"
    echo "  collection_name    The name of the collection"
    echo "  block_height    The block height the contract was deployed at"
    echo "  type    The type of the contract, e.g. 'erc721'"
    echo
    echo "Environment variables required:"
    echo "  CHROMIA_NODE_URL           URL of the Chromia node"
    echo "  CHROMIA_BLOCKCHAIN_RID     Blockchain RID"
    echo
    echo "Example:"
    echo "  ./register-contract.sh <chain> <contract> <project_name> <collection_name> <block_height> <type>"
}

# Check for help flag
if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    print_usage
    exit 0
fi

# Check if argument is provided
if [ -z "$1" ]; then
    echo "Error: Chain argument is required"
    echo
    print_usage
    exit 1
fi
if [ -z "$2" ]; then
    echo "Error: Contract argument is required"
    echo
    print_usage
    exit 1
fi
if [ -z "$3" ]; then
    echo "Error: Project name argument is required"
    echo
    print_usage
    exit 1
fi
if [ -z "$4" ]; then
    echo "Error: Collection name argument is required"
    echo
    print_usage
    exit 1
fi
if [ -z "$5" ]; then
    echo "Error: Block height argument is required"
    echo
    print_usage
    exit 1
fi
if [ -z "$6" ]; then
    echo "Error: Type argument is required"
    echo
    print_usage
    exit 1
fi

# Load .env file
source .env

# Check if required environment variables are set
if [ -z "$CHROMIA_NODE_URL" ] || [ -z "$CHROMIA_BLOCKCHAIN_RID" ]; then
    echo "Error: Missing required environment variables"
    echo
    print_usage
    exit 1
fi

echo "Registering contract $2 in the Gamma blockchain $CHROMIA_NODE_URL with RID $CHROMIA_BLOCKCHAIN_RID"

chr tx \
  --api-url $CHROMIA_NODE_URL \
  --blockchain-rid $CHROMIA_BLOCKCHAIN_RID \
  --ft-auth
  tokens.register_contract \
  $1 \
  $2 \
  $3 \
  $4 \
  $5 \
  $6