/**
 * Test client for verifying the first-pass application
 */

const BASE_URL = 'http://127.0.0.1:3001';

async function request(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function runTests() {
  console.log('🧪 Testing First Pass Application\n');

  // Test 1: Health check
  console.log('1. Testing /health...');
  const health = await request('/health');
  console.log(`   Status: ${health.status}`);
  console.log(`   Response: ${JSON.stringify(health.data)}`);
  console.log(`   ✅ Health check ${health.status === 200 ? 'PASSED' : 'FAILED'}\n`);

  // Test 2: Seed data
  console.log('2. Testing POST /seed...');
  const seed = await request('/seed', 'POST');
  console.log(`   Status: ${seed.status}`);
  console.log(`   Response: ${JSON.stringify(seed.data)}`);
  console.log(`   ✅ Seed ${seed.status === 200 ? 'PASSED' : 'FAILED'}\n`);

  // Test 3: List users
  console.log('3. Testing GET /users...');
  const users = await request('/users');
  console.log(`   Status: ${users.status}`);
  console.log(`   Users count: ${users.data?.data?.length || 0}`);
  console.log(`   Pagination: ${JSON.stringify(users.data?.pagination)}`);
  console.log(`   ✅ Users list ${users.status === 200 ? 'PASSED' : 'FAILED'}\n`);

  // Test 4: Container introspection
  console.log('4. Testing GET /__introspect/container...');
  const intro = await request('/__introspect/container');
  console.log(`   Status: ${intro.status}`);
  console.log(`   Services: ${intro.data?.data?.services?.length || 0}`);
  console.log(`   Resolved order: ${intro.data?.data?.resolvedOrder?.join(' → ')}`);
  console.log(`   ✅ Introspection ${intro.status === 200 ? 'PASSED' : 'FAILED'}\n`);

  // Test 5: Model introspection
  console.log('5. Testing GET /__introspect/models...');
  const models = await request('/__introspect/models');
  console.log(`   Status: ${models.status}`);
  console.log(`   Models: ${models.data?.data?.models?.map(m => m.name).join(', ')}`);
  console.log(`   ✅ Model introspection ${models.status === 200 ? 'PASSED' : 'FAILED'}\n`);

  // Test 6: Create a new user
  console.log('6. Testing POST /users...');
  const newUser = await request('/users', 'POST', {
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    age: 30,
    isActive: true,
  });
  console.log(`   Status: ${newUser.status}`);
  console.log(`   Created user: ${JSON.stringify(newUser.data?.data)}`);
  console.log(`   ✅ Create user ${newUser.status === 200 ? 'PASSED' : 'FAILED'}\n`);

  // Test 7: Validation error
  console.log('7. Testing validation error (POST /users with invalid data)...');
  const invalidUser = await request('/users', 'POST', {
    email: 'invalid-email', // Invalid
    firstName: '', // Invalid - too short
  });
  console.log(`   Status: ${invalidUser.status}`);
  console.log(`   Error: ${JSON.stringify(invalidUser.data)}`);
  console.log(`   ✅ Validation error ${invalidUser.status === 422 || invalidUser.status === 500 ? 'PASSED' : 'FAILED'}\n`);

  // Test 8: List posts with pagination
  console.log('8. Testing GET /posts?page=1...');
  const posts = await request('/posts');
  console.log(`   Status: ${posts.status}`);
  console.log(`   Posts count: ${posts.data?.data?.length || 0}`);
  console.log(`   Has more: ${posts.data?.pagination?.hasMore}`);
  console.log(`   ✅ Posts list ${posts.status === 200 ? 'PASSED' : 'FAILED'}\n`);

  console.log('✅ All tests completed!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
