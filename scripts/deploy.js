const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying Tweet Prediction Market contracts...\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

  // Deploy Mock Oracle
  console.log("📡 Deploying MockEngagementOracle...");
  const MockOracle = await ethers.getContractFactory("MockEngagementOracle");
  const oracle = await MockOracle.deploy();
  await oracle.waitForDeployment();
  console.log("✅ MockEngagementOracle deployed to:", await oracle.getAddress());

  // Deploy Factory
  console.log("\n🏭 Deploying TweetPredictionFactory...");
  const Factory = await ethers.getContractFactory("TweetPredictionFactory");
  const factory = await Factory.deploy(await oracle.getAddress());
  await factory.waitForDeployment();
  console.log("✅ TweetPredictionFactory deployed to:", await factory.getAddress());

  // Create a test market
  console.log("\n📊 Creating test market...");
  const tweetId = "test_tweet_123";
  const theta = ethers.parseEther("1000"); // 1000 engagement score
  const duration = 3600; // 1 hour
  
  const tx = await factory.createMarket(tweetId, theta, duration);
  const receipt = await tx.wait();
  
  const marketCreatedEvent = receipt.logs.find(log => {
    try {
      return factory.interface.parseLog(log).name === 'MarketCreated';
    } catch {
      return false;
    }
  });
  
  const marketAddress = factory.interface.parseLog(marketCreatedEvent).args.market;
  console.log("✅ Test market created at:", marketAddress);

  console.log("\n🎉 Deployment completed!");
  console.log("==========================================");
  console.log("Oracle Address:  ", await oracle.getAddress());
  console.log("Factory Address: ", await factory.getAddress());
  console.log("Test Market:     ", marketAddress);
  console.log("Tweet ID:        ", tweetId);
  console.log("==========================================");

  // Save addresses to file
  const fs = require('fs');
  const addresses = {
    oracle: await oracle.getAddress(),
    factory: await factory.getAddress(),
    testMarket: marketAddress,
    tweetId: tweetId,
    network: (await ethers.provider.getNetwork()).name
  };
  
  fs.writeFileSync('deployed-addresses.json', JSON.stringify(addresses, null, 2));
  console.log("\n📝 Addresses saved to deployed-addresses.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });