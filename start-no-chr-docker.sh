#!/bin/bash

cd docker
docker compose down
docker compose up -d postgres redis
cd ..
