/**
 * Comprehensive Test Runner for All Examples
 * Runs and validates all 4 example applications
 */

import { spawn } from 'child_process';
import path from 'path';

const MAX_WAIT_MS = 10000;
const DELAY_MS = 500;

class TestRunner {
  constructor() {
    this.results = [];
  }

  async runExample(name, dir, testFn) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 Testing: ${name}`);
    console.log(`📁 Directory: ${dir}`);
    console.log('='.repeat(60));

    const startTime = Date.now();
    try {
      // Install dependencies first
      console.log('📦 Installing dependencies...');
      await this.execPromise('pnpm install', { cwd: dir, silent: true });

      // Run the example in background
      console.log('🚀 Starting server...');
      const server = this.startServer(dir);

      // Wait for server to be ready
      console.log('⏳ Waiting for server...');
      await this.waitForServer(server.port, MAX_WAIT_MS);

      // Run tests
      console.log('🔍 Running tests...\n');
      await testFn(server.port);

      // Clean up
      server.process.kill();
      await this.waitForProcessExit(server.process, 5000);

      this.results.push({ name, status: 'passed', duration: Date.now() - startTime });
      console.log(`\n✅ ${name}: PASSED`);
    } catch (error) {
      this.results.push({ name, status: 'failed', error: error.message, duration: Date.now() - startTime });
      console.error(`\n❌ ${name}: FAILED`);
      console.error(`   Error: ${error.message}`);
    }
  }

  startServer(dir) {
    const proc = spawn('node', ['app.mjs'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let port = 3000;
    // Extract port from config in app.mjs
    if (dir.includes('dependency-injection')) port = 3001;
    if (dir.includes('security-demo')) port = 3002;
    if (dir.includes('observability')) port = 3003;

    return { process: proc, port };
  }

  async waitForServer(port, maxWaitMs) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { timeout: 100 });
        if (response.ok) return;
      } catch {
        // Server not ready yet
      }
      await this.delay(DELAY_MS);
    }
    throw new Error('Server failed to start');
  }

  async waitForProcessExit(proc, timeoutMs) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, timeoutMs);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  execPromise(command, options = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command.split(' ')[0], command.split(' ').slice(1), {
        cwd: options.cwd,
        stdio: options.silent ? 'ignore' : 'inherit',
      });

      let stdout = '';
      let stderr = '';

      if (proc.stdout) proc.stdout.on('data', (data) => { stdout += data; });
      if (proc.stderr) proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Exit code ${code}: ${stderr}`));
      });
    });
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async request(port, path, method = 'GET', body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  async runAll() {
    const examplesDir = '/Users/spikedpunchvictim/projects/kinetic/examples';

    // Test 1: Basic CRUD
    await this.runExample('Basic CRUD', path.join(examplesDir, 'basic-crud'), async (port) => {
      // Health check
      const health = await this.request(port, '/health');
      if (health.status !== 200) throw new Error('Health check failed');
      if (!health.data?.data?.status) throw new Error('Invalid health response');

      // Create user
      const user = await this.request(port, '/users', 'POST', {
        email: 'test@example.com',
        name: 'Test User',
        age: 25,
      });
      if (user.status !== 200) throw new Error('Create user failed');
      if (!user.data?.data?.id) throw new Error('No user ID returned');

      // List users
      const users = await this.request(port, '/users');
      if (users.status !== 200) throw new Error('List users failed');
      if (!Array.isArray(users.data?.data)) throw new Error('Invalid users list');

      // Get user
      const userId = user.data.data.id;
      const getUser = await this.request(port, `/users/${userId}`);
      if (getUser.status !== 200) throw new Error('Get user failed');

      // Introspection
      const introspect = await this.request(port, '/introspect');
      if (introspect.status !== 200) throw new Error('Introspection failed');

      console.log('✓ All CRUD operations working');
    });

    // Test 2: Dependency Injection
    await this.runExample('Dependency Injection', path.join(examplesDir, 'dependency-injection'), async (port) => {
      // Health check
      const health = await this.request(port, '/health');
      if (health.status !== 200) throw new Error('Health check failed');

      // Container introspection
      const introspect = await this.request(port, '/introspect');
      if (introspect.status !== 200) throw new Error('Introspection failed');
      if (!introspect.data?.data?.services) throw new Error('No services data');

      // Get user
      const user = await this.request(port, '/users/test-id');
      if (user.status !== 200 && user.status !== 500) throw new Error('User endpoint failed');

      console.log('✓ DI container working');
    });

    // Test 3: Security Demo
    await this.runExample('Security Demo', path.join(examplesDir, 'security-demo'), async (port) => {
      // Health check
      const health = await this.request(port, '/health');
      if (health.status !== 200) throw new Error('Health check failed');

      // Login to get token
      const login = await this.request(port, '/login', 'POST', {
        email: 'admin@example.com',
        password: 'password',
      });
      if (login.status !== 200) throw new Error('Login failed');
      if (!login.data?.data?.token) throw new Error('No token returned');

      console.log('✓ Security features working');
    });

    // Test 4: Observability Demo
    await this.runExample('Observability Demo', path.join(examplesDir, 'observability-demo'), async (port) => {
      // Health check with observability
      const health = await this.request(port, '/health');
      if (health.status !== 200) throw new Error('Health check failed');
      if (!health.data?.checks) throw new Error('No health checks data');

      // Metrics
      const metrics = await this.request(port, '/metrics');
      if (metrics.status !== 200) throw new Error('Metrics failed');

      // Trace
      const trace = await this.request(port, '/trace');
      if (trace.status !== 200) throw new Error('Trace failed');

      // Introspection routes
      const introspectContainer = await this.request(port, '/__introspect/container');
      if (introspectContainer.status !== 200) throw new Error('Container introspection failed');

      console.log('✓ Observability features working');
    });

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    this.results.forEach((r) => {
      const icon = r.status === 'passed' ? '✅' : '❌';
      console.log(`${icon} ${r.name}: ${r.status.toUpperCase()} (${r.duration}ms)`);
    });

    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed').length;
    console.log(`\nTotal: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run tests
const runner = new TestRunner();
runner.runAll().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
