#! /bin/bash

# Help text function
print_usage() {
    echo "Usage: ./register-chain.sh [chain_id]"
    echo
    echo "Register a new chain in the Chromia blockchain"
    echo
    echo "Arguments:"
    echo "  chain_id    The ID of the chain to register"
    echo
    echo "Environment variables required:"
    echo "  CHROMIA_NODE_URL           URL of the Chromia node"
    echo "  CHROMIA_BLOCKCHAIN_RID     Blockchain RID"
    echo "  CHROMIA_ADMIN_PRIVATE_KEY  Admin private key"
    echo
    echo "Example:"
    echo "  ./register-chain.sh 1"
}

# Check for help flag
if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    print_usage
    exit 0
fi

# Check if argument is provided
if [ -z "$1" ]; then
    echo "Error: Chain ID argument is required"
    echo
    print_usage
    exit 1
fi

# Load .env file
source .env

# Check if required environment variables are set
if [ -z "$CHROMIA_NODE_URL" ] || [ -z "$CHROMIA_BLOCKCHAIN_RID" ] || [ -z "$CHROMIA_ADMIN_PRIVATE_KEY" ]; then
    echo "Error: Missing required environment variables"
    echo
    print_usage
    exit 1
fi

echo "Registering chain $1 in the Chromia blockchain $CHROMIA_NODE_URL with RID $CHROMIA_BLOCKCHAIN_RID"

chr tx \
  --api-url $CHROMIA_NODE_URL \
  --blockchain-rid $CHROMIA_BLOCKCHAIN_RID \
  tokens.register_chain \
  $1