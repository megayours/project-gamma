#!/bin/bash

cd docker
docker compose down
docker compose up -d postgres redis
sleep 5
docker compose up -d tokenchain
cd ..

sleep 5

BLOCKCHAIN_RID=$(curl http://localhost:7740/brid/iid_1)
echo "Blockchain ID: $BLOCKCHAIN_RID"

# Replace CHROMIA_BLOCKCHAIN_RID in .env with $BLOCKCHAIN_RID
sed -i '' "s/CHROMIA_BLOCKCHAIN_RID=.*/CHROMIA_BLOCKCHAIN_RID=$BLOCKCHAIN_RID/" .env
