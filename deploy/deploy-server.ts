const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function ensureFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`${filePath} is missing.`);
  }
}

function ensureDirectories(serverDir) {
  const directories = [
    serverDir,
    path.join(serverDir, 'certs'),
    path.join(serverDir, 'data', 'postgres'),
    path.join(serverDir, 'data', 'redis'),
    path.join(serverDir, 'logs', 'app'),
    path.join(serverDir, 'logs', 'nginx'),
  ];

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
  }
}

function writeComposeEnv(appDir, serverDir, imageRef) {
  const composeEnvPath = path.join(appDir, '.env.compose');
  writeFileSync(
    composeEnvPath,
    `LUCENT_IMAGE=${imageRef}\nLUCENT_SERVER_DIR=${serverDir}\n`,
    'utf8',
  );

  return composeEnvPath;
}

function compose(appDir, composeEnvPath, args) {
  const output = execFileSync(
    'docker',
    [
      'compose',
      '--project-name',
      'lucent',
      '--project-directory',
      appDir,
      '-f',
      path.join(appDir, 'deploy', 'docker-compose.yml'),
      '--env-file',
      composeEnvPath,
      ...args.map(String),
    ],
    {
      cwd: appDir,
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  );

  process.stdout.write(output);
  return output;
}

function inspectServiceStatus(containerId) {
  return execFileSync(
    'docker',
    [
      'inspect',
      '--format={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      containerId,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function composeArgs(appDir, composeEnvPath) {
  return [
    'compose',
    '--project-name',
    'lucent',
    '--project-directory',
    appDir,
    '-f',
    path.join(appDir, 'deploy', 'docker-compose.yml'),
    '--env-file',
    composeEnvPath,
  ];
}

function waitForService(appDir, composeEnvPath, serviceName) {
  const maxAttempts = Number(process.env.HEALTHCHECK_MAX_ATTEMPTS ?? '30');
  const sleepSeconds = Number(process.env.HEALTHCHECK_SLEEP_SECONDS ?? '5');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const containerId = execFileSync(
      'docker',
      [...composeArgs(appDir, composeEnvPath), 'ps', '-q', serviceName],
      {
        cwd: appDir,
        encoding: 'utf8',
      },
    ).trim();

    if (containerId) {
      const status = inspectServiceStatus(containerId);
      if (status === 'healthy' || status === 'running') {
        console.log(`${serviceName} is ${status}.`);
        return;
      }

      if (status === 'unhealthy' || status === 'dead' || status === 'exited') {
        console.error(`${serviceName} entered status: ${status}`);
        spawnSync(
          'docker',
          [
            ...composeArgs(appDir, composeEnvPath),
            'logs',
            '--tail=200',
            serviceName,
          ],
          {
            cwd: appDir,
            stdio: 'inherit',
          },
        );
        throw new Error(`${serviceName} failed to become healthy.`);
      }
    }

    console.log(`Waiting for ${serviceName} (${attempt}/${maxAttempts})...`);
    sleep(sleepSeconds);
  }

  spawnSync(
    'docker',
    [...composeArgs(appDir, composeEnvPath), 'logs', '--tail=200', serviceName],
    {
      cwd: appDir,
      stdio: 'inherit',
    },
  );
  throw new Error(`Timed out waiting for ${serviceName}.`);
}

function main() {
  const appDir = requiredEnv('LUCENT_APP_DIR');
  const serverDir = requiredEnv('LUCENT_SERVER_DIR');
  const imageRef = requiredEnv('LUCENT_IMAGE');

  ensureDirectories(serverDir);
  ensureFile(path.join(appDir, 'deploy', 'docker-compose.yml'));
  ensureFile(path.join(serverDir, '.env.production'));

  const composeEnvPath = writeComposeEnv(appDir, serverDir, imageRef);

  compose(appDir, composeEnvPath, ['pull', 'postgres', 'redis', 'nginx']);
  compose(appDir, composeEnvPath, ['pull', 'app']);
  compose(appDir, composeEnvPath, ['up', '-d', 'postgres', 'redis']);
  waitForService(appDir, composeEnvPath, 'postgres');
  waitForService(appDir, composeEnvPath, 'redis');
  compose(appDir, composeEnvPath, ['up', '-d', '--no-deps', 'app']);
  waitForService(appDir, composeEnvPath, 'app');
  compose(appDir, composeEnvPath, ['up', '-d', 'nginx']);
  waitForService(appDir, composeEnvPath, 'nginx');
  compose(appDir, composeEnvPath, ['ps']);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
