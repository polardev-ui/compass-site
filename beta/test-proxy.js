#!/usr/bin/env node

const http = require('http');

const API_BASE = 'http://localhost:3000/api';

async function request(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${endpoint}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🔍 Scramjet Proxy API Test Suite\n');

  try {
    console.log('1️⃣  Checking Scramjet Status...');
    const status = await request('GET', '/scramjet/status');
    console.log(`   ✓ Status: ${JSON.stringify(status.data)}\n`);

    console.log('2️⃣  Testing Scramjet Functionality...');
    const test = await request('GET', '/scramjet/test');
    console.log(`   ✓ Test: ${JSON.stringify(test.data)}\n`);

    console.log('3️⃣  Verifying User...');
    const verify = await request('GET', '/verify-user');
    if (verify.status === 200) {
      console.log(`   ✓ User Verified: ${JSON.stringify(verify.data)}\n`);
    } else {
      console.log(`   ✗ User Verification Failed: ${JSON.stringify(verify.data)}\n`);
    }

    console.log('4️⃣  Testing Proxy with example.com...');
    const proxy = await request('POST', '/proxy', {
      url: 'https://example.com'
    });
    if (proxy.status === 200) {
      const contentLength = proxy.data.content?.length || 0;
      console.log(`   ✓ Proxy Success`);
      console.log(`   - Type: ${proxy.data.type}`);
      console.log(`   - Content Length: ${contentLength} bytes\n`);
    } else {
      console.log(`   ✗ Proxy Failed: ${JSON.stringify(proxy.data)}\n`);
    }

    console.log('5️⃣  Testing Blocked Domain (facebook.com)...');
    const blocked = await request('POST', '/proxy', {
      url: 'https://facebook.com'
    });
    if (blocked.status === 403) {
      console.log(`   ✓ Domain Correctly Blocked: ${JSON.stringify(blocked.data)}\n`);
    } else {
      console.log(`   ✗ Blocking Failed: ${JSON.stringify(blocked.data)}\n`);
    }

    console.log('6️⃣  Testing Invalid URL...');
    const invalid = await request('POST', '/proxy', {
      url: 'not-a-real-url'
    });
    if (invalid.status === 400) {
      console.log(`   ✓ Invalid URL Rejected: ${JSON.stringify(invalid.data)}\n`);
    } else {
      console.log(`   ✗ Invalid URL Not Caught: ${JSON.stringify(invalid.data)}\n`);
    }

    console.log('✅ All tests completed!\n');

  } catch (error) {
    console.error('❌ Test Error:', error.message);
    console.log('\n⚠️  Make sure server.js is running on port 3000');
    console.log('   Run: node server.js');
  }
}

runTests();
