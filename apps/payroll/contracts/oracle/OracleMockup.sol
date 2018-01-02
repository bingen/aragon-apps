pragma solidity 0.4.15;

import "./OracleInterface.sol";


contract PayrollInterface {
    function setExchangeRate(address, uint256) external;
}


contract OracleMockup is OracleInterface {
    PayrollInterface public payroll;

    event OracleLogQuery(address sender, address token);
    event OracleLogSetPayroll(address sender, address pr);
    event OracleLogSetRate(address sender, address token, uint256 value);

    function OracleMockup() {}

    function query(address token, function(address, uint256) external callback) public returns(bool) {
        uint256 rate = toInt(token);
        callback(token, rate);
        OracleLogQuery(msg.sender, token);
        return true;
    }

    function setPayroll(address pr) public {
        payroll = PayrollInterface(pr);
        OracleLogSetPayroll(msg.sender, pr);
    }

    function setRate(address token, uint256 value) public {
        payroll.setExchangeRate(token, value);
        OracleLogSetRate(msg.sender, token, value);
    }

    /// Gets the first byte of an address as an integer
    function toInt(address x) public constant returns(uint256 i) {
        i = uint(x);
        i = i >> 152;
        if (i == 0)
            i = 1;
        i = i * 10**8;
    }
}
