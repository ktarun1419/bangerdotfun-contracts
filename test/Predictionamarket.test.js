const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Tweet Prediction Market", function() {
  let factory, oracle, market;
  let owner, alice, bob, charlie;
  let tweetId = "tweet_123";
  let theta = ethers.parseEther("1000"); // 1000 engagement
  let alpha = ethers.parseEther("0.8"); // 80%
  
  beforeEach(async function() {
    [owner, alice, bob, charlie] = await ethers.getSigners();
    
    // Deploy Oracle
    const MockOracle = await ethers.getContractFactory("MockEngagementOracle");
    oracle = await MockOracle.deploy();
    
    // Deploy Factory
    const Factory = await ethers.getContractFactory("TweetPredictionFactory");
    factory = await Factory.deploy(await oracle.getAddress());
    
    // Create Market
    const duration = 3600; // 1 hour
    await factory.createMarket(tweetId, theta, duration);
    const marketAddress = await factory.getMarket(tweetId);
    
    // Get market contract
    const Market = await ethers.getContractFactory("TweetPredictionMarket");
    market = Market.attach(marketAddress);
  });

  describe("Factory Tests", function() {
    it("Should deploy factory with correct oracle", async function() {
      expect(await factory.oracle()).to.equal(await oracle.getAddress());
    });

    it("Should create new market", async function() {
      const newTweetId = "new_tweet_456";
      await factory.createMarket(newTweetId, theta, 3600);
      
      const marketAddress = await factory.getMarket(newTweetId);
      expect(marketAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should prevent duplicate markets", async function() {
      await expect(
        factory.createMarket(tweetId, theta, 3600)
      ).to.be.revertedWith("Market already exists");
    });

    it("Should track all markets", async function() {
      const allMarkets = await factory.getAllMarkets();
      expect(allMarkets.length).to.be.greaterThan(0);
    });
  });

  describe("Market Trading Tests", function() {
    it("Should allow buying long tokens", async function() {
      const tokens = ethers.parseEther("100");
      const cost = await market.calculateMintCost(0, tokens);
      
      await expect(
        market.connect(alice).buy(true, tokens, { value: cost })
      ).to.emit(market, "TokensPurchased")
       .withArgs(alice.address, true, tokens, cost);
      
      const buyer = await market.buyers(alice.address);
      expect(buyer.longTokens).to.equal(tokens);
    });

    it("Should allow buying short tokens", async function() {
      const tokens = ethers.parseEther("50");
      const cost = await market.calculateMintCost(0, tokens);
      
      await market.connect(bob).buy(false, tokens, { value: cost });
      
      const buyer = await market.buyers(bob.address);
      expect(buyer.shortTokens).to.equal(tokens);
    });

    it("Should calculate bonding curve cost correctly", async function() {
      const tokens = ethers.parseEther("100");
      const totalSupply = 0;
      
      const cost = await market.calculateMintCost(totalSupply, tokens);
      
      // Verify cost > 0 and reasonable
      expect(cost).to.be.gt(0);
      expect(cost).to.be.lt(ethers.parseEther("1")); // Should be less than 1 ETH
    });

    it("Should increase cost with supply (bonding curve)", async function() {
      const tokens = ethers.parseEther("100");
      
      const cost1 = await market.calculateMintCost(0, tokens);
      const cost2 = await market.calculateMintCost(ethers.parseEther("1000"), tokens);
      
      expect(cost2).to.be.gt(cost1);
    });

    it("Should collect trading fees", async function() {
      const tokens = ethers.parseEther("100");
      const cost = await market.calculateMintCost(0, tokens);
      
      await market.connect(alice).buy(true, tokens, { value: cost });
      
      const protocolFees = await market.protocolFees();
      expect(protocolFees).to.be.gt(0);
    });

    it("Should refund excess payment", async function() {
      const tokens = ethers.parseEther("100");
      const cost = await market.calculateMintCost(0, tokens);
      const excess = ethers.parseEther("0.1");
      
      const balanceBefore = await alice.provider.getBalance(alice.address);
      
      const tx = await market.connect(alice).buy(true, tokens, { 
        value: cost + excess 
      });
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await alice.provider.getBalance(alice.address);
      
      // Should only deduct cost + gas, not excess
      expect(balanceBefore - balanceAfter).to.be.closeTo(cost + gasUsed, ethers.parseEther("0.001"));
    });

    it("Should prevent trading after settlement time", async function() {
      // Fast forward time past settlement
      await ethers.provider.send("evm_increaseTime", [3700]); // 1 hour + 100 seconds
      await ethers.provider.send("evm_mine");
      
      const tokens = ethers.parseEther("100");
      const cost = await market.calculateMintCost(0, tokens);
      
      await expect(
        market.connect(alice).buy(true, tokens, { value: cost })
      ).to.be.revertedWith("Trading period ended");
    });
  });

  describe("Market Settlement Tests", function() {
    beforeEach(async function() {
      // Setup some trades
      const longTokens = ethers.parseEther("100");
      const shortTokens = ethers.parseEther("200");
      
      const longCost = await market.calculateMintCost(0, longTokens);
      const shortCost = await market.calculateMintCost(longTokens, shortTokens);
      
      await market.connect(alice).buy(true, longTokens, { value: longCost });
      await market.connect(bob).buy(false, shortTokens, { value: shortCost });
    });

    it("Should prevent settlement before time", async function() {
      await expect(market.settle()).to.be.revertedWith("Settlement time not reached");
    });

    it("Should settle market when long wins", async function() {
      // Set engagement score above threshold (alpha * theta = 0.8 * 1000 = 800)
      await oracle.setEngagementScore(tweetId, ethers.parseEther("900"));
      
      // Fast forward past settlement time
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await expect(market.settle())
        .to.emit(market, "MarketSettled")
        .withArgs(ethers.parseEther("900"), true);
      
      expect(await market.longWon()).to.be.true;
      expect(await market.settled()).to.be.true;
    });

    it("Should settle market when short wins", async function() {
      // Set engagement score below threshold
      await oracle.setEngagementScore(tweetId, ethers.parseEther("500"));
      
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await market.settle();
      
      expect(await market.longWon()).to.be.false;
    });

    it("Should redistribute reserves correctly when long wins", async function() {
      await oracle.setEngagementScore(tweetId, ethers.parseEther("900"));
      
      const shortReserveBefore = await market.shortReserve();
      
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await market.settle();
      
      // Short reserve should be mostly transferred to long (minus rake)
      expect(await market.shortReserve()).to.equal(0);
      expect(await market.longReserve()).to.be.gt(0);
    });

    it("Should apply settlement rake", async function() {
      await oracle.setEngagementScore(tweetId, ethers.parseEther("900"));
      
      const protocolFeesBefore = await market.protocolFees();
      
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await market.settle();
      
      const protocolFeesAfter = await market.protocolFees();
      expect(protocolFeesAfter).to.be.gt(protocolFeesBefore);
    });

    it("Should prevent double settlement", async function() {
      await oracle.setEngagementScore(tweetId, ethers.parseEther("900"));
      
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await market.settle();
      
      await expect(market.settle()).to.be.revertedWith("Already settled");
    });
  });

  describe("Reward Claims Tests", function() {
    beforeEach(async function() {
      // Setup trades and settle market
      const longTokens = ethers.parseEther("100");
      const shortTokens = ethers.parseEther("200");
      
      const longCost = await market.calculateMintCost(0, longTokens);
      const shortCost = await market.calculateMintCost(longTokens, shortTokens);
      
      await market.connect(alice).buy(true, longTokens, { value: longCost });
      await market.connect(bob).buy(false, shortTokens, { value: shortCost });
      
      // Set engagement and settle (long wins)
      await oracle.setEngagementScore(tweetId, ethers.parseEther("900"));
      
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await market.settle();
    });

    it("Should calculate correct payout for winner", async function() {
      const payout = await market.calculatePayout(alice.address);
      expect(payout).to.be.gt(0);
    });

    it("Should return zero payout for loser", async function() {
      const payout = await market.calculatePayout(bob.address);
      expect(payout).to.equal(0);
    });

    it("Should allow winner to claim rewards", async function() {
      const balanceBefore = await alice.provider.getBalance(alice.address);
      
      await expect(market.connect(alice).claimRewards())
        .to.emit(market, "RewardsClaimed");
      
      const balanceAfter = await alice.provider.getBalance(alice.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should prevent double claiming", async function() {
      await market.connect(alice).claimRewards();
      
      await expect(market.connect(alice).claimRewards())
        .to.be.revertedWith("Already claimed");
    });

    it("Should prevent claiming before settlement", async function() {
      // Create new market without settlement
      await factory.createMarket("new_tweet", theta, 3600);
      const newMarketAddr = await factory.getMarket("new_tweet");
      const newMarket = await ethers.getContractAt("TweetPredictionMarket", newMarketAddr);
      
      await expect(newMarket.connect(alice).claimRewards())
        .to.be.revertedWith("Market not settled");
    });
  });

  describe("Oracle Integration Tests", function() {
    it("Should set engagement scores", async function() {
      await oracle.setEngagementScore("test", ethers.parseEther("500"));
      
      const score = await oracle.getEngagementScore("test");
      expect(score).to.equal(ethers.parseEther("500"));
    });

    it("Should revert on missing engagement score", async function() {
      await expect(
        oracle.getEngagementScore("nonexistent")
      ).to.be.revertedWith("Engagement score not set");
    });

    it("Should check if score exists", async function() {
      expect(await oracle.hasScore("test")).to.be.false;
      
      await oracle.setEngagementScore("test", ethers.parseEther("100"));
      
      expect(await oracle.hasScore("test")).to.be.true;
    });
  });

  describe("Edge Cases & Security Tests", function() {
    it("Should handle zero token purchases correctly", async function() {
      await expect(
        market.connect(alice).buy(true, 0, { value: 0 })
      ).to.be.revertedWith("Tokens must be positive");
    });

    it("Should handle insufficient payment", async function() {
      const tokens = ethers.parseEther("100");
      const cost = await market.calculateMintCost(0, tokens);
      
      await expect(
        market.connect(alice).buy(true, tokens, { value: cost / 2n })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should prevent settlement with missing oracle data", async function() {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await expect(market.settle())
        .to.be.revertedWith("Engagement score not set");
    });

    it("Should handle market with no participants", async function() {
      // Create empty market and settle
      await factory.createMarket("empty_tweet", theta, 1);
      const emptyMarketAddr = await factory.getMarket("empty_tweet");
      const emptyMarket = await ethers.getContractAt("TweetPredictionMarket", emptyMarketAddr);
      
      await oracle.setEngagementScore("empty_tweet", ethers.parseEther("900"));
      
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");
      
      // Should settle without reverting
      await emptyMarket.settle();
    });

    it("Should handle very large token purchases", async function() {
      const largeTokens = ethers.parseEther("10000");
      const cost = await market.calculateMintCost(0, largeTokens);
      
      // Should not revert, just be expensive
      await market.connect(alice).buy(true, largeTokens, { value: cost });
      
      const buyer = await market.buyers(alice.address);
      expect(buyer.longTokens).to.equal(largeTokens);
    });
  });

  describe("Gas Optimization Tests", function() {
    it("Should track gas usage for buy operations", async function() {
      const tokens = ethers.parseEther("100");
      const cost = await market.calculateMintCost(0, tokens);
      
      const tx = await market.connect(alice).buy(true, tokens, { value: cost });
      const receipt = await tx.wait();
      
      console.log(`Gas used for buy: ${receipt.gasUsed}`);
      expect(receipt.gasUsed).to.be.lt(500000); // Should be reasonable
    });

    it("Should track gas usage for settlement", async function() {
      // Setup some trades first
      const tokens = ethers.parseEther("100");
      const cost = await market.calculateMintCost(0, tokens);
      await market.connect(alice).buy(true, tokens, { value: cost });
      
      await oracle.setEngagementScore(tweetId, ethers.parseEther("900"));
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      const tx = await market.settle();
      const receipt = await tx.wait();
      
      console.log(`Gas used for settle: ${receipt.gasUsed}`);
      expect(receipt.gasUsed).to.be.lt(300000);
    });
  });
});