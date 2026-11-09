import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,
  reporter:[['list'],['json',{outputFile:'review/phase1-browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:3101',channel:process.env.CI?'chromium':'msedge',headless:true,trace:'retain-on-failure'},
  webServer:process.env.ETLINK_EXTERNAL_PREVIEW==='true'?undefined:{command:'npm run start -- --hostname 127.0.0.1 --port 3101',url:'http://127.0.0.1:3101',reuseExistingServer:false,timeout:60000},
});
