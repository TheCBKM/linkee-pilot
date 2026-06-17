module.exports = {
  apps: [
    {
      name: "linkedin-agent",
      script: "tsx",
      args: "src/cli/index.ts start --foreground",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 60000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
