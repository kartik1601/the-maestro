import { createApp } from './app.js';
import { env, ephemeralSecretNames } from './config/env.js';
import { connectDatabase, disconnectDatabase, isEphemeralDatabase } from './db/connect.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './seed/seed.js';
import { provisionAdmin } from './services/auth-service.js';
import { Admin } from './models/admin.js';

const { mode } = await connectDatabase();

if (env.seedOnBoot) {
  await seedDatabase({ quiet: true });
}

// Unlike seeding, this runs against every database: it only derives fields from
// content that is already there, so it cannot overwrite anything the author wrote.
await runMigrations();

// Development can provision an admin on first boot, but only from credentials the
// operator supplied — there are no built-in fallbacks. Production always uses
// scripts/create-admin.js.
const { username, password, authKey } = env.bootstrapAdmin;
const canBootstrap = Boolean(username && password && authKey);

let bootstrapped = false;
let needsAdmin = false;

if (!env.isProduction && !(await Admin.exists({ singleton: 'admin' }))) {
  if (canBootstrap) {
    await provisionAdmin(env.bootstrapAdmin);
    bootstrapped = true;
  } else {
    needsAdmin = true;
  }
}

const app = createApp();
const server = app.listen(env.port, () => {
  banner({ mode, bootstrapped, needsAdmin });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n[server] ${signal} received — shutting down.`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  });
}

function banner({ mode, bootstrapped, needsAdmin }) {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  the-maestro · API');
  console.log(line);
  console.log(`  listening   http://localhost:${env.port}`);
  console.log(`  client      ${env.clientOrigin}`);
  console.log(`  database    ${mode === 'in-memory' ? 'in-process MongoDB (ephemeral)' : 'MongoDB Atlas'}`);
  console.log(`  admin login /api/${env.adminPortalPath}/auth/login`);

  if (bootstrapped) {
    console.log(line);
    console.log('  Admin provisioned from your environment:');
    console.log(`    username  ${env.bootstrapAdmin.username}`);
    console.log(`    password  ${env.bootstrapAdmin.password}`);
    console.log(`    auth key  ${env.bootstrapAdmin.authKey}`);
  }

  if (needsAdmin) {
    console.log(line);
    console.log('  No admin exists yet, and no credentials were supplied.');
    console.log('  Create one with:   npm run admin:create');
    console.log('  Or set ADMIN_USERNAME, ADMIN_PASSWORD and ADMIN_AUTH_KEY in server/.env');
  }

  if (isEphemeralDatabase()) {
    console.log(line);
    console.log('  ⚠ No MONGODB_URI set — data is discarded when this process stops.');
    console.log('    Add your Atlas connection string to server/.env to persist.');
  }

  const generated = ephemeralSecretNames();
  if (generated.length > 0) {
    console.log(`  ⚠ Generated ephemeral secrets: ${generated.join(', ')} — sessions end on restart.`);
  }

  console.log(`${line}\n`);
}
