import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/integration',workers:1,fullyParallel:false,timeout:30000,
  reporter:[['list'],['json',{outputFile:'review/phase1-integration-results.json'}]],
  use:{baseURL:'http://127.0.0.1:3102',channel:process.env.CI?'chromium':'msedge',headless:true,trace:'retain-on-failure'},
  webServer:process.env.ETLINK_INTEGRATION_MANAGED==='true'?[
    {command:'node tests/fixture-server.mjs',url:'http://127.0.0.1:54329/_fixture/health',reuseExistingServer:false},
    {command:'npm run start -- --hostname 127.0.0.1 --port 3102',url:'http://127.0.0.1:3102',reuseExistingServer:false},
  ]:undefined,
});
