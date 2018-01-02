pragma solidity 0.4.15;


contract OracleInterface {
    function query(address token, function(address, uint256) external callback) public returns (bool);
}
