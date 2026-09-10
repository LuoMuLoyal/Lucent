// PM2 配置 — Lucent staging(原生 Node 进程,root 用户运行)
// ---------------------------------------------------------------------------
// 用法(服务器上,仓库根目录 /opt/lucent):
//   pm2 startOrReload deploy/ecosystem.config.cjs --update-env
//   pm2 save
// 首次接入还需 `pm2 startup systemd`(root)让进程在机器重启后自动恢复,
// 完整步骤见 docs/howto/deploy.md。
//
// 说明:
//   - 必须是 .cjs:本仓库 package.json 是 "type": "module",用 module.exports
//     的 .js 文件会被当 ESM 解析,PM2 直接报 `module is not defined`。
//   - 运行时环境变量不在本文件里重复:应用按 NODE_ENV=production 自动加载
//     /opt/lucent/.env.production(见 src/config/env/env-file-paths.ts)。
//   - kill_signal 显式给 SIGTERM:应用 enableShutdownHooks() 会先给 SSE 连接推
//     终止事件再关闭,kill_timeout 留 60s 排空。
module.exports = {
  apps: [
    {
      name: 'lucent',
      script: 'dist/main.js',
      cwd: '/opt/lucent',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=2048',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
      },
      // 优雅停机:先 SIGTERM(SSE 排空),超时后 PM2 强杀
      kill_signal: 'SIGTERM',
      kill_timeout: 60000,
      listen_timeout: 15000,
      // 自动重启
      max_memory_restart: '2G',
      restart_delay: 3000,
      // 日志(仓库 .gitignore 已忽略 /logs)
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
    },
  ],
};
