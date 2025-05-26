pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./TweetPredictionMarket.sol";

contract TweetPredictionFactory is Ownable {
    mapping(string => address) public markets;
    address[] public allMarkets;
    address public oracle;
    uint256 public defaultAlpha = 8e17; // 0.8 * 1e18
    
    event MarketCreated(
        string indexed tweetId,
        address indexed market,
        uint256 theta,
        uint256 settlementTime
    );
    
    constructor(address _oracle) {
        oracle = _oracle;
    }
    
    function createMarket(
        string calldata tweetId,
        uint256 theta,
        uint256 settlementDuration
    ) external returns (address) {
        require(markets[tweetId] == address(0), "Market already exists");
        require(theta > 0, "Theta must be positive");
        require(settlementDuration > 0, "Duration must be positive");
        
        uint256 settlementTime = block.timestamp + settlementDuration;
        
        TweetPredictionMarket market = new TweetPredictionMarket(
            tweetId,
            theta,
            defaultAlpha,
            settlementTime,
            oracle
        );
        
        markets[tweetId] = address(market);
        allMarkets.push(address(market));
        
        emit MarketCreated(tweetId, address(market), theta, settlementTime);
        return address(market);
    }
    
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }
    
    function setDefaultAlpha(uint256 _alpha) external onlyOwner {
        defaultAlpha = _alpha;
    }
    
    function getMarket(string calldata tweetId) external view returns (address) {
        return markets[tweetId];
    }
    
    function getAllMarkets() external view returns (address[] memory) {
        return allMarkets;
    }
    
    function withdrawFees(address market) external onlyOwner {
        TweetPredictionMarket(market).withdrawProtocolFees();
    }
    
    receive() external payable {}
}
