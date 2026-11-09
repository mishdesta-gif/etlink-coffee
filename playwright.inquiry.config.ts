import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/inquiry',outputDir:`out/inquiry-results-${process.env.ETLINK_INQUIRY_RUN_ID}-${process.env.ETLINK_INQUIRY_SCENARIO}`,workers:1,fullyParallel:false,timeout:90000,
 reporter:[['list'],['json',{outputFile:`review/phase1-local-inquiry-browser-${process.env.ETLINK_INQUIRY_SCENARIO}.json`}]],
 use:{baseURL:'http://127.0.0.1:3104',channel:'msedge',headless:true,trace:'off',screenshot:'off'},
 webServer:[
  {command:'node tests/fixture-server.mjs',url:'http://127.0.0.1:54329/_fixture/health',reuseExistingServer:false},
  {command:'npm run start -- --hostname 127.0.0.1 --port 3102',cwd:process.env.ETLINK_INQUIRY_APP_DIRECTORY,url:'http://127.0.0.1:3102/contact',reuseExistingServer:false},
  {command:'node tests/helpers/guest-inquiry-edge.mjs',url:'http://127.0.0.1:3104/_test-edge/health',reuseExistingServer:false},
 ]});
