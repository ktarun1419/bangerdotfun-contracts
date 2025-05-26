const { ethers } = require("hardhat");

async function stressTest() {
  console.log("🔥 Starting Enhanced Stress Test...\n");

  // Get signers (simulate multiple users)
  const accounts = await ethers.getSigners();
  const users = accounts.slice(1, 21); // Use 20 accounts
  
  // Deploy contracts
  const MockOracle = await ethers.getContractFactory("MockEngagementOracle");
  const oracle = await MockOracle.deploy();
  
  const Factory = await ethers.getContractFactory("TweetPredictionFactory");
  const factory = await Factory.deploy(await oracle.getAddress());
  
  // Create multiple markets with tracking
  const marketCount = 5;
  const markets = [];
  const marketAnalytics = [];
  
  console.log(`📊 Creating ${marketCount} markets...`);
  for (let i = 0; i < marketCount; i++) {
    const tweetId = `stress_test_tweet_${i}`;
    const theta = ethers.parseEther((1000 + i * 100).toString());
    
    await factory.createMarket(tweetId, theta, 3600);
    const marketAddr = await factory.getMarket(tweetId);
    
    const market = await ethers.getContractAt("TweetPredictionMarket", marketAddr);
    markets.push({ market, tweetId, theta });
    
    // Initialize analytics tracking for each market
    marketAnalytics.push({
      marketId: i,
      tweetId,
      theta: ethers.formatEther(theta),
      longTrades: 0,
      shortTrades: 0,
      longVolume: 0n,
      shortVolume: 0n,
      totalSpent: 0n,
      trades: [], // Track individual trades for ROI calculation
      outcome: null,
      engagementScore: null
    });
  }
  console.log("✅ Markets created\n");

  // Simulate heavy trading with detailed tracking
  console.log("💰 Simulating heavy trading...");
  const totalTrades = 1000;
  let completedTrades = 0;
  
  const startTime = Date.now();
  
  for (let i = 0; i < totalTrades; i++) {
    const user = users[i % users.length];
    const userAddress = user.address;
    const marketIndex = i % markets.length;
    const { market } = markets[marketIndex];
    
    const isLong = Math.random() > 0.5;
    const tokens = ethers.parseEther((Math.random() * 50 + 10).toString()); // Reduced max for better distribution
    
    try {
      const currentSupply = await market.longSupply() + await market.shortSupply();
      const cost = await market.calculateMintCost(currentSupply, tokens);
      
      await market.connect(user).buy(isLong, tokens, { value: cost });
      
      // Track the trade
      const analytics = marketAnalytics[marketIndex];
      if (isLong) {
        analytics.longTrades++;
        analytics.longVolume += tokens;
      } else {
        analytics.shortTrades++;
        analytics.shortVolume += tokens;
      }
      analytics.totalSpent += cost;
      
      // Store trade details for ROI calculation
      analytics.trades.push({
        user: userAddress,
        isLong,
        tokens,
        cost,
        tradeId: completedTrades
      });
      
      completedTrades++;
      
      if (completedTrades % 20 === 0) {
        console.log(`✅ Completed ${completedTrades}/${totalTrades} trades`);
      }
    } catch (error) {
      console.log(`❌ Trade ${i} failed:`, error.message.substring(0, 50));
    }
  }
  
  const tradingTime = Date.now() - startTime;
  console.log(`\n📊 Trading Results:`);
  console.log(`Total Trades: ${completedTrades}/${totalTrades}`);
  console.log(`Success Rate: ${(completedTrades/totalTrades*100).toFixed(2)}%`);
  console.log(`Time Taken: ${tradingTime}ms`);
  console.log(`Avg Time per Trade: ${(tradingTime/completedTrades).toFixed(2)}ms\n`);

  // Display market statistics before settlement
  console.log("📈 PRE-SETTLEMENT MARKET STATISTICS:");
  console.log("=" .repeat(60));
  
  for (let i = 0; i < marketAnalytics.length; i++) {
    const analytics = marketAnalytics[i];
    const { market } = markets[i];
    
    const longSupply = await market.longSupply();
    const shortSupply = await market.shortSupply();
    const totalSupply = longSupply + shortSupply;
    
    console.log(`\n🏪 Market ${i} (${analytics.tweetId}):`);
    console.log(`   Theta: ${analytics.theta} ETH`);
    console.log(`   Long Trades: ${analytics.longTrades} | Short Trades: ${analytics.shortTrades}`);
    console.log(`   Long Volume: ${ethers.formatEther(analytics.longVolume)} tokens`);
    console.log(`   Short Volume: ${ethers.formatEther(analytics.shortVolume)} tokens`);
    console.log(`   Long Supply: ${ethers.formatEther(longSupply)} | Short Supply: ${ethers.formatEther(shortSupply)}`);
    console.log(`   Total Spent: ${ethers.formatEther(analytics.totalSpent)} ETH`);
    console.log(`   Long/Short Ratio: ${totalSupply > 0 ? (Number(longSupply) / Number(shortSupply)).toFixed(2) : 'N/A'}`);
  }

  // Settle all markets
  console.log("\n🏁 Settling all markets...");
  await ethers.provider.send("evm_increaseTime", [3700]);
  await ethers.provider.send("evm_mine");
  
  for (let i = 0; i < markets.length; i++) {
    const { market, tweetId, theta } = markets[i];
    const engagementScore = ethers.parseEther((Math.random() * 2000).toString());
    
    await oracle.setEngagementScore(tweetId, engagementScore);
    await market.settle();
    
    // Determine outcome
    const outcome = engagementScore >= theta;
    marketAnalytics[i].outcome = outcome;
    marketAnalytics[i].engagementScore = ethers.formatEther(engagementScore);
    
    console.log(`✅ Market ${i} settled - Engagement: ${ethers.formatEther(engagementScore)} | Outcome: ${outcome ? 'LONG WINS' : 'SHORT WINS'}`);
  }

  // Calculate ROI for winners
  console.log("\n💰 WINNER ROI ANALYSIS:");
  console.log("=" .repeat(60));
  
  let totalWinners = 0;
  let totalWinnerProfit = 0n;
  let totalWinnerInvestment = 0n;
  
  for (let i = 0; i < markets.length; i++) {
    const analytics = marketAnalytics[i];
    const { market } = markets[i];
    const outcome = analytics.outcome; // true = long wins, false = short wins
    
    console.log(`\n🏆 Market ${i} Winners (${outcome ? 'LONG' : 'SHORT'} side won):`);
    
    // Group trades by user and winning side
    const winnerTrades = new Map();
    
    for (const trade of analytics.trades) {
      if (trade.isLong === outcome) { // This trade was on the winning side
        if (!winnerTrades.has(trade.user)) {
          winnerTrades.set(trade.user, {
            totalTokens: 0n,
            totalCost: 0n,
            trades: 0
          });
        }
        const userStats = winnerTrades.get(trade.user);
        userStats.totalTokens += trade.tokens;
        userStats.totalCost += trade.cost;
        userStats.trades++;
      }
    }
    
    if (winnerTrades.size === 0) {
      console.log("   No winners in this market");
      continue;
    }
    
    let marketWinnerProfit = 0n;
    let marketWinnerInvestment = 0n;
    
    // Calculate payout for each winner
    for (const [userAddress, userStats] of winnerTrades) {
      try {
        // Get user's balance of winning tokens
        const userBalance = outcome ? 
          await market.getLongTokenBalance(userAddress) : 
          await market.getShortTokenBalance(userAddress);
        
        if (userBalance > 0) {
          const payout = await market.calculatePayout(userAddress);
          const profit = payout - userStats.totalCost;
          const roi = userStats.totalCost > 0 ? 
            (Number(profit) / Number(userStats.totalCost) * 100) : 0;
          
          console.log(`   ${userAddress.substring(0, 8)}... - ROI: ${roi.toFixed(2)}% | Profit: ${ethers.formatEther(profit)} ETH`);
          
          marketWinnerProfit += profit;
          marketWinnerInvestment += userStats.totalCost;
          totalWinners++;
        }
      } catch (error) {
        console.log(`   Error calculating ROI for ${userAddress.substring(0, 8)}...: ${error.message}`);
      }
    }
    
    const marketROI = marketWinnerInvestment > 0 ? 
      (Number(marketWinnerProfit) / Number(marketWinnerInvestment) * 100) : 0;
    
    console.log(`   Market ${i} Winners: ${winnerTrades.size} users`);
    console.log(`   Market ${i} Average ROI: ${marketROI.toFixed(2)}%`);
    console.log(`   Market ${i} Total Profit: ${ethers.formatEther(marketWinnerProfit)} ETH`);
    
    totalWinnerProfit += marketWinnerProfit;
    totalWinnerInvestment += marketWinnerInvestment;
  }

  // Calculate total protocol fees
  let totalProtocolFees = 0n;
  for (const { market } of markets) {
    const fees = await market.protocolFees();
    totalProtocolFees += fees;
  }
  
  // Final summary
  console.log("\n🎯 FINAL SUMMARY:");
  console.log("=" .repeat(60));
  console.log(`Total Markets: ${marketCount}`);
  console.log(`Total Trades: ${completedTrades}`);
  console.log(`Total Winners: ${totalWinners}`);
  
  const overallROI = totalWinnerInvestment > 0 ? 
    (Number(totalWinnerProfit) / Number(totalWinnerInvestment) * 100) : 0;
  
  console.log(`Overall Winner ROI: ${overallROI.toFixed(2)}%`);
  console.log(`Total Winner Profit: ${ethers.formatEther(totalWinnerProfit)} ETH`);
  console.log(`Total Protocol Fees: ${ethers.formatEther(totalProtocolFees)} ETH`);
  
  // Market distribution summary
  console.log("\n📊 MARKET DISTRIBUTION SUMMARY:");
  for (let i = 0; i < marketAnalytics.length; i++) {
    const analytics = marketAnalytics[i];
    const longPercentage = analytics.longTrades + analytics.shortTrades > 0 ? 
      (analytics.longTrades / (analytics.longTrades + analytics.shortTrades) * 100) : 0;
    
    console.log(`Market ${i}: ${analytics.longTrades}L/${analytics.shortTrades}S (${longPercentage.toFixed(1)}% long) - ${analytics.outcome ? 'LONG' : 'SHORT'} won`);
  }
  
  console.log("\n🎉 Enhanced stress test completed!\n");
}

stressTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });