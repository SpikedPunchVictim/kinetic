/**
 * Automated tests for Basic CRUD Example
 */

const BASE_URL = 'http://127.0.0.1:3000';

const results = {
  passed: 0,
  failed: 0,
  errors: [],
};

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

async function request(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

console.log('🧪 Running Basic CRUD Tests\n');

const tests = [
  // Health check
  async () => {
    await test('Health endpoint', async () => {
      const { status, data } = await request('/health');
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (data.status !== 'healthy') throw new Error('Expected healthy status');
    });
  },

  // Container introspection
  async () => {
    await test('Container introspection', async () => {
      const { status, data } = await request('/introspect');
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.data?.services) throw new Error('Expected services in response');
    });
  },

  // User CRUD
  async () => {
    let userId;

    await test('Create user', async () => {
      const { status, data } = await request('/users', 'POST', {
        email: 'test@example.com',
        name: 'Test User',
        age: 25,
      });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.data?.id) throw new Error('Expected user with id');
      userId = data.data.id;
    });

    await test('Get user by ID', async () => {
      const { status, data } = await request(`/users/${userId}`);
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (data.data?.email !== 'test@example.com') throw new Error('Expected correct email');
    });

    await test('Update user', async () => {
      const { status, data } = await request(`/users/${userId}`, 'PUT', {
        email: 'updated@example.com',
        name: 'Updated Name',
      });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (data.data?.name !== 'Updated Name') throw new Error('Expected updated name');
    });

    await test('List users', async () => {
      const { status, data } = await request('/users');
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!Array.isArray(data.data)) throw new Error('Expected array of users');
    });

    await test('Delete user', async () => {
      const { status } = await request(`/users/${userId}`, 'DELETE');
      if (status !== 204) throw new Error(`Expected 204, got ${status}`);
    });

    await test('User not found after delete', async () => {
      const { status } = await request(`/users/${userId}`);
      if (status !== 500) throw new Error(`Expected 500 (error), got ${status}`);
    });
  },

  // Post CRUD
  async () => {
    let postId;

    await test('Create post', async () => {
      const { status, data } = await request('/posts', 'POST', {
        title: 'Test Post',
        content: 'This is a test post',
        authorId: 'some-author-id',
      });
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.data?.id) throw new Error('Expected post with id');
      postId = data.data.id;
    });

    await test('Get post by ID', async () => {
      const { status, data } = await request(`/posts/${postId}`);
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (data.data?.title !== 'Test Post') throw new Error('Expected correct title');
    });

    await test('Publish post', async () => {
      const { status, data } = await request(`/posts/${postId}/publish`, 'PATCH');
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (!data.data?.published) throw new Error('Expected post to be published');
    });
  },

  // Validation
  async () => {
    await test('Validation error for invalid email', async () => {
      const { status, data } = await request('/users', 'POST', {
        email: 'invalid-email',
        name: 'Test',
      });
      if (status !== 500) throw new Error(`Expected 500 (error), got ${status}`);
      if (!data?.message?.includes('validation')) throw new Error('Expected validation error');
    });
  },

  // Pagination
  async () => {
    await test('Pagination on users list', async () => {
      const { status, data } = await request('/users?limit=5');
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      if (data.pagination?.hasMore === undefined) throw new Error('Expected pagination info');
    });
  },
];

for (const testFn of tests) {
  await testFn();
}

console.log('\n' + '='.repeat(50));
console.log(`Results: ${results.passed} passed, ${results.failed} failed`);

if (results.errors.length > 0) {
  console.log('\nErrors:');
  results.errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
}

process.exit(results.failed > 0 ? 1 : 0);
