pragma solidity ^0.8.19;

contract MockEngagementOracle {
    mapping(string => uint256) private engagementScores;
    mapping(string => bool) private scoreSet;
    
    event EngagementScoreSet(string indexed tweetId, uint256 score);
    
    function setEngagementScore(string calldata tweetId, uint256 score) external {
        engagementScores[tweetId] = score;
        scoreSet[tweetId] = true;
        emit EngagementScoreSet(tweetId, score);
    }
    
    function getEngagementScore(string calldata tweetId) external view returns (uint256) {
        require(scoreSet[tweetId], "Engagement score not set");
        return engagementScores[tweetId];
    }
    
    function requestEngagementScore(string calldata tweetId) external {
        // Mock implementation - in real oracle, this would trigger external API call
        emit EngagementScoreSet(tweetId, 0);
    }
    
    function hasScore(string calldata tweetId) external view returns (bool) {
        return scoreSet[tweetId];
    }
}
