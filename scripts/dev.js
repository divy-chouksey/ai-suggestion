import { spawn } from 'node:child_process'

const processes = [
  {
    name: 'api',
    command: 'node',
    args: ['server/index.js'],
    env: {
      API_PORT: '8787',
    },
  },
  {
    name: 'web',
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev:client'],
    env: {},
  },
]

let shuttingDown = false

const children = processes.map((processConfig) => {
  const child = spawn(processConfig.command, processConfig.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...processConfig.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })

  child.stdout.on('data', (data) => {
    process.stdout.write(`[${processConfig.name}] ${data}`)
  })

  child.stderr.on('data', (data) => {
    process.stderr.write(`[${processConfig.name}] ${data}`)
  })

  child.on('exit', (code) => {
    if (code && !shuttingDown) {
      console.error(`[${processConfig.name}] exited with code ${code}`)
      shutdown(code)
    }
  })

  return child
})

function shutdown(code = 0) {
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill()
    }
  }

  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
