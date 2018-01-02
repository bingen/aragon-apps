pragma solidity 0.4.15;

import "./OracleInterface.sol";


contract PayrollInterface {
    function setExchangeRate(address, uint256) external;
}


contract OracleFailMockup is OracleInterface {
    PayrollInterface public payroll;
    uint256 public exchangeRate;

    event OracleFailLogQuery (address sender, address token);
    event OracleFailLogSetPayroll (address sender, address pr);
    event OracleFailLogSetRate (address sender, address token, uint256 value);

    function query(address token, function(address, uint256) external callback) public returns(bool) {
        uint256 rate = 0;
        callback(token, rate);
        OracleFailLogQuery(msg.sender, token);
        return true;
    }

    function setPayroll(address pr) public {
        payroll = PayrollInterface(pr);
        OracleFailLogSetPayroll(msg.sender, pr);
    }

    function setRate(address token, uint256 value) public {
        payroll.setExchangeRate(token, value);
        OracleFailLogSetRate(msg.sender, token, value);
    }

}
