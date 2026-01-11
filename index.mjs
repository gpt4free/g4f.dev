// Test case for Perplexity Worker using g4f.dev client
import Client from '@gpt4free/g4f.dev';

// Update this URL based on your deployment:
// - Local: http://localhost:8787
// - Deployed: https://perplexity.gpt4free.workers.dev
const WORKER_URL = process.env.WORKER_URL || "https://g4f.dev/api/azure";

// Create a client pointing to the Perplexity worker
const client = new Client({
  baseUrl: WORKER_URL
});

const testMessages = [
  { role: "user", content: "What is 2 + 2?" }
];

// Test models endpoint
async function testModels() {
  console.log("=== Testing Models Endpoint ===\n");
  
  try {
    const models = await client.models.list();
    console.log("Models:", JSON.stringify(models, null, 2));
    return true;
  } catch (error) {
    console.error("Models test failed:", error.message);
    return false;
  }
}

// Test non-streaming response
async function testNonStreaming() {
  console.log("\n=== Testing Non-Streaming ===\n");
  
  try {
    const response = await client.chat.completions.create({
      model: "model-router3",
      messages: testMessages,
      stream: false
    });

    console.log("Response:", JSON.stringify(response, null, 2));
    console.log("\nContent:", response.choices?.[0]?.message?.content);
    console.log("Usage:", response.usage);
    return true;
  } catch (error) {
    console.error("Non-streaming test failed:", error.message);
    return false;
  }
}

// Test streaming response
async function testStreaming() {
  console.log("\n=== Testing Streaming ===\n");
  
  try {
    const stream = await client.chat.completions.create({
      model: "model-router3",
      messages: testMessages,
      stream: true
    });

    let fullContent = "";
    
    for await (const chunk of stream) {
      if (chunk.choices?.[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content;
        process.stdout.write(content);
        fullContent += content;
      }
      if (chunk.usage) {
        console.log("\n\nUsage:", chunk.usage);
      }
    }

    console.log("\n\nFull content:", fullContent);
    return true;
  } catch (error) {
    console.error("Streaming test failed:", error);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log("Perplexity Worker Test Suite (using g4f.dev client)\n");
  console.log("----------------------------\n");

  const results = {
    models: await testModels(),
    nonStreaming: await testNonStreaming(),
    streaming: await testStreaming()
  };

  console.log("\n----------------------------");
  console.log("Test Results:");
  console.log("  Models:", results.models ? "✓ PASS" : "✗ FAIL");
  console.log("  Non-Streaming:", results.nonStreaming ? "✓ PASS" : "✗ FAIL");
  console.log("  Streaming:", results.streaming ? "✓ PASS" : "✗ FAIL");
}

runTests().catch(console.error);