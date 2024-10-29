// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MegaTestERC721
 * @dev This contract is for testing purposes only.
 * @notice This contract allows anyone to mint tokens, which is not secure for production use.
 * @custom:security-contact security@example.com
 */
contract MegaTestERC721 is ERC721Enumerable, Ownable {
    uint256 private _tokenIdCounter;
    string private _baseTokenURI;

    event Minted(address indexed to, uint256 indexed tokenId);

    /**
     * @dev Constructor that sets the name, symbol, and base URI of the token.
     * @param name The name of the token.
     * @param symbol The symbol of the token.
     * @param baseTokenURI The base URI for token metadata.
     */
    constructor(string memory name, string memory symbol, string memory baseTokenURI) 
        ERC721(name, symbol)
        Ownable(msg.sender)
    {
        _baseTokenURI = baseTokenURI;
    }

    /**
     * @dev Mints a new token.
     * @notice This function allows anyone to mint tokens, which is not secure for production use.
     * @param to The address that will own the minted token.
     * @return tokenId The ID of the newly minted token.
     */
    function mint(address to) public returns (uint256) {
        uint256 tokenId = _tokenIdCounter;
        _safeMint(to, tokenId);
        emit Minted(to, tokenId);
        _tokenIdCounter += 1;
        return tokenId;
    }

    /**
     * @dev Returns the base URI for token metadata.
     * @return string The base URI.
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * @dev Sets a new base URI for token metadata.
     * @param newBaseTokenURI The new base URI to set.
     */
    function setBaseURI(string memory newBaseTokenURI) public onlyOwner {
        _baseTokenURI = newBaseTokenURI;
    }
}
