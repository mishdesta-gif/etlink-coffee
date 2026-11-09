import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/trading',workers:1,fullyParallel:false,timeout:180000,outputDir:`out/phase2-browser-${process.env.ETLINK_PHASE2_RUN}`,
 reporter:[['list'],['json',{outputFile:`review/phase2-browser-${process.env.ETLINK_PHASE2_RUN}.json`}]],
 use:{baseURL:'http://127.0.0.1:3102',channel:process.env.CI?'chromium':'msedge',headless:true,trace:'off',screenshot:'off',actionTimeout:15000,navigationTimeout:20000},
 webServer:[{command:'node tests/fixture-server.mjs',url:'http://127.0.0.1:54329/_fixture/health',reuseExistingServer:false},{command:'npm run start -- --hostname 127.0.0.1 --port 3102',cwd:process.env.ETLINK_PHASE2_APP_DIRECTORY,url:'http://127.0.0.1:3102',reuseExistingServer:false}]
});
