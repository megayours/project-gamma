import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const MegaTestERC721Module = buildModule("MegaTestERC721Module", (m) => {
  const name = m.getParameter("name", "MegaTestNFT");
  const symbol = m.getParameter("symbol", "MTNFT");
  const tokenUri = m.getParameter("token-uri", "http://localhost:3000/metadata/MegaYours/MegaTestNFT/");

  const args = [name, symbol, tokenUri];

  const megaTestERC721 = m.contract(`MegaTestERC721`, args);

  console.log(`Arguments for verification: ${args.join(" ")}`);

  return { megaTestERC721 };
});

export default MegaTestERC721Module;
