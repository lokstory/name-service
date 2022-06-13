// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

contract NameStorage {
    /**
    * @dev Key: account, value: name
     */
    mapping(address => string) _accountNames;

    /**
    * @dev Key: name, value: whether the name is already in use
     */
    mapping(string => bool) _names;

    /**
    * @dev Assert the name is not being used.
    * When duplicated names, or the name is the same as the sender's name,
    * throw an error.
    */
    modifier nameNotDuplicated(string memory name) {
        require(!isNameExists(name), "NameStorage: duplicated names");

        _;
    }

    function setName(string memory name) external nameNotDuplicated(name) {
        require(bytes(name).length > 0, "NameStorage: empty name");

        // Remove original name from names
        if (bytes(_accountNames[msg.sender]).length > 0) {
            _names[_accountNames[msg.sender]] = false;
        }

        _accountNames[msg.sender] = name;

        // Update in use status to true
        _names[name] = true;
    }

    function readName() external view returns (string memory) {
        return _accountNames[msg.sender];
    }

    function isNameExists(string memory name) public view returns (bool) {
        return _names[name];
    }
}
