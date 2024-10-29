import { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.27",
  networks: {
    amoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "",
      accounts: [process.env.PRIVATE_KEY || ""],
    },
  },
  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY || "",
  },
  sourcify: {
    enabled: true
  }
};

export default config;
