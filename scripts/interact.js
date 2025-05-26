const { ethers } = require("hardhat");

async function main() {
  console.log("🧪 Interactive Testing Script\n");

  // Load deployed addresses
  const fs = require('fs');
  let addresses;
  try {
    addresses = JSON.parse(fs.readFileSync('deployed-addresses.json', 'utf8'));
  } catch (error) {
    console.log("❌ Please run deployment script first!");
    return;
  }

  const [owner, alice, bob] = await ethers.getSigners();

  
  // Connect to contracts
  const oracle = await ethers.getContractAt("MockEngagementOracle", addresses.oracle);
  const factory = await ethers.getContractAt("TweetPredictionFactory", addresses.factory);
  const market = await ethers.getContractAt("TweetPredictionMarket", addresses.testMarket);

  const marketFactory = await market.factory();
  console.log(marketFactory)
  console.log("📊 Market Info:");
  const marketInfo = await market.getMarketInfo();
  console.log(`Tweet ID: ${marketInfo[0]}`);
  console.log(`Theta: ${ethers.formatEther(marketInfo[1])}`);
  console.log(`Settlement Time: ${new Date(Number(marketInfo[3] * 1000n))}`);
  console.log(`Settled: ${marketInfo[6]}\n`);

  // Test buying tokens
  console.log("💰 Testing Token Purchases...");
  
  const longTokens = ethers.parseEther("100");
  const shortTokens = ethers.parseEther("200");
  
  const longCost = await market.calculateMintCost(0, longTokens);
  console.log(`Long cost for 100 tokens: ${ethers.formatEther(longCost)} ETH`);
  
  await market.connect(alice).buy(true, longTokens, { value: longCost });
  console.log("✅ Alice bought long tokens");
  
  const shortCost = await market.calculateMintCost(longTokens, shortTokens);
  console.log(`Short cost for 200 tokens: ${ethers.formatEther(shortCost)} ETH`);
  
  await market.connect(bob).buy(false, shortTokens, { value: shortCost });
  console.log("✅ Bob bought short tokens");

  // Check current state
  console.log("\n📈 Current Market State:");
  console.log(`Long Supply: ${ethers.formatEther(await market.longSupply())}`);
  console.log(`Short Supply: ${ethers.formatEther(await market.shortSupply())}`);
  console.log(`Long Reserve: ${ethers.formatEther(await market.longReserve())} ETH`);
  console.log(`Short Reserve: ${ethers.formatEther(await market.shortReserve())} ETH`);
  console.log(`Protocol Fees: ${ethers.formatEther(await market.protocolFees())} ETH`);

  // Fast forward time
  console.log("\n⏰ Fast forwarding time to settlement...");
  await ethers.provider.send("evm_increaseTime", [3700]);
  await ethers.provider.send("evm_mine");

  // Set engagement score (long wins)
  const engagementScore = ethers.parseEther("900"); // Above threshold
  await oracle.setEngagementScore(addresses.tweetId, engagementScore);
  console.log(`📡 Set engagement score: ${ethers.formatEther(engagementScore)}`);

  // Settle market
  console.log("\n🏁 Settling market...");
  await market.settle();
  
  const finalInfo = await market.getMarketInfo();
  console.log(`Long Won: ${finalInfo[7]}`);
  console.log(`Final Engagement: ${ethers.formatEther(await market.finalEngagement())}`);

  // Check payouts
  console.log("\n💎 Checking Payouts:");
  const alicePayout = await market.calculatePayout(alice.address);
  const bobPayout = await market.calculatePayout(bob.address);
  
  console.log(`Alice (Long) Payout: ${ethers.formatEther(alicePayout)} ETH`);
  console.log(`Bob (Short) Payout: ${ethers.formatEther(bobPayout)} ETH`);

  // Claim rewards
  if (alicePayout > 0) {
    console.log("\n💰 Alice claiming rewards...");
    await market.connect(alice).claimRewards();
    console.log("✅ Alice claimed rewards");
  }

  if (bobPayout > 0) {
    console.log("\n💰 Bob claiming rewards...");
    await market.connect(bob).claimRewards();
    console.log("✅ Bob claimed rewards");
  }

  console.log("\n🎉 Testing completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
