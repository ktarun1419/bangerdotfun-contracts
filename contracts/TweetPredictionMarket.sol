pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IEngagementOracle {
    function getEngagementScore(
        string calldata tweetId
    ) external view returns (uint256);

    function requestEngagementScore(string calldata tweetId) external;
}

contract LongToken is ERC20 {
    address public market;

    constructor(
        string memory tweetId
    )
        ERC20(
            string(abi.encodePacked("LONG-", tweetId)),
            string(abi.encodePacked("L", tweetId))
        )
    {
        market = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == market, "Only market can mint");
        _mint(to, amount);
    }
}

contract ShortToken is ERC20 {
    address public market;

    constructor(
        string memory tweetId
    )
        ERC20(
            string(abi.encodePacked("SHORT-", tweetId)),
            string(abi.encodePacked("S", tweetId))
        )
    {
        market = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == market, "Only market can mint");
        _mint(to, amount);
    }
}

contract TweetPredictionMarket is ReentrancyGuard {
    // Market Parameters
    string public tweetId;
    uint256 public theta; // Average engagement score (scaled by 1e18)
    uint256 public alpha; // Threshold multiplier (scaled by 1e18, e.g., 0.8 = 8e17)
    uint256 public settlementTime;

    // Bonding Curve Parameters
    uint256 public constant A_DEFAULT = 1e15; // 0.001 * 1e18
    uint256 public constant B_DEFAULT = 1e14; // 0.0001 * 1e18
    uint256 public a;
    uint256 public b;

    // Fee Parameters
    uint256 public constant TRADE_FEE_RATE = 1e14; // 0.01% = 0.0001 * 1e18
    uint256 public constant SETTLE_RAKE_RATE = 1e16; // 1% = 0.01 * 1e18
    uint256 public constant FEE_PRECISION = 1e18;

    // Market State
    LongToken public longToken;
    ShortToken public shortToken;
    uint256 public longSupply;
    uint256 public shortSupply;
    uint256 public longReserve;
    uint256 public shortReserve;
    uint256 public protocolFees;
    uint256 public totalReserve;
    bool public settled;

    // Settlement
    uint256 public finalEngagement;
    bool public longWon;

    // Oracle
    IEngagementOracle public oracle;
    address public factory;

    // Tracking
    struct Buyer {
        uint256 longTokens;
        uint256 shortTokens;
        uint256 totalInvested;
        bool claimed;
    }
    mapping(address => Buyer) public buyers;
    address[] public buyersList;

    // Events
    event TokensPurchased(
        address indexed buyer,
        bool isLong,
        uint256 tokens,
        uint256 cost
    );
    event MarketSettled(uint256 engagement, bool longWon);
    event RewardsClaimed(address indexed buyer, uint256 amount);

    constructor(
        string memory _tweetId,
        uint256 _theta,
        uint256 _alpha,
        uint256 _settlementTime,
        address _oracle
    ) {
        tweetId = _tweetId;
        theta = _theta;
        alpha = _alpha;
        settlementTime = _settlementTime;
        oracle = IEngagementOracle(_oracle);
        factory = msg.sender;

        a = A_DEFAULT;
        b = B_DEFAULT;

        longToken = new LongToken(_tweetId);
        shortToken = new ShortToken(_tweetId);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // TRADING FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════════

    function buy(bool isLong, uint256 tokens) external payable nonReentrant {
        require(!settled, "Market already settled");
        require(block.timestamp < settlementTime, "Trading period ended");
        require(tokens > 0, "Tokens must be positive");

        // Calculate cost using coupled bonding curve
        uint256 totalSupply = longSupply + shortSupply;
        uint256 cost = calculateMintCost(totalSupply, tokens);
        require(msg.value >= cost, "Insufficient payment");

        // Calculate fees
        uint256 fee = (cost * TRADE_FEE_RATE) / FEE_PRECISION;
        uint256 netAmount = cost - fee;

        // Update state
        protocolFees += fee;

        if (isLong) {
            longSupply += tokens;
            longReserve += netAmount;
            longToken.mint(msg.sender, tokens);
        } else {
            shortSupply += tokens;
            shortReserve += netAmount;
            shortToken.mint(msg.sender, tokens);
        }

        // Track buyer
        if (buyers[msg.sender].totalInvested == 0) {
            buyersList.push(msg.sender);
        }

        Buyer storage buyer = buyers[msg.sender];
        if (isLong) {
            buyer.longTokens += tokens;
        } else {
            buyer.shortTokens += tokens;
        }
        buyer.totalInvested += tokens;
        totalReserve += netAmount;

        // Refund excess
        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }

        emit TokensPurchased(msg.sender, isLong, tokens, cost);
    }

    function calculateMintCost(
        uint256 totalSupply,
        uint256 tokens
    ) public view returns (uint256) {
        // Coupled bonding curve: cost = a * tokens + b * (totalSupply * tokens + 0.5 * tokens^2)
        uint256 linearCost = (a * tokens) / 1e18;
        uint256 quadraticCost = (b *
            (totalSupply * tokens + (tokens * tokens) / 2)) / 1e36;
        return linearCost + quadraticCost;
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // SETTLEMENT FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════════

    function settle() external {
        require(!settled, "Already settled");
        require(
            block.timestamp >= settlementTime,
            "Settlement time not reached"
        );

        // Get engagement score from oracle
        finalEngagement = oracle.getEngagementScore(tweetId);

        // Determine outcome: long wins if engagement >= alpha * theta
        uint256 threshold = (alpha * theta) / 1e18;
        longWon = finalEngagement >= threshold;

        // Redistribute reserves

        if (longWon) {
            // Long side wins - redistribute short reserves to long
            if (shortReserve > 0 && longSupply > 0) {
                uint256 rake = (shortReserve * SETTLE_RAKE_RATE) /
                    FEE_PRECISION;
                protocolFees += rake;
                longReserve += shortReserve - rake;
                shortReserve = 0;
            }

            // If no long tokens exist, protocol keeps everything
            if (longSupply == 0) {
                protocolFees += longReserve;
                longReserve = 0;
            }
        } else {
            // Short side wins - redistribute long reserves to short
            if (longReserve > 0 && shortSupply > 0) {
                uint256 rake = (longReserve * SETTLE_RAKE_RATE) / FEE_PRECISION;
                protocolFees += rake;
                shortReserve += longReserve - rake;
                longReserve = 0;
            }

            // If no short tokens exist, protocol keeps everything
            if (shortSupply == 0) {
                protocolFees += shortReserve;
                shortReserve = 0;
            }
        }

        settled = true;
        emit MarketSettled(finalEngagement, longWon);
    }

    function claimRewards() external nonReentrant {
        require(settled, "Market not settled");
        require(!buyers[msg.sender].claimed, "Already claimed");

        Buyer storage buyer = buyers[msg.sender];
        uint256 payout = calculatePayout(msg.sender);

        require(payout > 0, "No winnings");
        buyer.claimed = true;
        payable(msg.sender).transfer(payout);
        emit RewardsClaimed(msg.sender, payout);
    }

    function calculatePayout(address user) public view returns (uint256) {
        if (!settled) return 0;

        Buyer memory buyer = buyers[user];
        uint256 payout = 0;

        // Calculate proportional share of winning pool
        if (longWon && buyer.longTokens > 0 && longSupply > 0) {
            payout = (totalReserve * buyer.longTokens) / longSupply;
        } else if (!longWon && buyer.shortTokens > 0 && shortSupply > 0) {
            payout = (totalReserve * buyer.shortTokens) / shortSupply;
        }

        return payout;
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════════

    function getCurrentPrice() external view returns (uint256) {
        uint256 totalSupply = longSupply + shortSupply;
        return a + (b * totalSupply) / 1e18;
    }

    function getMarketInfo()
        external
        view
        returns (
            string memory,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            bool,
            bool
        )
    {
        return (
            tweetId,
            theta,
            alpha,
            settlementTime,
            longSupply,
            shortSupply,
            settled,
            longWon
        );
    }

    function withdrawProtocolFees() external {
        require(msg.sender == factory, "Only factory can withdraw");
        require(protocolFees > 0, "No fees to withdraw");

        uint256 amount = protocolFees;
        protocolFees = 0;
        payable(factory).transfer(amount);
    }

    function getLongTokenBalance(address user) external view returns (uint256) {
        return longToken.balanceOf(user);
    }

    /// @notice Return the SHORT‐token balance of any user
    function getShortTokenBalance(
        address user
    ) external view returns (uint256) {
        return shortToken.balanceOf(user);
    }
}
