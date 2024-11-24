#! /bin/bash

PRIVATE_KEY=$1

bun run src/scripts/registerContract.ts --chain Ethereum --address 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8 --project \"The Igloo Company\" --collection \"Pudgy Penguins\" --blockHeight 12876179 --type erc721 --privateKey $PRIVATE_KEY